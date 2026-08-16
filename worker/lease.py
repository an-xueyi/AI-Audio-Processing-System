import threading

from config import JOB_HEARTBEAT_INTERVAL_SECONDS
from database import refresh_job_lease


class JobLeaseHeartbeat:
    def __init__(self, job_id: str, worker_id: str):
        self.job_id = job_id
        self.worker_id = worker_id
        self.stop_event = threading.Event()
        self.thread = threading.Thread(
            target=self.run,
            name=f"job-lease-{job_id}",
            daemon=True,
        )

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, _error_type, _error, _traceback):
        self.stop_event.set()
        self.thread.join()

    def run(self) -> None:
        while not self.stop_event.wait(JOB_HEARTBEAT_INTERVAL_SECONDS):
            try:
                lease_was_refreshed = refresh_job_lease(
                    self.job_id,
                    self.worker_id,
                )

                if not lease_was_refreshed:
                    print(
                        f"Worker {self.worker_id} lost the lease "
                        f"for job {self.job_id}"
                    )
                    return
            except Exception as error:
                print(
                    f"Worker {self.worker_id} could not refresh the lease "
                    f"for job {self.job_id}: {error}"
                )
