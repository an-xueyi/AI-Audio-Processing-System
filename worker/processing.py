import shutil
import time
from pathlib import Path

from config import PROCESSING_MODE, WORK_DIR
from database import update_job_status
from demucs_process import run_demucs
from job_control import raise_if_job_cancelled
from storage import download_input_file, upload_demucs_results, upload_mock_results


def create_job_workspace(job_id: str) -> Path:
    job_workspace = WORK_DIR / job_id

    if job_workspace.exists():
        shutil.rmtree(job_workspace)

    job_workspace.mkdir(parents=True, exist_ok=True)
    return job_workspace


def process_audio_job(
    job_id: str,
    input_object_key: str,
    job_workspace: Path,
    worker_id: str,
) -> dict:
    update_job_status(job_id, worker_id, "PROCESSING", 15)
    raise_if_job_cancelled(job_id)
    input_path = download_input_file(input_object_key, job_workspace)
    print(f"Downloaded input file to {input_path}")

    update_job_status(job_id, worker_id, "PROCESSING", 20)
    raise_if_job_cancelled(job_id)

    if PROCESSING_MODE == "demucs":
        separated_dir = run_demucs(
            job_id,
            input_path,
            job_workspace,
            worker_id,
        )

        def report_stem_upload(index: int, total: int) -> None:
            raise_if_job_cancelled(job_id)
            upload_progress = 92 + round((index / total) * 7)
            update_job_status(
                job_id,
                worker_id,
                "PROCESSING",
                upload_progress,
            )

        return upload_demucs_results(
            job_id,
            separated_dir,
            report_stem_upload,
        )

    # Mock mode keeps local development fast while exercising the same status,
    # Kafka, database, and object-storage paths as Demucs mode.
    for progress in range(30, 91, 10):
        raise_if_job_cancelled(job_id)
        update_job_status(job_id, worker_id, "PROCESSING", progress)
        time.sleep(0.5)

    return upload_mock_results(job_id, input_path)
