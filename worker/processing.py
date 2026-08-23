import json
import queue
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from cancellation import JobCancelled
from config import DEMUCS_MODEL, PROCESSING_MODE, WORK_DIR
from database import is_job_cancelled, update_job_status
from storage import download_input_file, upload_mock_results, upload_demucs_results


def create_job_workspace(job_id: str) -> Path:
    job_workspace = WORK_DIR / job_id

    if job_workspace.exists():
        shutil.rmtree(job_workspace)

    job_workspace.mkdir(parents=True, exist_ok=True)
    return job_workspace


def raise_if_job_cancelled(job_id: str) -> None:
    if is_job_cancelled(job_id):
        raise JobCancelled(f"Job {job_id} was cancelled")


def run_demucs(
    job_id: str,
    input_path: Path,
    job_workspace: Path,
    worker_id: str,
) -> Path:
    output_dir = job_workspace / "demucs-output"
    separated_dir = output_dir / DEMUCS_MODEL / input_path.stem
    last_progress = 24
    update_job_status(job_id, worker_id, "PROCESSING", 25)

    command = [
        sys.executable,
        str(Path(__file__).with_name("demucs_runner.py")),
        "--model",
        DEMUCS_MODEL,
        "--input",
        str(input_path),
        "--output",
        str(separated_dir),
    ]
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    output_queue: queue.Queue[str] = queue.Queue()

    def collect_output() -> None:
        if process.stdout is None:
            return

        for line in process.stdout:
            output_queue.put(line)

    output_thread = threading.Thread(target=collect_output, daemon=True)
    output_thread.start()

    def handle_output_line(line: str) -> None:
        nonlocal last_progress
        event_prefix = "DEMUCS_EVENT "

        if not line.startswith(event_prefix):
            print(line.rstrip())
            return

        event = json.loads(line.removeprefix(event_prefix))

        if event["type"] == "separation_progress":
            progress = min(84, 25 + round(float(event["value"]) * 59))
        elif event["type"] == "stem_saved":
            progress = 85 + round(
                (int(event["completed"]) / int(event["total"])) * 7
            )
        else:
            return

        if progress > last_progress:
            update_job_status(job_id, worker_id, "PROCESSING", progress)
            last_progress = progress

    try:
        while process.poll() is None:
            try:
                handle_output_line(output_queue.get(timeout=0.5))
            except queue.Empty:
                pass

            raise_if_job_cancelled(job_id)
    except JobCancelled:
        process.terminate()

        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

        raise
    finally:
        output_thread.join(timeout=2)

    while not output_queue.empty():
        handle_output_line(output_queue.get_nowait())

    if process.returncode != 0:
        raise RuntimeError(f"Demucs exited with code {process.returncode}")

    return separated_dir


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

    for progress in range(30, 91, 10):
        raise_if_job_cancelled(job_id)
        update_job_status(job_id, worker_id, "PROCESSING", progress)
        time.sleep(0.5)

    return upload_mock_results(job_id, input_path)
