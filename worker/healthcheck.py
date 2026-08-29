"""Exit successfully only when this container has a recent registry heartbeat."""

from config import WORKER_ID
from worker_registry import worker_heartbeat_is_current


def main() -> None:
    # Docker interprets exit code 0 as healthy and any nonzero code as unhealthy.
    # No details are printed because normal health checks run frequently. A
    # database connection error also means the worker is not currently ready.
    try:
        heartbeat_is_current = worker_heartbeat_is_current(WORKER_ID)
    except Exception:
        heartbeat_is_current = False

    if not heartbeat_is_current:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
