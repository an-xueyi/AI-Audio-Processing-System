"""Own the reliable job lifecycle: claim, retry, cancel, fail, and clean up."""

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
from observability import log_error, log_info, log_warning
from processing import create_job_workspace, process_audio_job

# Do not wait longer than ten seconds between claim checks, even when retry
# backoff is configured to a larger value.
CLAIM_RETRY_INTERVAL_SECONDS = max(1, min(RETRY_BACKOFF_SECONDS, 10))

# These statuses describe jobs that can no longer be claimed or processed.
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
        # claim_job performs one atomic PostgreSQL UPDATE and reports both whether
        # this worker won and the job's current status.
        job_was_claimed, current_status = claim_job(
            job_id,
            WORKER_ID,
            JOB_LEASE_TIMEOUT_SECONDS,
        )

        # Return immediately on success or when no database row exists.
        if job_was_claimed or current_status is None:
            return job_was_claimed, current_status

        # A completed/failed/cancelled job will never become available later.
        if current_status in TERMINAL_STATUSES:
            return False, current_status

        log_info(
            "job_claim_waiting",
            jobId=job_id,
            currentStatus=current_status,
            retryInSeconds=CLAIM_RETRY_INTERVAL_SECONDS,
        )
        # sleep pauses this worker without consuming CPU before checking the lease again.
        time.sleep(CLAIM_RETRY_INTERVAL_SECONDS)

    # Shutdown interrupted waiting. None here signals the caller to stop its loop.
    return False, None


def _run_attempts(job: dict) -> None:
    """Retry processing failures locally before publishing a dead letter."""
    job_id = job["jobId"]

    # range excludes its upper bound, so +1 includes MAX_PROCESSING_ATTEMPTS.
    for attempt in range(1, MAX_PROCESSING_ATTEMPTS + 1):
        # monotonic measures elapsed time and is not affected if the computer's
        # wall clock changes while a long audio model is running.
        attempt_started_at = time.monotonic()
        # Every attempt starts with a clean directory so failed partial output is removed.
        job_workspace = create_job_workspace(job_id)

        try:
            # PostgreSQL increments its durable counter and confirms this worker
            # still owns the lease before expensive work begins.
            recorded_attempt = begin_job_attempt(job_id, WORKER_ID)
            log_info(
                "job_attempt_started",
                jobId=job_id,
                localAttempt=attempt,
                maxAttempts=MAX_PROCESSING_ATTEMPTS,
                recordedAttempt=recorded_attempt,
            )
            # Successful processing returns permanent private storage keys by stem.
            result_keys = process_audio_job(
                job_id,
                job["inputObjectKey"],
                job_workspace,
                WORKER_ID,
            )
            # Store output keys and terminal progress in one final owned update.
            update_job_status(
                job_id,
                WORKER_ID,
                "COMPLETED",
                100,
                result_keys,
            )
            log_info(
                "job_completed",
                jobId=job_id,
                progress=100,
                attempt=attempt,
                durationSeconds=round(time.monotonic() - attempt_started_at, 2),
            )
            # End the retry loop immediately after successful completion.
            return
        except JobCancelled:
            # Cancellation is handled outside _run_attempts and must never be retried.
            raise
        except Exception as error:
            # Convert the exception to readable text for logs, database, and DLQ.
            error_message = str(error)

            if attempt < MAX_PROCESSING_ATTEMPTS:
                # Linear backoff waits longer after each failure: base, 2*base,
                # and so on. It gives a temporary dependency time to recover.
                delay = RETRY_BACKOFF_SECONDS * attempt
                # RETRYING tells the browser that failure is temporary and another
                # local attempt is planned.
                update_job_status(
                    job_id,
                    WORKER_ID,
                    "RETRYING",
                    10,
                    error_message=error_message,
                )
                log_warning(
                    "job_attempt_retry_scheduled",
                    jobId=job_id,
                    attempt=attempt,
                    retryInSeconds=delay,
                    durationSeconds=round(
                        time.monotonic() - attempt_started_at,
                        2,
                    ),
                    error=error_message,
                )
                time.sleep(delay)
                continue

            # One final cancellation check prevents a late cancellation from being
            # overwritten by FAILED after all processing attempts ended.
            raise_if_job_cancelled(job_id)
            # The dead-letter topic preserves failures that exhausted automatic
            # retries so operators can inspect or replay them deliberately.
            publish_dead_letter(job, error_message, MAX_PROCESSING_ATTEMPTS)
            # After preserving the failure event, store the terminal database state.
            update_job_status(
                job_id,
                WORKER_ID,
                "FAILED",
                0,
                error_message=error_message,
            )
            log_error(
                "job_failed_dead_lettered",
                jobId=job_id,
                attempts=MAX_PROCESSING_ATTEMPTS,
                durationSeconds=round(
                    time.monotonic() - attempt_started_at,
                    2,
                ),
                error=error_message,
            )


def handle_job(
    job: dict,
    shutdown_requested: Callable[[], bool],
) -> bool:
    """Handle one Kafka event and report whether the consumer loop may continue."""
    job_id = job["jobId"]
    job_was_claimed, current_status = wait_for_job_claim(
        job_id,
        shutdown_requested,
    )

    # Leave this Kafka message uncommitted so another worker can receive it later.
    if shutdown_requested():
        return False

    # A message may outlive a manually deleted database row; skip such stale input.
    if current_status is None:
        log_warning("unknown_job_skipped", jobId=job_id)
        return True

    # Terminal or otherwise unavailable jobs are intentionally skipped. Returning
    # True allows main.py to commit this duplicate/stale Kafka event.
    if not job_was_claimed:
        log_info(
            "unavailable_job_skipped",
            jobId=job_id,
            currentStatus=current_status,
        )
        return True

    # Reconstruct the expected path so finally can remove it even if attempt setup fails.
    job_workspace = WORK_DIR / job_id

    try:
        # JobLeaseHeartbeat updates processing_heartbeat_at in a background
        # thread while Demucs runs. If this worker dies, updates stop; after the
        # configured lease timeout another worker is allowed to reclaim the job.
        with JobLeaseHeartbeat(job_id, WORKER_ID):
            _run_attempts(job)
    except JobCancelled:
        # The API already wrote CANCELLED, so the worker only logs and cleans files.
        log_info("job_cancelled_during_processing", jobId=job_id)
    finally:
        # finally runs after success, cancellation, and failure. Temporary audio
        # can be large, so cleanup must not depend on the happy path.
        if job_workspace is not None:
            shutil.rmtree(job_workspace, ignore_errors=True)

    # main.py may now commit the Kafka offset because this event is fully handled.
    return True
