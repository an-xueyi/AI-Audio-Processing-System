from cancellation import JobCancelled
from database import is_job_cancelled


def raise_if_job_cancelled(job_id: str) -> None:
    if is_job_cancelled(job_id):
        raise JobCancelled(f"Job {job_id} was cancelled")
