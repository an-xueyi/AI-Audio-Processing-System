import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

KAFKA_BROKER = os.getenv("KAFKA_BROKER", "localhost:9092")
JOB_CREATED_TOPIC = os.getenv("KAFKA_JOB_CREATED_TOPIC", "audio.jobs.created")
DATABASE_URL = os.getenv("DATABASE_URL")

S3_ENDPOINT = os.getenv("S3_ENDPOINT")
S3_REGION = os.getenv("S3_REGION")
S3_ACCESS_KEY_ID = os.getenv("S3_ACCESS_KEY_ID")
S3_SECRET_ACCESS_KEY = os.getenv("S3_SECRET_ACCESS_KEY")
S3_BUCKET = os.getenv("S3_BUCKET")

WORK_DIR = Path(os.getenv("WORK_DIR", "/tmp/audio-processing"))
PROCESSING_MODE = os.getenv("PROCESSING_MODE", "mock")
DEMUCS_MODEL = os.getenv("DEMUCS_MODEL", "htdemucs")
