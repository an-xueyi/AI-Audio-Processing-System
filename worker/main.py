import json
import signal
import shutil
import time
from confluent_kafka import Consumer, KafkaException

from cancellation import JobCancelled
from config import (
    KAFKA_BROKER,
    JOB_CREATED_TOPIC,
    KAFKA_CONSUMER_GROUP,
    WORKER_ID,
    MAX_PROCESSING_ATTEMPTS,
    RETRY_BACKOFF_SECONDS,
    JOB_LEASE_TIMEOUT_SECONDS,
)
from database import begin_job_attempt, claim_job, update_job_status
from lease import JobLeaseHeartbeat
from processing import create_job_workspace, process_audio_job
from messaging import publish_dead_letter

shutdown_requested = False
claim_retry_interval_seconds = max(1, min(RETRY_BACKOFF_SECONDS, 10))


def request_shutdown(signal_number, _frame):
    global shutdown_requested
    shutdown_requested = True
    print(
        f"Worker {WORKER_ID} received signal {signal_number}. "
        "It will stop after its current job."
    )


def wait_for_job_claim(job_id: str) -> tuple[bool, str | None]:
    while not shutdown_requested:
        job_was_claimed, current_status = claim_job(
            job_id,
            WORKER_ID,
            JOB_LEASE_TIMEOUT_SECONDS,
        )

        if job_was_claimed or current_status in (
            None,
            "COMPLETED",
            "FAILED",
            "CANCELLED",
        ):
            return job_was_claimed, current_status

        print(
            f"Job {job_id} is currently owned by another worker. "
            f"Checking again in {claim_retry_interval_seconds} seconds."
        )
        time.sleep(claim_retry_interval_seconds)

    return False, None


signal.signal(signal.SIGTERM, request_shutdown)
signal.signal(signal.SIGINT, request_shutdown)

consumer = Consumer(
    {
        "bootstrap.servers": KAFKA_BROKER,
        "group.id": KAFKA_CONSUMER_GROUP,
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
        "enable.auto.offset.store": False,
        "max.poll.interval.ms": 60 * 60 * 1000,  # 1 hour
    }
)

consumer.subscribe([JOB_CREATED_TOPIC])
print(f"Worker {WORKER_ID} listening for messages on topic: {JOB_CREATED_TOPIC}")

try:
    while not shutdown_requested:
        message = consumer.poll(1.0)

        if message is None:
            continue

        if message.error():
            raise KafkaException(message.error())

        job = json.loads(message.value().decode("utf-8"))
        job_id = job["jobId"]
        input_object_key = job["inputObjectKey"]

        print(f"Worker {WORKER_ID} received job:")
        print(job)

        job_was_claimed, current_status = wait_for_job_claim(job_id)

        if shutdown_requested:
            break

        if current_status is None:
            print(f"Skipping unknown job {job_id}")
            consumer.commit(message=message, asynchronous=False)
            continue

        if not job_was_claimed:
            print(
                f"Skipping job {job_id}; its current status is "
                f"{current_status} and it is not available to claim"
            )
            consumer.commit(message=message, asynchronous=False)
            continue

        job_workspace = None

        try:
            with JobLeaseHeartbeat(job_id, WORKER_ID):
                for attempt in range(1, MAX_PROCESSING_ATTEMPTS + 1):
                    job_workspace = create_job_workspace(job_id)

                    try:
                        recorded_attempt = begin_job_attempt(job_id, WORKER_ID)
                        print(
                            f"Processing job {job_id}, local attempt "
                            f"{attempt}/{MAX_PROCESSING_ATTEMPTS}, "
                            f"recorded attempt {recorded_attempt}"
                        )

                        result_keys = process_audio_job(
                            job_id,
                            input_object_key,
                            job_workspace,
                            WORKER_ID,
                        )
                        update_job_status(
                            job_id,
                            WORKER_ID,
                            "COMPLETED",
                            100,
                            result_keys,
                        )
                        print(f"Job {job_id} marked as COMPLETED")
                        break

                    except JobCancelled:
                        print(f"Job {job_id} processing stopped after cancellation")
                        break

                    except Exception as error:
                        error_message = str(error)

                        if attempt < MAX_PROCESSING_ATTEMPTS:
                            delay = RETRY_BACKOFF_SECONDS * attempt
                            update_job_status(
                                job_id,
                                WORKER_ID,
                                "RETRYING",
                                10,
                                error_message=error_message,
                            )
                            print(
                                f"Job {job_id} attempt {attempt} failed. "
                                f"Retrying in {delay} seconds."
                            )
                            time.sleep(delay)
                            continue

                        publish_dead_letter(
                            job,
                            error_message,
                            MAX_PROCESSING_ATTEMPTS,
                        )
                        update_job_status(
                            job_id,
                            WORKER_ID,
                            "FAILED",
                            0,
                            error_message=error_message,
                        )
                        print(
                            f"Job {job_id} marked as FAILED "
                            "and sent to the dead-letter topic"
                        )

        finally:
            if job_workspace is not None:
                shutil.rmtree(job_workspace, ignore_errors=True)

        consumer.commit(message=message, asynchronous=False)
        print(f"Committed Kafka offset for job {job_id}")

finally:
    consumer.close()
    print(f"Worker {WORKER_ID} shutdown completed")
