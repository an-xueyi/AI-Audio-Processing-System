import json
import shutil
import time
from confluent_kafka import Consumer, KafkaException

from config import (
    KAFKA_BROKER,
    JOB_CREATED_TOPIC,
    KAFKA_CONSUMER_GROUP,
    WORKER_ID,
    MAX_PROCESSING_ATTEMPTS,
    RETRY_BACKOFF_SECONDS,
)
from database import get_job_status, update_job_status
from processing import create_job_workspace, process_audio_job
from messaging import publish_dead_letter

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
    while True:
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

        current_status = get_job_status(job_id)

        if current_status is None:
            print(f"Skipping unknown job {job_id}")
            consumer.commit(message=message, asynchronous=False)
            continue

        if current_status == "COMPLETED":
            print(f"Skipping already completed job {job_id}")
            consumer.commit(message=message, asynchronous=False)
            continue

        job_workspace = None

        try:
            for attempt in range(1, MAX_PROCESSING_ATTEMPTS + 1):
                job_workspace = create_job_workspace(job_id)
                try:
                    update_job_status(job_id, "PROCESSING", 10)
                    print(
                        f"Processing job {job_id}, "
                        f"attempt {attempt}/{MAX_PROCESSING_ATTEMPTS}"
                    )

                    result_keys = process_audio_job(
                        job_id, input_object_key, job_workspace
                    )
                    update_job_status(job_id, "COMPLETED", 100, result_keys)
                    print(f"Job {job_id} marked as COMPLETED")
                    break

                except Exception as error:
                    error_message = str(error)

                    if attempt < MAX_PROCESSING_ATTEMPTS:
                        delay = RETRY_BACKOFF_SECONDS * attempt
                        update_job_status(
                            job_id, "RETRYING", 10, error_message=error_message
                        )
                        print(
                            f"Job {job_id} attempt {attempt} failed. "
                            f"Retrying in {delay} seconds."
                        )
                        time.sleep(delay)
                        continue

                    publish_dead_letter(job, error_message, MAX_PROCESSING_ATTEMPTS)
                    update_job_status(job_id, "FAILED", 0, error_message=error_message)
                    print(
                        f"Job {job_id} marked as FAILED "
                        "and sent to the dead-letter topic"
                    )

        finally:
            if job_workspace is not None:
                shutil.rmtree(job_workspace, ignore_errors=True)

        consumer.commit(message=message, asynchronous=False)
        print(f"Committed Kafka offset for job {job_id}")

except KeyboardInterrupt:
    print("Worker stopped by user")

finally:
    consumer.close()
