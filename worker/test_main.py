"""Verify the safe Kafka partition descriptions written to worker logs."""

import unittest

from confluent_kafka import TopicPartition

from kafka_partitions import describe_partitions


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
