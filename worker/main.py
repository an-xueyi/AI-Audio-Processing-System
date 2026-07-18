import json
import os
import time
import psycopg
import boto3

from confluent_kafka import Consumer, KafkaException
from dotenv import load_dotenv

load_dotenv()

kafka_broker = os.getenv("KAFKA_BROKER", "localhost:9092")
job_created_topic = os.getenv("KAFKA_JOB_CREATED_TOPIC", "audio.jobs.created")
database_url = os.getenv("DATABASE_URL")

s3_endpoint = os.getenv("S3_ENDPOINT")
s3_region = os.getenv("S3_REGION")
s3_access_key_id = os.getenv("S3_ACCESS_KEY_ID")
s3_secret_access_key = os.getenv("S3_SECRET_ACCESS_KEY")
s3_bucket = os.getenv("S3_BUCKET")

s3_client = boto3.client(
    "s3",
    endpoint_url=s3_endpoint,
    region_name=s3_region,
    aws_access_key_id=s3_access_key_id,
    aws_secret_access_key=s3_secret_access_key,
)


def update_job_status(
    job_id: str,
    status: str,
    progress: int,
    result_keys: dict | None = None,
    error_message: str | None = None,
) -> None:
    if database_url is None:
        raise RuntimeError("DATABASE_URL is missing")

    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE jobs 
                SET status = %s, 
                    progress = %s,
                    result_object_keys = COALESCE(%s::jsonb, result_object_keys),
                    error_message = %s,
                    updated_at = NOW()
                WHERE id = %s
                """,
                (
                    status,
                    progress,
                    json.dumps(result_keys) if result_keys else None,
                    error_message,
                    job_id,
                ),
            )


def upload_mock_results(job_id: str) -> dict:
    if s3_bucket is None:
        raise RuntimeError("S3_BUCKET is missing")

    stems = ["vocals", "drums", "bass", "other"]
    result_keys = {}

    for stem in stems:
        object_key = f"results/{job_id}/{stem}.txt"
        body = f"Mock {stem} stem for job {job_id}\n"

        s3_client.put_object(
            Bucket=s3_bucket,
            Key=object_key,
            Body=body.encode("utf-8"),
            ContentType="text/plain",
        )

        result_keys[stem] = object_key

    return result_keys


consumer = Consumer(
    {
        "bootstrap.servers": kafka_broker,
        "group.id": "audio-worker",
        "auto.offset.reset": "earliest",
    }
)

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

        try:
            update_job_status(job_id, "PROCESSING", 10)
            print(f"Job {job_id} marked as PROCESSING")

            time.sleep(5)

            result_keys = upload_mock_results(job_id)
            update_job_status(job_id, "COMPLETED", 100, result_keys)
            print(f"Job {job_id} marked as COMPLETED")

        except Exception as error:
            error_message = str(error)
            update_job_status(job_id, "FAILED", 0, error_message=error_message)
            print(f"Job {job_id} failed: {error_message}")

except KeyboardInterrupt:
    print("Worker stopped by user")

finally:
    consumer.close()
