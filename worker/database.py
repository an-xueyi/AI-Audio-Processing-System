import json

import psycopg

from cancellation import JobCancelled
from config import DATABASE_URL, JOB_STATUS_TOPIC


def require_database_url() -> str:
    if DATABASE_URL is None:
        raise RuntimeError("DATABASE_URL is missing")

    return DATABASE_URL


def is_job_cancelled(job_id: str) -> bool:
    with psycopg.connect(require_database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT status FROM jobs WHERE id = %s", (job_id,))
            job = cursor.fetchone()

    return job is not None and job[0] == "CANCELLED"


def enqueue_job_status_event(cursor, job_id: str) -> None:
    cursor.execute(
        """
        INSERT INTO outbox_events (topic, event_key, payload)
        VALUES (%s, %s, jsonb_build_object('jobId', %s::text))
        """,
        (JOB_STATUS_TOPIC, job_id, job_id),
    )


def claim_job(
    job_id: str,
    worker_id: str,
    lease_timeout_seconds: int,
) -> tuple[bool, str | None]:
    with psycopg.connect(require_database_url()) as connection:
        with connection.cursor() as cursor:
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
                (worker_id, job_id, lease_timeout_seconds),
            )
            claimed_job = cursor.fetchone()

            if claimed_job is not None:
                enqueue_job_status_event(cursor, job_id)
                return True, claimed_job[0]

            cursor.execute(
                "SELECT status FROM jobs WHERE id = %s",
                (job_id,),
            )
            existing_job = cursor.fetchone()

    return False, existing_job[0] if existing_job else None


def begin_job_attempt(job_id: str, worker_id: str) -> int:
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
                enqueue_job_status_event(cursor, job_id)

    if result is None:
        raise RuntimeError(f"Worker {worker_id} no longer owns job {job_id}")

    return result[0]


def refresh_job_lease(job_id: str, worker_id: str) -> bool:
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
    serialized_result_keys = (
        json.dumps(result_keys) if result_keys is not None else None
    )

    with psycopg.connect(require_database_url()) as connection:
        with connection.cursor() as cursor:
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
            job_was_updated = cursor.rowcount == 1

            if job_was_updated:
                enqueue_job_status_event(cursor, job_id)

    if not job_was_updated and is_job_cancelled(job_id):
        raise JobCancelled(f"Job {job_id} was cancelled")

    if not job_was_updated:
        raise RuntimeError(f"Worker {worker_id} no longer owns job {job_id}")
