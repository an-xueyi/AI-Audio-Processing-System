import json
import os

from confluent_kafka import Consumer, KafkaException
from dotenv import load_dotenv

load_dotenv()

kafka_broker = os.getenv("KAFKA_BROKER", "localhost:9092")
job_created_topic = os.getenv("KAFKA_JOB_CREATED_TOPIC", "audio.jobs.created")

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

        print("Received job:")
        print(job)

except KeyboardInterrupt:
    print("Worker stopped by user")

finally:
    consumer.close()