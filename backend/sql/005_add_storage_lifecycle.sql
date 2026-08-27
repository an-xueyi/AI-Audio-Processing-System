-- Migration 005 records when a terminal job's private audio objects expire and
-- coordinates safe cleanup when more than one cleanup process is running.
ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS storage_expires_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS storage_deleted_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS cleanup_claim_id UUID,
ADD COLUMN IF NOT EXISTS cleanup_claimed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS cleanup_attempts INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS cleanup_error_message TEXT;

-- Existing terminal jobs were created before storage expiration existed. Give
-- them a complete seven-day grace period from migration time instead of making
-- old files disappear immediately when the cleanup service first starts.
UPDATE jobs
SET storage_expires_at = NOW() + INTERVAL '7 days'
WHERE status IN ('COMPLETED', 'FAILED', 'CANCELLED')
  AND storage_expires_at IS NULL;

-- The cleanup service repeatedly searches only undeleted expired rows. A partial
-- index remains small because already-cleaned and active jobs are excluded.
CREATE INDEX IF NOT EXISTS idx_jobs_expired_storage_cleanup
ON jobs (storage_expires_at)
WHERE storage_deleted_at IS NULL
  AND storage_expires_at IS NOT NULL;

