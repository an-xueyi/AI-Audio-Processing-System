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
    return Consumer(
        {
            "bootstrap.servers": KAFKA_BROKER,
            "group.id": KAFKA_CONSUMER_GROUP,
            "auto.offset.reset": "earliest",
            # Commit only after the job is terminal or intentionally skipped.
            # A crash before commit lets Kafka deliver the event again.
            "enable.auto.commit": False,
            "enable.auto.offset.store": False,
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

            consumer.commit(message=message, asynchronous=False)
            print(f"Committed Kafka offset for job {job['jobId']}")
    finally:
        consumer.close()
        print(f"Worker {WORKER_ID} shutdown completed")


if __name__ == "__main__":
    main()
