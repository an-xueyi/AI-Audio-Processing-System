"""Run the worker process: consume Kafka jobs and hand them to job_handler."""

import json
import signal
import threading

from confluent_kafka import Consumer, KafkaException

from config import (
    JOB_CREATED_TOPIC,
    KAFKA_CONSUMER_GROUP,
    WORKER_ID,
    build_kafka_client_configuration,
    validate_runtime_configuration,
)
from job_handler import handle_job
from kafka_partitions import PartitionAssignmentTracker
from observability import log_error, log_info, log_warning
from worker_presence import WorkerPresence

# Five seconds gives a restarting broker time to become available while keeping a
# temporarily disconnected worker responsive. This delay also prevents a tight
# loop from creating thousands of consumers when Kafka remains unavailable.
KAFKA_RECONNECT_DELAY_SECONDS = 5

# Event provides a thread-safe stop flag and an interruptible wait operation. It
# starts unset, which means the worker should continue running.
shutdown_event = threading.Event()


class KafkaConsumerSessionLost(Exception):
    """Signal that the current Kafka consumer must be closed and replaced."""


def request_shutdown(signal_number, _frame) -> None:
    """Record a stop request while allowing the active job to finish safely."""
    # Signal handlers should do very little work. Setting the Event lets normal
    # control flow finish the active job and close Kafka cleanly.
    shutdown_event.set()
    log_info(
        "worker_shutdown_requested",
        signalNumber=signal_number,
    )


def is_shutdown_requested() -> bool:
    """Give job_handler a callback for reading current shutdown state."""
    # is_set() becomes True after SIGINT or SIGTERM calls request_shutdown().
    return shutdown_event.is_set()


def create_consumer() -> Consumer:
    """
    Create the Kafka consumer used by this worker process.

    Every worker uses the same consumer group, so Kafka assigns each partition
    to only one worker in that group. This distributes jobs across replicas
    instead of asking every replica to process the same uploaded audio file.
    """
    # Start with the shared broker security settings used by the dead-letter
    # producer, then add options that apply only to this consuming client.
    consumer_configuration = build_kafka_client_configuration()
    consumer_configuration.update(
        {
            "group.id": KAFKA_CONSUMER_GROUP,
            "auto.offset.reset": "earliest",
            # Kafka offsets are saved manually after handle_job returns. If this
            # process crashes during Demucs, the unsaved message can be delivered
            # again; the database lease then decides whether it may be reclaimed.
            "enable.auto.commit": False,
            "enable.auto.offset.store": False,
            # Audio separation can take much longer than Kafka's usual request
            # processing. This allows one hour before Kafka considers a worker
            # unresponsive and moves its partitions to another worker.
            "max.poll.interval.ms": 60 * 60 * 1000,
        }
    )
    return Consumer(consumer_configuration)


def run_consumer_session(consumer: Consumer, presence: WorkerPresence) -> None:
    """Poll jobs until shutdown or until this Kafka consumer must be replaced."""
    # Each consumer session receives its own one-shot assignment tracker. A new
    # session must not inherit a loss signal from an older consumer.
    assignment_tracker = PartitionAssignmentTracker()

    # Rebalance callbacks describe Kafka's distribution decisions and tell this
    # loop when the broker has permanently rejected the current membership.
    consumer.subscribe(
        [JOB_CREATED_TOPIC],
        on_assign=assignment_tracker.on_assigned,
        on_revoke=assignment_tracker.on_revoked,
        on_lost=assignment_tracker.on_lost,
    )
    log_info("kafka_consumer_session_started", kafkaTopic=JOB_CREATED_TOPIC)

    # Keep requesting Kafka messages until a signal changes the shared Event.
    while not shutdown_event.is_set():
        # poll waits at most one second for a message. The timeout allows the loop
        # to notice shutdown_event even when the Kafka topic is quiet.
        message = consumer.poll(1.0)

        # Rebalance callbacks run inside poll(). Check their signal before using a
        # returned message because this consumer may no longer own its partition.
        if assignment_tracker.consume_loss_signal():
            raise KafkaConsumerSessionLost(
                "Kafka reported that this consumer lost its partition assignment"
            )

        if message is None:
            # A timeout with no message is normal; restart the loop and poll again.
            continue

        if message.error():
            # The supervisor in main() will replace this failed Kafka consumer.
            raise KafkaException(message.error())

        # Kafka returns bytes. Decode UTF-8 text, then parse that JSON text into
        # the Python dictionary expected by handle_job.
        job = json.loads(message.value().decode("utf-8"))
        # Do not log the complete event because it contains the user's file name
        # and private object key. jobId is sufficient for correlation.
        job_id = job["jobId"]
        log_info("kafka_job_received", jobId=job_id)

        # BUSY starts when the worker accepts a Kafka message, including time
        # waiting to claim a stale lease. finally restores IDLE after every
        # success, skip, cancellation, failure, or raised exception.
        presence.mark_busy(job_id)
        try:
            message_was_handled = handle_job(job, is_shutdown_requested)
        finally:
            presence.mark_idle()

        # False means shutdown arrived before the message could be completed.
        if not message_was_handled:
            return

        # A synchronous commit waits for Kafka to confirm the saved offset. The
        # next message is not accepted as finished until that succeeds.
        consumer.commit(message=message, asynchronous=False)
        log_info("kafka_offset_committed", jobId=job_id)


def main() -> None:
    # Validate all external-service settings before joining the Kafka group. A
    # misconfigured worker therefore becomes visibly unhealthy without claiming
    # a job that it cannot download, update, or finish.
    validate_runtime_configuration()

    # Docker sends SIGTERM during `docker compose stop`; Ctrl+C sends SIGINT.
    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)

    # WorkerPresence owns the PostgreSQL heartbeat for the lifetime of this
    # process. Kafka consumers may now be replaced without losing that identity.
    presence = WorkerPresence()
    presence.start()
    log_info("worker_started", kafkaTopic=JOB_CREATED_TOPIC)

    try:
        # This outer loop supervises replaceable Kafka sessions. The Python
        # container stays alive while a temporary broker interruption is repaired.
        while not shutdown_event.is_set():
            consumer = create_consumer()
            try:
                run_consumer_session(consumer, presence)
            except (KafkaConsumerSessionLost, KafkaException) as error:
                # These errors describe the Kafka connection, not the audio job.
                # Closing and replacing the client leaves queued jobs durable.
                log_warning(
                    "kafka_consumer_session_restarting",
                    error=str(error),
                    retryDelaySeconds=KAFKA_RECONNECT_DELAY_SECONDS,
                )
            finally:
                # close releases sockets and group membership belonging to this
                # session. It does not commit an unfinished job message.
                consumer.close()

            if not shutdown_event.is_set():
                log_info(
                    "kafka_consumer_reconnect_wait_started",
                    delaySeconds=KAFKA_RECONNECT_DELAY_SECONDS,
                )
                # Event.wait acts like sleep, but a stop signal ends the wait early.
                shutdown_event.wait(KAFKA_RECONNECT_DELAY_SECONDS)
    except Exception as error:
        # Unexpected programming or service errors should still end the process so
        # Docker can report and restart a genuinely failed worker.
        log_error("worker_failed", error=str(error))
        raise
    finally:
        # Stop the heartbeat after every Kafka session is closed so this worker is
        # no longer advertised as available once the process is shutting down.
        presence.stop()
        log_info("worker_shutdown_completed")


if __name__ == "__main__":
    # Execute the worker only when this file is run, not when imported in a test.
    main()
