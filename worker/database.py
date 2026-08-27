"""Perform worker-owned PostgreSQL operations and enqueue status events."""

import json

import psycopg

from cancellation import JobCancelled
from config import DATABASE_URL, JOB_STATUS_TOPIC


def require_database_url() -> str:
    """Return configured connection text or fail before attempting PostgreSQL."""
    if DATABASE_URL is None:
        raise RuntimeError("DATABASE_URL is missing")

    # This return also narrows the type from str | None to str for type checkers.
    return DATABASE_URL


def is_job_cancelled(job_id: str) -> bool:
    """Read the latest durable cancellation state for a processing checkpoint."""
    # The connection context manager commits on normal exit, rolls back on error,
    # and closes the network connection in both cases.
    with psycopg.connect(require_database_url()) as connection:
        # A cursor sends SQL and reads result rows through this connection.
        with connection.cursor() as cursor:
            cursor.execute("SELECT status FROM jobs WHERE id = %s", (job_id,))
            # fetchone returns one tuple or None when no matching job exists.
            job = cursor.fetchone()

    # Short-circuit `and` avoids reading job[0] when job is None.
    return job is not None and job[0] == "CANCELLED"


def enqueue_job_status_event(cursor, job_id: str) -> None:
    """
    Add a status event using the caller's existing database transaction.

    Reusing the cursor is essential: the job update and notification either both
    commit or both roll back, so clients are never notified about unsaved state.
    """
    cursor.execute(
        """
        INSERT INTO outbox_events (topic, event_key, payload)
        VALUES (%s, %s, jsonb_build_object('jobId', %s::text))
        """,
        # psycopg safely replaces %s placeholders with these values. Values are
        # not inserted into SQL text, which prevents SQL-injection quoting bugs.
        (JOB_STATUS_TOPIC, job_id, job_id),
    )


def claim_job(
    job_id: str,
    worker_id: str,
    lease_timeout_seconds: int,
) -> tuple[bool, str | None]:
    """
    Atomically claim a new job or recover one whose worker lease has expired.

    The conditions are part of the UPDATE itself, so PostgreSQL decides which
    competing worker succeeds. Checking with SELECT and updating later would
    leave a race where two workers could both see an available job.
    """
    with psycopg.connect(require_database_url()) as connection:
        with connection.cursor() as cursor:
            # This single UPDATE handles both first-time claims and recovery of a
            # stale lease. PostgreSQL locks the row while evaluating/updating it.
            cursor.execute(
                """
                UPDATE jobs
                SET status = 'PROCESSING',
                    progress = GREATEST(progress, 10),
                    processing_worker_id = %s,
                    processing_started_at = NOW(),
                    processing_heartbeat_at = NOW(),
                    error_message = NULL,
                    updated_at = NOW()
                WHERE id = %s
                  AND (
                    status = 'PENDING'
                    OR (
                      status IN ('PROCESSING', 'RETRYING')
                      AND (
                        processing_heartbeat_at IS NULL
                        OR processing_heartbeat_at <
                           NOW() - (%s * INTERVAL '1 second')
                      )
                    )
                  )
                RETURNING status
                """,
                # Values correspond in order to the three %s placeholders.
                (worker_id, job_id, lease_timeout_seconds),
            )
            # RETURNING produces one row only when this UPDATE won the claim.
            claimed_job = cursor.fetchone()

            if claimed_job is not None:
                # Use the same cursor so the status event and claim share a commit.
                enqueue_job_status_event(cursor, job_id)
                return True, claimed_job[0]

            # The atomic update did not win. Read current status so the caller can
            # distinguish missing, terminal, and temporarily owned jobs.
            cursor.execute(
                "SELECT status FROM jobs WHERE id = %s",
                (job_id,),
            )
            existing_job = cursor.fetchone()

    # The conditional expression returns status when a row exists and None otherwise.
    return False, existing_job[0] if existing_job else None


