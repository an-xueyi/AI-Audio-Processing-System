"""Keep a database job lease alive while the main thread runs Demucs."""

import threading

from config import JOB_HEARTBEAT_INTERVAL_SECONDS
from database import refresh_job_lease


class JobLeaseHeartbeat:
    """Context manager that owns the lifecycle of one heartbeat thread."""

    def __init__(self, job_id: str, worker_id: str):
        self.job_id = job_id
        self.worker_id = worker_id
        # Event provides a thread-safe stop signal. wait(timeout) below also lets
        # the thread sleep without using a busy loop that consumes CPU.
        self.stop_event = threading.Event()
        self.thread = threading.Thread(
            target=self.run,
            name=f"job-lease-{job_id}",
            # A daemon thread cannot keep the Python process alive by itself.
            daemon=True,
        )

    def __enter__(self):
        # `with JobLeaseHeartbeat(...):` calls __enter__ before job processing.
        self.thread.start()
        return self

    def __exit__(self, _error_type, _error, _traceback):
        # __exit__ runs for normal completion and exceptions, guaranteeing that
        # the background thread is signaled and joined before leaving the block.
        self.stop_event.set()
        self.thread.join()

    def run(self) -> None:
        """Refresh ownership periodically until stopped or ownership is lost."""
        while not self.stop_event.wait(JOB_HEARTBEAT_INTERVAL_SECONDS):
            try:
                # The database update succeeds only while worker_id still owns an
                # active PROCESSING or RETRYING job.
                lease_was_refreshed = refresh_job_lease(
                    self.job_id,
                    self.worker_id,
                )

                if not lease_was_refreshed:
                    # Another worker, cancellation, or terminal status made this
                    # heartbeat obsolete; end this thread permanently.
                    print(
                        f"Worker {self.worker_id} lost the lease "
                        f"for job {self.job_id}"
                    )
                    return
            except Exception as error:
                # A temporary database error is logged but does not immediately end
                # the thread; a later interval may refresh before lease expiration.
                print(
                    f"Worker {self.worker_id} could not refresh the lease "
                    f"for job {self.job_id}: {error}"
                )
