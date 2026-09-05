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

    def test_production_kafka_rejects_plaintext(self):
        """Remote job events must not travel over an unencrypted connection."""
        with patch.multiple(
            config,
            APP_ENV="production",
            KAFKA_SECURITY_PROTOCOL="PLAINTEXT",
        ):
            with self.assertRaisesRegex(RuntimeError, "must use SSL"):
                config.build_kafka_client_configuration()

    def test_sasl_ssl_builds_authenticated_kafka_settings(self):
        """The consumer and producer need the same hosted-broker credentials."""
        with patch.multiple(
            config,
            APP_ENV="production",
            KAFKA_BROKERS="one.example.com:9092,two.example.com:9092",
            KAFKA_SECURITY_PROTOCOL="SASL_SSL",
            KAFKA_SASL_MECHANISM="SCRAM-SHA-256",
            KAFKA_SASL_USERNAME="worker-user",
            KAFKA_SASL_PASSWORD="private-password",
            KAFKA_SSL_CA_PATH=None,
        ):
            kafka_configuration = config.build_kafka_client_configuration()

        self.assertEqual(
            kafka_configuration,
            {
                "bootstrap.servers": (
                    "one.example.com:9092,two.example.com:9092"
                ),
                "security.protocol": "SASL_SSL",
                "sasl.mechanism": "SCRAM-SHA-256",
                "sasl.username": "worker-user",
                "sasl.password": "private-password",
            },
        )

    def test_production_service_urls_require_encryption(self):
        """Database metadata and private audio must be encrypted in transit."""
        with patch.multiple(
            config,
            APP_ENV="production",
            DATABASE_URL="postgresql://user:password@db.example.com/audio",
            S3_ENDPOINT="https://storage.example.com",
            S3_REGION="us-east-1",
            S3_ACCESS_KEY_ID="private-key",
            S3_SECRET_ACCESS_KEY="private-secret",
            S3_BUCKET="private-audio",
            KAFKA_BROKERS="broker.example.com:9092",
            KAFKA_SECURITY_PROTOCOL="SSL",
            KAFKA_SSL_CA_PATH=None,
        ):
            with self.assertRaisesRegex(RuntimeError, "sslmode=require"):
                config.validate_runtime_configuration()

        with patch.multiple(
            config,
            APP_ENV="production",
            DATABASE_URL=(
                "postgresql://user:password@db.example.com/audio?sslmode=require"
            ),
            S3_ENDPOINT="http://storage.example.com",
            S3_REGION="us-east-1",
            S3_ACCESS_KEY_ID="private-key",
            S3_SECRET_ACCESS_KEY="private-secret",
            S3_BUCKET="private-audio",
            KAFKA_BROKERS="broker.example.com:9092",
            KAFKA_SECURITY_PROTOCOL="SSL",
            KAFKA_SSL_CA_PATH=None,
        ):
            with self.assertRaisesRegex(RuntimeError, "use HTTPS"):
                config.validate_runtime_configuration()


if __name__ == "__main__":
    unittest.main(verbosity=2)