def begin_job_attempt(job_id: str, worker_id: str) -> int:
    """Increment durable attempt count after confirming current lease ownership."""
    with psycopg.connect(require_database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE jobs
                SET status = 'PROCESSING',
                    progress = 10,
                    processing_attempts = processing_attempts + 1,
                    processing_heartbeat_at = NOW(),
                    error_message = NULL,
                    updated_at = NOW()
                WHERE id = %s
                  AND processing_worker_id = %s
                  AND status IN ('PROCESSING', 'RETRYING')
                RETURNING processing_attempts
                """,
                (job_id, worker_id),
            )
            result = cursor.fetchone()

            if result is not None:
                # Notify browser clients about PROCESSING and reset progress.
                enqueue_job_status_event(cursor, job_id)

    # No returned row means cancellation, terminal state, or changed worker owner.
    if result is None:
        raise RuntimeError(f"Worker {worker_id} no longer owns job {job_id}")

    # RETURNING processing_attempts provides the newly incremented integer.
    return result[0]


def refresh_job_lease(job_id: str, worker_id: str) -> bool:
    """Advance heartbeat time only while this worker still owns active work."""
    with psycopg.connect(require_database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE jobs
                SET processing_heartbeat_at = NOW()
                WHERE id = %s
                  AND processing_worker_id = %s
                  AND status IN ('PROCESSING', 'RETRYING')
                """,
                (job_id, worker_id),
            )
            # rowcount 1 means one owned job matched; 0 means ownership was lost.
            lease_was_refreshed = cursor.rowcount == 1

    return lease_was_refreshed


def update_job_status(
    job_id: str,
    worker_id: str,
    status: str,
    progress: int,
    result_keys: dict | None = None,
    error_message: str | None = None,
) -> None:
    """
    Update progress only when this worker still owns the job.

    The worker ID in the WHERE clause prevents a worker with an expired lease
    from overwriting work performed by the replacement worker. The status event
    is inserted through the same database transaction and later reaches each
    backend replica through the transactional outbox publisher.
    """
    # PostgreSQL expects JSON text for the explicit ::jsonb cast. Preserve None
    # when this progress update has no result map to replace.
    serialized_result_keys = (
        json.dumps(result_keys) if result_keys is not None else None
    )

    with psycopg.connect(require_database_url()) as connection:
        with connection.cursor() as cursor:
            # COALESCE keeps existing result keys when serialized_result_keys is
            # null. CASE releases ownership only for completed or failed jobs.
            cursor.execute(
                """
                UPDATE jobs
                SET status = %s,
                    progress = %s,
                    result_object_keys = COALESCE(%s::jsonb, result_object_keys),
                    error_message = %s,
                    processing_worker_id = CASE
                      WHEN %s IN ('COMPLETED', 'FAILED') THEN NULL
                      ELSE processing_worker_id
                    END,
                    processing_heartbeat_at = CASE
                      WHEN %s IN ('COMPLETED', 'FAILED') THEN NULL
                      ELSE NOW()
                    END,
                    updated_at = NOW()
                WHERE id = %s
                  AND processing_worker_id = %s
                """,
                (
                    status,
                    progress,
                    serialized_result_keys,
                    error_message,
                    status,
                    status,
                    job_id,
                    worker_id,
                ),
            )
            # The WHERE owner check makes rowcount the authoritative ownership result.
            job_was_updated = cursor.rowcount == 1

            if job_was_updated:
                enqueue_job_status_event(cursor, job_id)

    # Translate a failed owned update into the more specific cancellation signal
    # when the latest database status proves the user cancelled.
    if not job_was_updated and is_job_cancelled(job_id):
        raise JobCancelled(f"Job {job_id} was cancelled")

    # Other zero-row cases indicate a stale or replaced worker lease.
    if not job_was_updated:
        raise RuntimeError(f"Worker {worker_id} no longer owns job {job_id}")
