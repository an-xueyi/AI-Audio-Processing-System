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

shutdown_requested = False


def request_shutdown(signal_number, _frame) -> None:
    global shutdown_requested
    shutdown_requested = True
    print(
        f"Worker {WORKER_ID} received signal {signal_number}. "
        "It will stop after its current job."
    )


def is_shutdown_requested() -> bool:
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
    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)

    consumer = create_consumer()
    consumer.subscribe([JOB_CREATED_TOPIC])
    print(
        f"Worker {WORKER_ID} listening for messages on topic: "
        f"{JOB_CREATED_TOPIC}"
    )

    try:
        while not shutdown_requested:
            message = consumer.poll(1.0)

            if message is None:
                continue

            if message.error():
                raise KafkaException(message.error())

            job = json.loads(message.value().decode("utf-8"))
            print(f"Worker {WORKER_ID} received job:")
            print(job)

            if not handle_job(job, is_shutdown_requested):
                break

            # A synchronous commit waits for Kafka to confirm the saved offset.
            # The next message is not accepted as finished until that succeeds.
            consumer.commit(message=message, asynchronous=False)
            print(f"Committed Kafka offset for job {job['jobId']}")
    finally:
        consumer.close()
        print(f"Worker {WORKER_ID} shutdown completed")


if __name__ == "__main__":
    main()
