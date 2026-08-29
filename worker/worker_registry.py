"""Store worker presence and activity in PostgreSQL without job-private data."""

import psycopg

from database import require_database_url


def register_worker(worker_id: str, stale_after_seconds: int) -> None:
    """Create or reset the registry row when one worker process starts."""
    with psycopg.connect(require_database_url()) as connection:
        with connection.cursor() as cursor:
            # Rows from containers that crashed more than one day ago no longer
            # help current operations. Removing them prevents permanent buildup
            # while preserving recent stale workers for diagnosis.
            cursor.execute(
                """
                DELETE FROM worker_instances
                WHERE last_heartbeat_at < NOW() - INTERVAL '24 hours'
                """
            )

            # ON CONFLICT also supports restarting the same local worker ID. It
            # resets activity instead of creating a duplicate primary-key row.
            cursor.execute(
                """
                INSERT INTO worker_instances (
                    worker_id,
                    status,
                    current_job_id,
                    heartbeat_timeout_seconds,
                    started_at,
                    last_heartbeat_at
                )
                VALUES (%s, 'IDLE', NULL, %s, NOW(), NOW())
                ON CONFLICT (worker_id) DO UPDATE
                SET status = 'IDLE',
                    current_job_id = NULL,
                    heartbeat_timeout_seconds = EXCLUDED.heartbeat_timeout_seconds,
                    started_at = NOW(),
                    last_heartbeat_at = NOW()
                """,
                (worker_id, stale_after_seconds),
            )


def refresh_worker_heartbeat(worker_id: str) -> bool:
    """Advance one worker's last-seen time and report whether its row exists."""
    with psycopg.connect(require_database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE worker_instances
                SET last_heartbeat_at = NOW()
                WHERE worker_id = %s
                """,
                (worker_id,),
            )
            # A zero result means the row was manually removed or never registered.
            return cursor.rowcount == 1


def set_worker_activity(
    worker_id: str,
    status: str,
    current_job_id: str | None,
) -> bool:
    """Change IDLE/BUSY activity while refreshing the same presence record."""
    if status not in {"IDLE", "BUSY"}:
        # Fail before contacting PostgreSQL so programming mistakes are visible.
        raise ValueError(f"Unsupported worker status: {status}")

    with psycopg.connect(require_database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE worker_instances
                SET status = %s,
                    current_job_id = %s,
                    last_heartbeat_at = NOW()
                WHERE worker_id = %s
                """,
                (status, current_job_id, worker_id),
            )
            return cursor.rowcount == 1


def unregister_worker(worker_id: str) -> None:
    """Remove a gracefully stopped worker from the set of current processes."""
    with psycopg.connect(require_database_url()) as connection:
        with connection.cursor() as cursor:
            # Crashed workers cannot call this function, so their rows remain and
            # become stale. That difference makes unexpected failure observable.
            cursor.execute(
                "DELETE FROM worker_instances WHERE worker_id = %s",
                (worker_id,),
            )


def worker_heartbeat_is_current(worker_id: str) -> bool:
    """Return whether PostgreSQL considers this worker recently alive."""
    with psycopg.connect(require_database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT last_heartbeat_at >= NOW() - (
                    heartbeat_timeout_seconds * INTERVAL '1 second'
                )
                FROM worker_instances
                WHERE worker_id = %s
                """,
                (worker_id,),
            )
            result = cursor.fetchone()

    # A missing row is unhealthy; otherwise PostgreSQL returns one Boolean.
    return result is not None and result[0] is True
