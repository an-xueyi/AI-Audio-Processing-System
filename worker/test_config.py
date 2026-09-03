"""Verify that worker configuration fails early with understandable errors."""

import unittest
from unittest.mock import patch

import config


class WorkerConfigurationTest(unittest.TestCase):
    """Protect startup checks that run before the Kafka consumer is created."""

    def test_missing_database_url_is_rejected(self):
        """A worker must not claim a job without a database connection string."""
        with patch.object(config, "DATABASE_URL", None):
            with self.assertRaisesRegex(RuntimeError, "DATABASE_URL"):
                config.validate_runtime_configuration()

    def test_unknown_processing_mode_is_rejected(self):
        """A typo must not silently select an unintended processing path."""
        with patch.object(config, "PROCESSING_MODE", "demux"):
            with self.assertRaisesRegex(RuntimeError, "mock or demucs"):
                config.validate_runtime_configuration()

    def test_storage_endpoint_requires_an_http_url(self):
        """A bucket endpoint without a protocol cannot be used by boto3."""
        with patch.object(config, "S3_ENDPOINT", "minio:9000"):
            with self.assertRaisesRegex(RuntimeError, "absolute HTTP"):
                config.validate_runtime_configuration()


if __name__ == "__main__":
    unittest.main(verbosity=2)
