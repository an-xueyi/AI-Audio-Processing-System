"""Supervise the cancellable Demucs child process and translate its progress."""

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

# demucs_runner prefixes structured JSON with this exact text. Ordinary model
# logs omit the prefix and are printed for humans instead of parsed as events.
EVENT_PREFIX = "DEMUCS_EVENT "


def _stop_process(process: subprocess.Popen[str]) -> None:
    """Request graceful child termination, then force it if it does not exit."""
    # terminate sends SIGTERM on Linux, giving Python and native libraries a chance
    # to stop without the abruptness of SIGKILL.
    process.terminate()

    try:
        # Wait at most five seconds for graceful termination to finish.
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        # A child still running after the timeout is forcefully killed, then wait
        # again so the operating system can fully collect its process resources.
        process.kill()
        process.wait()


def run_demucs(
    job_id: str,
    input_path: Path,
    job_workspace: Path,
    worker_id: str,
) -> Path:
    """
    Run Demucs as a child process while this parent supervises the job.

    Machine-learning inference is blocking CPU work. A separate process lets the
    parent continue checking cancellation and translating progress events into
    database updates. If the user cancels, the parent can terminate the child
    instead of waiting for the entire song to finish.
    """
    # Demucs output is isolated under this job's workspace and grouped by model
    # and input filename. Path `/` joins components without manual slash strings.
    separated_dir = (
        job_workspace / "demucs-output" / DEMUCS_MODEL / input_path.stem
    )

    # Demucs begins at displayed progress 25. Starting last_progress at 24 allows
    # the first computed value of 25 to be written if the model reports it.
    last_progress = 24
    update_job_status(job_id, worker_id, "PROCESSING", 25)

    # Build an argument list instead of one shell string. subprocess passes each
    # entry as a distinct argument, so spaces in file paths remain safe.
    command = [
        # Use the same Python interpreter and installed environment as this worker.
        sys.executable,
        # Locate demucs_runner.py next to this source file inside local or Docker use.
        str(Path(__file__).with_name("demucs_runner.py")),
        "--model",
        DEMUCS_MODEL,
        "--input",
        str(input_path),
        "--output",
        str(separated_dir),
    ]
    # Popen starts the child and returns immediately, allowing this parent to
    # monitor output and cancellation while inference continues.
    process = subprocess.Popen(
        command,
        # Capture standard output so structured progress can be read here.
        stdout=subprocess.PIPE,
        # Merge errors into the same stream so Docker logs preserve ordering.
        stderr=subprocess.STDOUT,
        # Decode output bytes into Python strings automatically.
        text=True,
        # Request line-buffered communication for prompt progress events.
        bufsize=1,
    )

    # A thread-safe queue transfers lines from the blocking reader thread to the
    # main supervision loop.
    output_queue: queue.Queue[str] = queue.Queue()

    def collect_output() -> None:
        """Read child output until the pipe closes and enqueue every line."""
        # stdout is Optional in the type because Popen may be created without PIPE.
        if process.stdout is None:
            return

        # Iterating over the pipe waits for each line and ends at child EOF.
        for line in process.stdout:
            output_queue.put(line)

    # Reading a pipe can block until the child prints another line. A small
    # thread performs that blocking read and places lines in a queue, leaving the
    # main loop free to check the database for cancellation every half second.
    output_thread = threading.Thread(target=collect_output, daemon=True)
    output_thread.start()

    def handle_output_line(line: str) -> None:
        """Print human logs or convert one structured event into job progress."""
        # nonlocal allows assignment to last_progress from the enclosing function
        # instead of creating a new local variable with the same name.
        nonlocal last_progress

        # Lines without the marker are normal Demucs/PyTorch diagnostic output.
        if not line.startswith(EVENT_PREFIX):
            # rstrip removes the existing newline because print adds its own.
            print(line.rstrip())
            return

        # Remove only the known prefix, then decode the remaining JSON event.
        event = json.loads(line.removeprefix(EVENT_PREFIX))

        if event["type"] == "separation_progress":
            # Map Demucs's 0-to-1 value onto application progress 25-to-84. min
            # prevents rounding or unexpected input from exceeding this stage.
            progress = min(84, 25 + round(float(event["value"]) * 59))
        elif event["type"] == "stem_saved":
            # Saving all stems occupies application progress 85-to-92.
            progress = 85 + round(
                (int(event["completed"]) / int(event["total"])) * 7
            )
        else:
            # Ignore future or unknown event types that this parent does not handle.
            return

        # Progress must move only forward. Duplicate segment callbacks do not need
        # additional PostgreSQL writes or WebSocket notifications.
        if progress > last_progress:
            update_job_status(job_id, worker_id, "PROCESSING", progress)
            last_progress = progress

    try:
        # poll returns None while the child is running and an exit code afterward.
        while process.poll() is None:
            try:
                # Wait no longer than half a second for output. The timeout keeps
                # cancellation checks responsive even while Demucs prints nothing.
                handle_output_line(output_queue.get(timeout=0.5))
            except queue.Empty:
                # An empty queue at timeout is normal, not a job-processing failure.
                pass

            raise_if_job_cancelled(job_id)
    except JobCancelled:
        # Stop costly CPU work immediately, then re-raise so job_handler treats the
        # event as expected cancellation rather than retryable model failure.
        _stop_process(process)
        raise
    finally:
        # Give the reader thread time to observe EOF and finish enqueuing output.
        output_thread.join(timeout=2)

    # The process may exit between main-loop queue reads. Drain every final line so
    # late stem_saved events and diagnostics are not lost.
    while not output_queue.empty():
        handle_output_line(output_queue.get_nowait())

    # Zero means success by operating-system convention. Any other code becomes a
    # retryable exception handled by the outer job lifecycle.
    if process.returncode != 0:
        raise RuntimeError(f"Demucs exited with code {process.returncode}")

    # Return the directory whose WAV files storage.py will upload.
    return separated_dir
