import json
import queue
import subprocess
import sys
import threading
from pathlib import Path

from cancellation import JobCancelled
from config import DEMUCS_MODEL
from database import update_job_status
from job_control import raise_if_job_cancelled

EVENT_PREFIX = "DEMUCS_EVENT "


def _stop_process(process: subprocess.Popen[str]) -> None:
    process.terminate()

    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def run_demucs(
    job_id: str,
    input_path: Path,
    job_workspace: Path,
    worker_id: str,
) -> Path:
    separated_dir = (
        job_workspace / "demucs-output" / DEMUCS_MODEL / input_path.stem
    )
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

        if not line.startswith(EVENT_PREFIX):
            print(line.rstrip())
            return

        event = json.loads(line.removeprefix(EVENT_PREFIX))

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

            # Demucs runs separately so cancellation can stop CPU work even
            # while the model is busy inside a long segment.
            raise_if_job_cancelled(job_id)
    except JobCancelled:
        _stop_process(process)
        raise
    finally:
        output_thread.join(timeout=2)

    while not output_queue.empty():
        handle_output_line(output_queue.get_nowait())

    if process.returncode != 0:
        raise RuntimeError(f"Demucs exited with code {process.returncode}")

    return separated_dir
