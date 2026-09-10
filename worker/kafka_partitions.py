"""Describe Kafka consumer-group assignments without changing their behavior."""

from confluent_kafka import Consumer, TopicPartition

from observability import log_info


class PartitionAssignmentTracker:
    """
    Remember whether Kafka unexpectedly removed this consumer's partitions.

    Kafka normally moves partitions between workers during a rebalance. A normal
    revocation is temporary and is followed by another assignment, so it does not
    require us to replace the consumer. A *lost* assignment is different: the
    broker no longer recognizes this consumer as the owner. In that situation a
    long-running client can remain alive without receiving any more jobs. The main
    worker loop reads this tracker and creates a fresh consumer.

    Confluent Kafka invokes these methods from Consumer.poll(). The main loop
    reads the flag immediately after the same poll call, so a simple Boolean is
    sufficient; no separate thread lock is needed.
    """

    def __init__(self) -> None:
        # False is the normal state. It becomes True only in on_lost().
        self._partitions_were_lost = False

    def on_assigned(
        self,
        _consumer: Consumer,
        partitions: list[TopicPartition],
    ) -> None:
        """Record a successful assignment and write it to structured logs."""
        # A new assignment proves that this consumer belongs to the group again.
        # Clear an earlier loss signal before the main loop reads it.
        self._partitions_were_lost = False
        log_info(
            "kafka_partitions_assigned",
            partitions=describe_partitions(partitions),
        )

    def on_revoked(
        self,
        _consumer: Consumer,
        partitions: list[TopicPartition],
    ) -> None:
        """Log an ordinary rebalance without requesting a consumer restart."""
        # Kafka can revoke partitions while worker replicas join or leave. The
        # existing consumer remains valid and should wait for reassignment.
        log_info(
            "kafka_partitions_revoked",
            partitions=describe_partitions(partitions),
        )

    def on_lost(
        self,
        _consumer: Consumer,
        partitions: list[TopicPartition],
    ) -> None:
        """Ask the main loop to replace a consumer Kafka no longer recognizes."""
        # Do not close the consumer inside Kafka's callback. Setting a flag lets
        # Consumer.poll() return first, after which normal Python control flow can
        # close the old client safely.
        self._partitions_were_lost = True
        log_info(
            "kafka_partitions_lost",
            partitions=describe_partitions(partitions),
        )

    def consume_loss_signal(self) -> bool:
        """Return one pending loss signal and clear it after it is observed."""
        # Reading and clearing makes this signal one-shot. The main loop therefore
        # starts exactly one replacement session for one assignment loss.
        partitions_were_lost = self._partitions_were_lost
        self._partitions_were_lost = False
        return partitions_were_lost


def describe_partitions(partitions: list[TopicPartition]) -> list[dict]:
    """Convert Kafka objects into small JSON-safe topic/partition records."""
    # TopicPartition includes offsets and error fields that are unnecessary for
    # assignment visibility. Keeping only these two fields makes logs concise.
    return [
        {"topic": partition.topic, "partition": partition.partition}
        for partition in partitions
    ]
