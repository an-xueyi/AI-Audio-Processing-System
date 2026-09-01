"""Coordinate download, Demucs execution, progress, and result upload stages."""

import shutil
import time
from pathlib import Path

from config import MOCK_PROCESSING_DELAY_SECONDS, PROCESSING_MODE, WORK_DIR
from database import update_job_status
from demucs_process import run_demucs
from job_control import raise_if_job_cancelled
from observability import log_info
from storage import download_input_file, upload_demucs_results, upload_mock_results


def create_job_workspace(job_id: str) -> Path:
    """Create one clean temporary directory isolated by job UUID."""
    job_workspace = WORK_DIR / job_id

    if job_workspace.exists():
        # Redelivery after a crash may leave partial files. Removing them prevents
        # stale output from being mistaken for the new attempt's results.
        shutil.rmtree(job_workspace)

    # parents=True creates missing parent folders; exist_ok avoids a race error
    # when the directory already exists by the time mkdir runs.
    job_workspace.mkdir(parents=True, exist_ok=True)
    return job_workspace


def process_audio_job(
    job_id: str,
    input_object_key: str,
    job_workspace: Path,
    worker_id: str,
) -> dict:
    """Run one job's stages and return {stem_name: object_storage_key}."""
    # Progress ranges are reserved by stage: download uses 15-20, Demucs uses
    # 25-92, and result uploads use 92-99. COMPLETED is set to 100 by the caller.
    # Persist stage progress before and after each potentially slow external action.
    update_job_status(job_id, worker_id, "PROCESSING", 15)

    # Cancellation checkpoints avoid beginning a new expensive stage unnecessarily.
    raise_if_job_cancelled(job_id)

    # Download from the private object key supplied by the validated job event.
    input_path = download_input_file(input_object_key, job_workspace)
    # Log only the base filename, not the full temporary path or private object key.
    log_info(
        "job_input_downloaded",
        jobId=job_id,
        inputFileName=input_path.name,
    )

    update_job_status(job_id, worker_id, "PROCESSING", 20)
    raise_if_job_cancelled(job_id)

    # Real mode runs machine-learning separation; any other configured value uses
    # the lightweight infrastructure-testing path below.
    if PROCESSING_MODE == "demucs":
        separated_dir = run_demucs(
            job_id,
            input_path,
            job_workspace,
            worker_id,
        )

        def report_stem_upload(index: int, total: int) -> None:
            # Convert "stem 3 of 6" into the small final portion of the progress
            # range. round produces an integer suitable for the database column.
            raise_if_job_cancelled(job_id)
            upload_progress = 92 + round((index / total) * 7)
            update_job_status(
                job_id,
                worker_id,
                "PROCESSING",
                upload_progress,
            )

        # Return immediately with uploaded WAV keys when the real path succeeds.
        return upload_demucs_results(
            job_id,
            separated_dir,
            report_stem_upload,
        )

    # Mock mode keeps local development fast while exercising the same status,
    # Kafka, database, and object-storage paths as Demucs mode.
    # range produces 30, 40, ... 90 because its stop value 91 is excluded. Turn
    # it into a list so the configured total delay can be divided evenly across
    # every progress step without hard-coding the number seven elsewhere.
    mock_progress_values = list(range(30, 91, 10))
    delay_per_step = MOCK_PROCESSING_DELAY_SECONDS / len(mock_progress_values)

    for progress in mock_progress_values:
        raise_if_job_cancelled(job_id)
        update_job_status(job_id, worker_id, "PROCESSING", progress)
        # Zero is valid for a fast infrastructure check. Avoiding sleep entirely
        # in that case also makes the intention clearer during tests.
        if delay_per_step > 0:
            time.sleep(delay_per_step)

    return upload_mock_results(job_id, input_path)
