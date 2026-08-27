"""
Read worker configuration from environment variables in one place.

Docker Compose supplies these values inside containers, while load_dotenv reads
worker/.env during manual local execution. Other modules import typed constants
from here instead of repeatedly parsing strings and choosing their own defaults.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# dotenv does not overwrite values already supplied by Docker or the shell.
load_dotenv()

# os.getenv returns the environment value or the second argument when absent.
KAFKA_BROKER = os.getenv("KAFKA_BROKER", "localhost:9092")

# Topic constants keep producers and consumers on matching Kafka channels.
JOB_CREATED_TOPIC = os.getenv("KAFKA_JOB_CREATED_TOPIC", "audio.jobs.created")
JOB_STATUS_TOPIC = os.getenv("KAFKA_JOB_STATUS_TOPIC", "audio.jobs.status")
KAFKA_CONSUMER_GROUP = os.getenv("KAFKA_CONSUMER_GROUP", "audio-worker")
# Docker assigns each container a unique hostname, which becomes the ownership
# identity stored in a job's processing lease.
WORKER_ID = os.getenv("HOSTNAME", "local-worker")
# No fallback is supplied for credentials; missing required values remain None and
# are rejected by the module that needs them.
DATABASE_URL = os.getenv("DATABASE_URL")

S3_ENDPOINT = os.getenv("S3_ENDPOINT")
S3_REGION = os.getenv("S3_REGION")
S3_ACCESS_KEY_ID = os.getenv("S3_ACCESS_KEY_ID")
S3_SECRET_ACCESS_KEY = os.getenv("S3_SECRET_ACCESS_KEY")
S3_BUCKET = os.getenv("S3_BUCKET")

# pathlib.Path provides safe filesystem path joining through the `/` operator.
WORK_DIR = Path(os.getenv("WORK_DIR", "/tmp/audio-processing"))
# mock verifies infrastructure quickly; demucs performs actual model inference.
PROCESSING_MODE = os.getenv("PROCESSING_MODE", "mock")
DEMUCS_MODEL = os.getenv("DEMUCS_MODEL", "htdemucs_6s")

# Multiline calls keep longer environment names readable.
DEAD_LETTER_TOPIC = os.getenv(
    "KAFKA_DEAD_LETTER_TOPIC",
    "audio.jobs.dead-letter",
)

MAX_PROCESSING_ATTEMPTS = max(
    # max prevents a configuration mistake such as 0 from disabling all attempts.
    1,
    int(os.getenv("MAX_PROCESSING_ATTEMPTS", "3")),
)

# Convert retry delay text to an integer and prevent negative sleep durations.
RETRY_BACKOFF_SECONDS = max(
    0,
    int(os.getenv("RETRY_BACKOFF_SECONDS", "5")),
)

JOB_LEASE_TIMEOUT_SECONDS = max(
    60,
    int(os.getenv("JOB_LEASE_TIMEOUT_SECONDS", "300")),
)

JOB_HEARTBEAT_INTERVAL_SECONDS = max(
    5,
    int(os.getenv("JOB_HEARTBEAT_INTERVAL_SECONDS", "30")),
)

if JOB_HEARTBEAT_INTERVAL_SECONDS >= JOB_LEASE_TIMEOUT_SECONDS:
    # A heartbeat must happen before expiration; otherwise healthy jobs could be
    # reclaimed by another worker and processed twice.
    raise RuntimeError(
        "JOB_HEARTBEAT_INTERVAL_SECONDS must be less than "
        "JOB_LEASE_TIMEOUT_SECONDS"
    )
