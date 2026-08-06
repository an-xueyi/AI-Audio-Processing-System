import json
import shutil
from confluent_kafka import Consumer, KafkaException

from config import KAFKA_BROKER, JOB_CREATED_TOPIC
from database import get_job_status, update_job_status
from processing import create_job_workspace, process_audio_job

consumer = Consumer(
    {
        "bootstrap.servers": KAFKA_BROKER,
        "group.id": "audio-worker",
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
        "enable.auto.offset.store": False,
        "max.poll.interval.ms": 60 * 60 * 1000,  # 1 hour
    }
)

consumer.subscribe([JOB_CREATED_TOPIC])
print(f"Worker listening for messages on topic: {JOB_CREATED_TOPIC}")

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

        print("Received job:")
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

        job_workspace = create_job_workspace(job_id)

        try:
            update_job_status(job_id, "PROCESSING", 10)
            print(f"Job {job_id} marked as PROCESSING")

            result_keys = process_audio_job(job_id, input_object_key, job_workspace)

            update_job_status(job_id, "COMPLETED", 100, result_keys)
            print(f"Job {job_id} marked as COMPLETED")

        except Exception as error:
            error_message = str(error)
            update_job_status(job_id, "FAILED", 0, error_message=error_message)
            print(f"Job {job_id} failed: {error_message}")

        finally:
            shutil.rmtree(job_workspace, ignore_errors=True)

        consumer.commit(message=message, asynchronous=False)
        print(f"Committed Kafka offset for job {job_id}")

except KeyboardInterrupt:
    print("Worker stopped by user")

finally:
    consumer.close()
