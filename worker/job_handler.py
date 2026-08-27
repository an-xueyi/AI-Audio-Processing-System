import shutil
import time
from collections.abc import Callable

from cancellation import JobCancelled
from config import (
    JOB_LEASE_TIMEOUT_SECONDS,
    MAX_PROCESSING_ATTEMPTS,
    RETRY_BACKOFF_SECONDS,
    WORK_DIR,
    WORKER_ID,
)
from database import begin_job_attempt, claim_job, update_job_status
from job_control import raise_if_job_cancelled
from lease import JobLeaseHeartbeat
from messaging import publish_dead_letter
from processing import create_job_workspace, process_audio_job

CLAIM_RETRY_INTERVAL_SECONDS = max(1, min(RETRY_BACKOFF_SECONDS, 10))
TERMINAL_STATUSES = {"COMPLETED", "FAILED", "CANCELLED"}


def wait_for_job_claim(
    job_id: str,
    shutdown_requested: Callable[[], bool],
) -> tuple[bool, str | None]:
    """
    Try to obtain database ownership of a job before running expensive work.

    Kafka usually sends a message to one worker, but it may redeliver after a
    crash or an uncertain offset commit. The database claim is the final guard
    against two workers running Demucs for the same job at the same time. A live
    owner is respected; a stale owner can be replaced after its lease expires.
    """
    while not shutdown_requested():
        job_was_claimed, current_status = claim_job(
            job_id,
            WORKER_ID,
            JOB_LEASE_TIMEOUT_SECONDS,
        )

        if job_was_claimed or current_status is None:
            return job_was_claimed, current_status

        if current_status in TERMINAL_STATUSES:
            return False, current_status

        print(
            f"Job {job_id} is currently owned by another worker. "
            f"Checking again in {CLAIM_RETRY_INTERVAL_SECONDS} seconds."
        )
        time.sleep(CLAIM_RETRY_INTERVAL_SECONDS)

    return False, None


def _run_attempts(job: dict) -> None:
    job_id = job["jobId"]

    for attempt in range(1, MAX_PROCESSING_ATTEMPTS + 1):
        job_workspace = create_job_workspace(job_id)

        try:
            recorded_attempt = begin_job_attempt(job_id, WORKER_ID)
            print(
                f"Processing job {job_id}, local attempt "
                f"{attempt}/{MAX_PROCESSING_ATTEMPTS}, "
                f"recorded attempt {recorded_attempt}"
            )
            result_keys = process_audio_job(
                job_id,
                job["inputObjectKey"],
                job_workspace,
                WORKER_ID,
            )
            update_job_status(
                job_id,
                WORKER_ID,
                "COMPLETED",
                100,
                result_keys,
            )
            print(f"Job {job_id} marked as COMPLETED")
            return
        except JobCancelled:
            raise
        except Exception as error:
            error_message = str(error)

            if attempt < MAX_PROCESSING_ATTEMPTS:
                delay = RETRY_BACKOFF_SECONDS * attempt
                update_job_status(
                    job_id,
                    WORKER_ID,
                    "RETRYING",
                    10,
                    error_message=error_message,
                )
                print(
                    f"Job {job_id} attempt {attempt} failed. "
                    f"Retrying in {delay} seconds."
                )
                time.sleep(delay)
                continue

            raise_if_job_cancelled(job_id)
            publish_dead_letter(job, error_message, MAX_PROCESSING_ATTEMPTS)
            update_job_status(
                job_id,
                WORKER_ID,
                "FAILED",
                0,
                error_message=error_message,
            )
            print(
                f"Job {job_id} marked as FAILED "
                "and sent to the dead-letter topic"
            )


def handle_job(
    job: dict,
    shutdown_requested: Callable[[], bool],
) -> bool:
    job_id = job["jobId"]
    job_was_claimed, current_status = wait_for_job_claim(
        job_id,
        shutdown_requested,
    )

    if shutdown_requested():
        return False

    if current_status is None:
        print(f"Skipping unknown job {job_id}")
        return True

    if not job_was_claimed:
        print(
            f"Skipping job {job_id}; its current status is "
            f"{current_status} and it is not available to claim"
        )
        return True

    job_workspace = WORK_DIR / job_id

    try:
        # JobLeaseHeartbeat updates processing_heartbeat_at in a background
        # thread while Demucs runs. If this worker dies, updates stop; after the
        # configured lease timeout another worker is allowed to reclaim the job.
        with JobLeaseHeartbeat(job_id, WORKER_ID):
            _run_attempts(job)
    except JobCancelled:
        print(f"Job {job_id} processing stopped after cancellation")
    finally:
        if job_workspace is not None:
            shutil.rmtree(job_workspace, ignore_errors=True)

    return True
