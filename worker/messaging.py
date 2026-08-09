import json
from datetime import datetime, timezone

from confluent_kafka import Producer

from config import DEAD_LETTER_TOPIC, KAFKA_BROKER

producer = Producer({"bootstrap.servers": KAFKA_BROKER})


def publish_dead_letter(job: dict, error_message: str, attempts: int) -> None:
    payload = {
        "original_job": job,
        "error": error_message,
        "attempts": attempts,
        "failedAt": datetime.now(timezone.utc).isoformat(),
    }

    delivery_errors: list[str] = []

    def delivery_report(error, _message) -> None:
        if error is not None:
            delivery_errors.append(str(error))

    producer.produce(
        topic=DEAD_LETTER_TOPIC,
        key=job["jobId"],
        value=json.dumps(payload),
        on_delivery=delivery_report,
    )

    remaining_messages = producer.flush(10)

    if remaining_messages > 0:
        raise RuntimeError("Dead-letter event was not delivered before timeout")

    if delivery_errors:
        raise RuntimeError(f"Failed to publish dead-letter event: {delivery_errors[0]}")
