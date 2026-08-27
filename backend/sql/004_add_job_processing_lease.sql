-- Migration 004 adds worker ownership and heartbeat data for safe redelivery.
ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS processing_worker_id TEXT,
ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS processing_heartbeat_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_jobs_processing_lease
ON jobs (processing_heartbeat_at)
-- Completed, failed, and cancelled jobs never need lease-expiration searches.
WHERE status IN ('PROCESSING', 'RETRYING');
