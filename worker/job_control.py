"""Provide the cancellation checkpoint called between expensive job stages."""

from cancellation import JobCancelled
from database import is_job_cancelled


def raise_if_job_cancelled(job_id: str) -> None:
    # Raising unwinds the current processing call immediately. job_handler.py
    # catches this specific exception and avoids retrying or dead-lettering it.
    if is_job_cancelled(job_id):
        raise JobCancelled(f"Job {job_id} was cancelled")
