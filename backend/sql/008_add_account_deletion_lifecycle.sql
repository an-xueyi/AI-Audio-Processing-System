-- Account deletion must remove private audio without forgetting failed cleanup.
-- This timestamp marks jobs whose owner deleted the account. Their normal job
-- rows remain only until object-storage cleanup confirms every object is gone.
ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS owner_deleted_at TIMESTAMP;

-- The cleanup process already searches storage_expires_at. This additional
-- partial index makes the later removal of deleted-owner job rows inexpensive.
CREATE INDEX IF NOT EXISTS idx_jobs_deleted_owner_cleanup
ON jobs (owner_deleted_at)
WHERE owner_deleted_at IS NOT NULL;

-- Principal resolution periodically removes sessions that can never become
-- valid again. These indexes keep expiration and revocation cleanup bounded.
CREATE INDEX IF NOT EXISTS idx_user_sessions_expiration_cleanup
ON user_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_user_sessions_revocation_cleanup
ON user_sessions (revoked_at)
WHERE revoked_at IS NOT NULL;
