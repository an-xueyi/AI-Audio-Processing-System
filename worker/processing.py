import shutil
import subprocess
import time
from pathlib import Path

from config import DEMUCS_MODEL, PROCESSING_MODE, WORK_DIR
from database import update_job_status
from storage import download_input_file, upload_mock_results, upload_demucs_results


def create_job_workspace(job_id: str) -> Path:
    job_workspace = WORK_DIR / job_id

    if job_workspace.exists():
        shutil.rmtree(job_workspace)

    job_workspace.mkdir(parents=True, exist_ok=True)
    return job_workspace


def run_demucs(input_path: Path, job_workspace: Path) -> Path:
    output_dir = job_workspace / "demucs-output"

    command = [
        "python",
        "-m",
        "demucs",
        "-n",
        DEMUCS_MODEL,
        "-o",
        str(output_dir),
        str(input_path),
    ]

    subprocess.run(command, check=True)

    return output_dir / DEMUCS_MODEL / input_path.stem


def process_audio_job(
    job_id: str,
    input_object_key: str,
    job_workspace: Path,
) -> dict:
    input_path = download_input_file(input_object_key, job_workspace)
    print(f"Downloaded input file to {input_path}")

    update_job_status(job_id, "PROCESSING", 40)

    if PROCESSING_MODE == "demucs":
        update_job_status(job_id, "PROCESSING", 60)
        separated_dir = run_demucs(input_path, job_workspace)
        return upload_demucs_results(job_id, separated_dir)

    time.sleep(5)
    return upload_mock_results(job_id, input_path)
