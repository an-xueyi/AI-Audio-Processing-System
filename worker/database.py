import json
import psycopg
from config import DATABASE_URL


def get_job_status(job_id: str) -> str | None:
    if DATABASE_URL is None:
        raise RuntimeError("DATABASE_URL is missing")

    with psycopg.connect(DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT status FROM jobs WHERE id = %s",
                (job_id,),
            )
            result = cursor.fetchone()

    return result[0] if result else None


def update_job_status(
    job_id: str,
    status: str,
    progress: int,
    result_keys: dict | None = None,
    error_message: str | None = None,
) -> None:
    if DATABASE_URL is None:
        raise RuntimeError("DATABASE_URL is missing")

    with psycopg.connect(DATABASE_URL) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE jobs
                SET status = %s,
                    progress = %s,
                    result_object_keys = COALESCE(%s::jsonb, result_object_keys),
                    error_message = %s,
                    updated_at = NOW()
                WHERE id = %s
                """,
                (
                    status,
                    progress,
                    json.dumps(result_keys) if result_keys else None,
                    error_message,
                    job_id,
                ),
            )
