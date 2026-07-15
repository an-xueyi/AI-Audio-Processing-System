import json
import os
import time
import psycopg

from confluent_kafka import Consumer, KafkaException
from dotenv import load_dotenv

load_dotenv()

kafka_broker = os.getenv("KAFKA_BROKER", "localhost:9092")
job_created_topic = os.getenv("KAFKA_JOB_CREATED_TOPIC", "audio.jobs.created")
database_url = os.getenv("DATABASE_URL")

def update_job_status(job_id: str, status: str, progress: int) -> None:
    if database_url is None:
        raise RuntimeError("DATABASE_URL is missing")
    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE jobs 
                SET status = %s, 
                    progress = %s,
                    updated_at = NOW()
                WHERE id = %s
                """,
                (status, progress, job_id)
            )

consumer = Consumer({
    "bootstrap.servers": kafka_broker,
    "group.id": "audio-worker",
    "auto.offset.reset": "earliest"
})

consumer.subscribe([job_created_topic])

print(f"Worker listening for messages on topic: {job_created_topic}")

try:
    while True:
        message = consumer.poll(1.0)

        if message is None:
            continue

        if message.error():
            raise KafkaException(message.error())
        
        job = json.loads(message.value().decode("utf-8"))
        job_id = job["jobId"]

        print("Received job:")
        print(job)

        update_job_status(job_id, "PROCESSING", 10)
        print(f"Job {job_id} marked as PROCESSING")

        time.sleep(5)

        update_job_status(job_id, "COMPLETED", 100)
        print(f"Job {job_id} marked as COMPLETED")

except KeyboardInterrupt:
    print("Worker stopped by user")

finally:
    consumer.close()