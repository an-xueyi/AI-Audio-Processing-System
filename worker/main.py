"""Run the worker process: consume Kafka jobs and hand them to job_handler."""

import json
import signal

from confluent_kafka import Consumer, KafkaException

from config import (
    JOB_CREATED_TOPIC,
    KAFKA_BROKER,
    KAFKA_CONSUMER_GROUP,
    WORKER_ID,
)
from job_handler import handle_job
from observability import log_info

# False means the process should continue polling Kafka. Signal handlers change
# this shared flag instead of abruptly exiting inside the handler.
shutdown_requested = False


def request_shutdown(signal_number, _frame) -> None:
    """Record a stop request while allowing the active job to finish safely."""
    # global is required because assignment would otherwise create a local variable.
    global shutdown_requested
    # Signal handlers should do very little work. Setting a flag lets the normal
    # control flow finish the active job and close Kafka cleanly.
    shutdown_requested = True
    log_info(
        "worker_shutdown_requested",
        signalNumber=signal_number,
    )


def is_shutdown_requested() -> bool:
    """Give job_handler a callback for reading current shutdown state."""
    return shutdown_requested


def create_consumer() -> Consumer:
    """
    Create the Kafka consumer used by this worker process.

    Every worker uses the same consumer group, so Kafka assigns each partition
    to only one worker in that group. This distributes jobs across replicas
    instead of asking every replica to process the same uploaded audio file.
    """
    return Consumer(
        {
            "bootstrap.servers": KAFKA_BROKER,
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


def main() -> None:
    # Docker sends SIGTERM during `docker compose stop`; Ctrl+C sends SIGINT.
    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)

    # Build one consumer for this worker process and subscribe it to new-job events.
    consumer = create_consumer()
    consumer.subscribe([JOB_CREATED_TOPIC])
    log_info("worker_started", kafkaTopic=JOB_CREATED_TOPIC)

    try:
        # Keep requesting Kafka messages until a signal changes the shared flag.
        while not shutdown_requested:
            # poll waits at most one second for a message. The timeout allows the
            # loop to notice shutdown_requested even when the topic is quiet.
            message = consumer.poll(1.0)

            if message is None:
                # A timeout with no message is normal; restart the loop and poll again.
                continue

            if message.error():
                # Broker/partition errors require the outer finally to close the consumer.
                raise KafkaException(message.error())

            # Kafka returns bytes. Decode UTF-8 text, then parse that JSON text
            # into the Python dictionary expected by handle_job.
            job = json.loads(message.value().decode("utf-8"))
            # Do not log the complete event because it contains the user's file
            # name and private object key. jobId is sufficient for correlation.
            log_info("kafka_job_received", jobId=job.get("jobId"))

            # handle_job returns False only when shutdown was requested before the
            # message could be safely completed and committed.
            if not handle_job(job, is_shutdown_requested):
                break

            # A synchronous commit waits for Kafka to confirm the saved offset.
            # The next message is not accepted as finished until that succeeds.
            consumer.commit(message=message, asynchronous=False)
            log_info("kafka_offset_committed", jobId=job["jobId"])
    finally:
        # close leaves the consumer group and commits no additional messages.
        consumer.close()
        log_info("worker_shutdown_completed")


if __name__ == "__main__":
    # Execute the worker only when this file is run, not when imported in a test.
    main()
