"""Write consistent one-line JSON logs for worker lifecycle events."""

import json
import os
from datetime import datetime, timezone

from config import WORKER_ID

# Docker can override SERVICE_NAME, while manual execution receives a clear default.
SERVICE_NAME = os.getenv("SERVICE_NAME", "worker")


def log_event(level: str, event: str, **fields) -> None:
    """Serialize one event so humans and log tools can read the same output."""
    # `default=str` safely represents exceptions, pathlib paths, and other useful
    # diagnostic objects that Python's JSON encoder does not support directly.
    record = {
        **fields,
        # Fixed fields are assigned last so a caller cannot accidentally replace
        # the timestamp, severity, service identity, worker identity, or event.
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "service": SERVICE_NAME,
        "workerId": WORKER_ID,
        "event": event,
    }

    # One JSON object per line works with `docker compose logs` now and can be
    # ingested by a future log system without changing application code.
    print(json.dumps(record, default=str, separators=(",", ":")), flush=True)


def log_info(event: str, **fields) -> None:
    """Record expected lifecycle information."""
    log_event("info", event, **fields)


def log_warning(event: str, **fields) -> None:
    """Record recoverable or unusual behavior that deserves attention."""
    log_event("warn", event, **fields)


def log_error(event: str, **fields) -> None:
    """Record an operation that failed and may need investigation."""
    log_event("error", event, **fields)

