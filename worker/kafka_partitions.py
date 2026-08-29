"""Describe Kafka consumer-group assignments without changing their behavior."""

from confluent_kafka import Consumer, TopicPartition

from observability import log_info


def describe_partitions(partitions: list[TopicPartition]) -> list[dict]:
    """Convert Kafka objects into small JSON-safe topic/partition records."""
    # TopicPartition includes offsets and error fields that are unnecessary for
    # assignment visibility. Keeping only these two fields makes logs concise.
    return [
        {"topic": partition.topic, "partition": partition.partition}
        for partition in partitions
    ]


def on_partitions_assigned(
    _consumer: Consumer,
    partitions: list[TopicPartition],
) -> None:
    """Log which Kafka partitions this consumer may now read."""
    # Kafka performs the assignment automatically after this callback returns.
    # The callback observes the rebalance but does not change its behavior.
    log_info(
        "kafka_partitions_assigned",
        partitions=describe_partitions(partitions),
    )


def on_partitions_revoked(
    _consumer: Consumer,
    partitions: list[TopicPartition],
) -> None:
    """Log partitions removed during an ordinary consumer-group rebalance."""
    log_info(
        "kafka_partitions_revoked",
        partitions=describe_partitions(partitions),
    )


def on_partitions_lost(
    _consumer: Consumer,
    partitions: list[TopicPartition],
) -> None:
    """Log unexpected assignment loss separately from a normal revocation."""
    log_info(
        "kafka_partitions_lost",
        partitions=describe_partitions(partitions),
    )
