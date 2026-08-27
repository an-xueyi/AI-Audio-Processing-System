"""Download source audio and upload result stems through the S3 API."""

import boto3
from pathlib import Path

from config import (
    S3_ACCESS_KEY_ID,
    S3_BUCKET,
    S3_ENDPOINT,
    S3_REGION,
    S3_SECRET_ACCESS_KEY,
)

# boto3 uses the same API for AWS S3 and local MinIO. endpoint_url selects MinIO
# now; the remaining worker code can stay unchanged during a future S3 migration.
s3_client = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    region_name=S3_REGION,
    aws_access_key_id=S3_ACCESS_KEY_ID,
    aws_secret_access_key=S3_SECRET_ACCESS_KEY,
)


def require_bucket() -> str:
    """Narrow Optional[str] configuration to a guaranteed bucket string."""
    if S3_BUCKET is None:
        raise RuntimeError("S3_BUCKET is missing")
    return S3_BUCKET


def download_input_file(input_object_key: str, job_workspace: Path) -> Path:
    """Copy one private object from storage into this job's workspace."""
    # Path(...).name discards storage prefixes and keeps only the final filename.
    input_file_name = Path(input_object_key).name
    # Join the safe base name to this job's isolated local workspace.
    input_path = job_workspace / input_file_name

    # boto3 writes the object's bytes directly to this local path.
    s3_client.download_file(require_bucket(), input_object_key, str(input_path))
    return input_path


def upload_mock_results(job_id: str, input_path: Path) -> dict:
    """Create small text outputs for testing infrastructure without Demucs."""
    stems = ["vocals", "drums", "bass", "other"]
    # Build the same stem-to-key shape produced by real Demucs uploads.
    result_keys = {}

    for stem in stems:
        # Every job owns a distinct result prefix, preventing filename collisions.
        object_key = f"results/{job_id}/{stem}.txt"
        body = (
            f"Mock {stem} stem for job {job_id}\n"
            f"Source file: {input_path.name}\n"
            f"Source size: {input_path.stat().st_size} bytes\n"
        )

        # put_object accepts the small in-memory mock text as bytes.
        s3_client.put_object(
            Bucket=require_bucket(),
            Key=object_key,
            Body=body.encode("utf-8"),
            ContentType="text/plain",
        )

        # Store the private key, not a public URL; the backend signs downloads later.
        result_keys[stem] = object_key

    return result_keys


def upload_demucs_results(
    job_id: str,
    separated_dir: Path,
    on_stem_uploaded=None,
) -> dict:
    """Upload every generated WAV file and return its permanent private key."""
    # sorted makes result ordering deterministic across filesystems.
    stem_paths = sorted(separated_dir.glob("*.wav"))

    # Treat missing output as failure rather than incorrectly completing an empty job.
    if not stem_paths:
        raise FileNotFoundError(
            f"Demucs did not create any WAV stems in: {separated_dir}"
        )

    result_keys = {}

    for index, stem_path in enumerate(stem_paths, start=1):
        # pathlib stem removes the .wav suffix, yielding names such as vocals.
        stem_name = stem_path.stem
        object_key = f"results/{job_id}/{stem_name}.wav"

        # upload_file handles reading the local file and can use multipart upload
        # for larger outputs. ContentType tells browsers that the result is WAV.
        s3_client.upload_file(
            str(stem_path),
            require_bucket(),
            object_key,
            ExtraArgs={"ContentType": "audio/wav"},
        )

        result_keys[stem_name] = object_key

        # The callback is optional so storage can be reused without progress reporting.
        if on_stem_uploaded is not None:
            on_stem_uploaded(index, len(stem_paths))

    return result_keys
