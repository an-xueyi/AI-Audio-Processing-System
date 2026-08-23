import boto3
from pathlib import Path

from config import (
    S3_ACCESS_KEY_ID,
    S3_BUCKET,
    S3_ENDPOINT,
    S3_REGION,
    S3_SECRET_ACCESS_KEY,
)

s3_client = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    region_name=S3_REGION,
    aws_access_key_id=S3_ACCESS_KEY_ID,
    aws_secret_access_key=S3_SECRET_ACCESS_KEY,
)


def require_bucket() -> str:
    if S3_BUCKET is None:
        raise RuntimeError("S3_BUCKET is missing")
    return S3_BUCKET


def download_input_file(input_object_key: str, job_workspace: Path) -> Path:
    input_file_name = Path(input_object_key).name
    input_path = job_workspace / input_file_name

    s3_client.download_file(require_bucket(), input_object_key, str(input_path))
    return input_path


def upload_mock_results(job_id: str, input_path: Path) -> dict:
    stems = ["vocals", "drums", "bass", "other"]
    result_keys = {}

    for stem in stems:
        object_key = f"results/{job_id}/{stem}.txt"
        body = (
            f"Mock {stem} stem for job {job_id}\n"
            f"Source file: {input_path.name}\n"
            f"Source size: {input_path.stat().st_size} bytes\n"
        )

        s3_client.put_object(
            Bucket=require_bucket(),
            Key=object_key,
            Body=body.encode("utf-8"),
            ContentType="text/plain",
        )

        result_keys[stem] = object_key

    return result_keys


def upload_demucs_results(
    job_id: str,
    separated_dir: Path,
    on_stem_uploaded=None,
) -> dict:
    stem_paths = sorted(separated_dir.glob("*.wav"))

    if not stem_paths:
        raise FileNotFoundError(
            f"Demucs did not create any WAV stems in: {separated_dir}"
        )

    result_keys = {}

    for index, stem_path in enumerate(stem_paths, start=1):
        stem_name = stem_path.stem
        object_key = f"results/{job_id}/{stem_name}.wav"

        s3_client.upload_file(
            str(stem_path),
            require_bucket(),
            object_key,
            ExtraArgs={"ContentType": "audio/wav"},
        )

        result_keys[stem_name] = object_key

        if on_stem_uploaded is not None:
            on_stem_uploaded(index, len(stem_paths))

    return result_keys
