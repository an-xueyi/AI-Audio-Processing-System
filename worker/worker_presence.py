"""Maintain one worker's registry heartbeat in a lightweight background thread."""

import threading

from config import (
    WORKER_HEARTBEAT_INTERVAL_SECONDS,
    WORKER_ID,
    WORKER_STALE_AFTER_SECONDS,
)
from observability import log_error, log_info, log_warning
from worker_registry import (
    refresh_worker_heartbeat,
    register_worker,
    set_worker_activity,
    unregister_worker,
)


class WorkerPresence:
    """Register, heartbeat, and report activity for this worker container."""

    def __init__(self) -> None:
        # Event is both a thread-safe stop signal and an interruptible sleep tool.
        self.stop_event = threading.Event()
        self.thread = threading.Thread(
            target=self._run,
            name="worker-presence-heartbeat",
            # A daemon thread cannot keep a shutting-down worker alive by itself.
            daemon=True,
        )

    def start(self) -> None:
        """Create the durable registry row before Kafka begins delivering jobs."""
        # Startup registration is allowed to raise. Docker should restart a worker
        # that cannot establish its required PostgreSQL presence record.
        register_worker(WORKER_ID, WORKER_STALE_AFTER_SECONDS)
        self.thread.start()
        log_info(
            "worker_presence_registered",
            heartbeatIntervalSeconds=WORKER_HEARTBEAT_INTERVAL_SECONDS,
            staleAfterSeconds=WORKER_STALE_AFTER_SECONDS,
        )

    def _run(self) -> None:
        """Refresh last-seen time until the main worker asks this thread to stop."""
        while not self.stop_event.wait(WORKER_HEARTBEAT_INTERVAL_SECONDS):
            try:
                if not refresh_worker_heartbeat(WORKER_ID):
                    # A missing row is unusual but recoverable. Re-registering
                    # keeps the running worker visible after accidental deletion.
                    log_warning("worker_presence_row_missing")
                    register_worker(WORKER_ID, WORKER_STALE_AFTER_SECONDS)
            except Exception as error:
                # Do not crash active Demucs inference for one failed visibility
                # update. Docker health will become unhealthy if failures continue.
                log_error("worker_presence_heartbeat_failed", error=str(error))

    def mark_busy(self, job_id: str) -> None:
        """Record that this worker is occupied by one Kafka job message."""
        self._set_activity("BUSY", job_id)

    def mark_idle(self) -> None:
        """Record that the worker has finished handling its current message."""
        self._set_activity("IDLE", None)

    def _set_activity(self, status: str, job_id: str | None) -> None:
        """Update activity without making observability failure fail the job."""
        try:
            if not set_worker_activity(WORKER_ID, status, job_id):
                # The heartbeat thread will also repair this, but registering now
                # makes the state correction immediate.
                register_worker(WORKER_ID, WORKER_STALE_AFTER_SECONDS)
                set_worker_activity(WORKER_ID, status, job_id)

            log_info(
                "worker_activity_changed",
                workerStatus=status,
                **({"jobId": job_id} if job_id else {}),
            )
        except Exception as error:
            log_error(
                "worker_activity_update_failed",
                workerStatus=status,
                error=str(error),
            )

    def stop(self) -> None:
        """Stop heartbeats and remove this gracefully terminating worker row."""
        self.stop_event.set()
        self.thread.join()

        try:
            unregister_worker(WORKER_ID)
            log_info("worker_presence_unregistered")
        except Exception as error:
            # Shutdown must continue even if PostgreSQL is already unavailable.
            log_error("worker_presence_unregister_failed", error=str(error))
