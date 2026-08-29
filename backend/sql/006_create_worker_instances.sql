-- Migration 006 records which worker containers are currently available.
-- Job leases answer "who owns this job?"; this table separately answers
-- "which worker processes are alive, and are they idle or busy?"
CREATE TABLE IF NOT EXISTS worker_instances (
    -- Docker gives every container a unique hostname, which the worker uses as
    -- its stable identity for the lifetime of that container.
    worker_id TEXT PRIMARY KEY,
    -- IDLE means the worker is waiting for Kafka; BUSY means it currently owns
    -- a Kafka message. A database constraint rejects misspelled states.
    status TEXT NOT NULL,
    -- This nullable relationship identifies the current job without copying any
    -- filename, object-storage key, or other private job data into this table.
    current_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    -- Each worker stores its own timeout so diagnostics and health checks use
    -- the same rule even if a deployment changes the configured duration.
    heartbeat_timeout_seconds INTEGER NOT NULL,
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_heartbeat_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT worker_instances_status_check
        CHECK (status IN ('IDLE', 'BUSY')),
    CONSTRAINT worker_instances_heartbeat_timeout_check
        CHECK (heartbeat_timeout_seconds > 0)
);

-- Operational queries repeatedly compare this timestamp with the timeout, so
-- an index avoids scanning every historical stale row as the table grows.
CREATE INDEX IF NOT EXISTS idx_worker_instances_heartbeat
ON worker_instances (last_heartbeat_at);
