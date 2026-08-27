"""Publish permanently failed jobs to Kafka's dead-letter topic."""

import json
from datetime import datetime, timezone

from confluent_kafka import Producer

from config import DEAD_LETTER_TOPIC, KAFKA_BROKER

producer = Producer({"bootstrap.servers": KAFKA_BROKER})


def publish_dead_letter(job: dict, error_message: str, attempts: int) -> None:
    """Preserve the original event and failure context for later inspection."""
    # Include enough context to diagnose or manually replay the failed event.
    payload = {
        "original_job": job,
        "error": error_message,
        "attempts": attempts,
        # UTC ISO text is unambiguous across machines and time zones.
        "failedAt": datetime.now(timezone.utc).isoformat(),
    }

    # The nested callback appends errors here so synchronous code can inspect them
    # after flush has invoked delivery callbacks.
    delivery_errors: list[str] = []

    def delivery_report(error, _message) -> None:
        # confluent-kafka reports delivery asynchronously through this callback.
        if error is not None:
            delivery_errors.append(str(error))

    # produce places the message in the local producer queue; it does not wait
    # for the Kafka broker to confirm delivery.
    producer.produce(
        topic=DEAD_LETTER_TOPIC,
        # The job UUID as key keeps related events consistently partitioned.
        key=job["jobId"],
        value=json.dumps(payload),
        on_delivery=delivery_report,
    )

    # flush waits up to ten seconds for queued messages and callbacks. Its return
    # value is the number of messages that still have not been delivered.
    remaining_messages = producer.flush(10)

    if remaining_messages > 0:
        raise RuntimeError("Dead-letter event was not delivered before timeout")

    # A zero remaining count does not itself prove success; delivery callbacks may
    # have received a permanent broker error, so inspect that list separately.
    if delivery_errors:
        raise RuntimeError(f"Failed to publish dead-letter event: {delivery_errors[0]}")
