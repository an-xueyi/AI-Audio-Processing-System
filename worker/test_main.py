"""Verify Kafka partition logging and reconnect signals used by the worker."""

import unittest

from confluent_kafka import TopicPartition

from kafka_partitions import PartitionAssignmentTracker, describe_partitions


class WorkerMainTest(unittest.TestCase):
    """Keep Kafka client objects out of the JSON logging boundary."""

    def test_partition_objects_become_json_safe_records(self):
        """Only topic names and partition numbers are needed for assignment logs."""
        partitions = [
            TopicPartition("audio.jobs.created", 0),
            TopicPartition("audio.jobs.created", 2),
        ]

        self.assertEqual(
            describe_partitions(partitions),
            [
                {"topic": "audio.jobs.created", "partition": 0},
                {"topic": "audio.jobs.created", "partition": 2},
            ],
        )

    def test_lost_assignment_produces_one_reconnect_signal(self):
        """One Kafka loss callback asks the main loop for exactly one new session."""
        tracker = PartitionAssignmentTracker()
        partitions = [TopicPartition("audio.jobs.created", 1)]

        # The Consumer argument is unused by our callback. None keeps this unit
        # test independent from a running Kafka broker.
        tracker.on_lost(None, partitions)

        # The first read sees the loss. The second read proves that consuming the
        # signal cleared it instead of requesting repeated reconnects forever.
        self.assertTrue(tracker.consume_loss_signal())
        self.assertFalse(tracker.consume_loss_signal())

    def test_new_assignment_clears_an_old_loss_signal(self):
        """A successful reassignment means the current consumer is usable again."""
        tracker = PartitionAssignmentTracker()
        partitions = [TopicPartition("audio.jobs.created", 2)]

        # Simulate Kafka reporting a loss and then repairing membership before
        # run_consumer_session has an opportunity to inspect the flag.
        tracker.on_lost(None, partitions)
        tracker.on_assigned(None, partitions)

        self.assertFalse(tracker.consume_loss_signal())


if __name__ == "__main__":
    unittest.main(verbosity=2)
