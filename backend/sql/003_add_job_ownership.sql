-- Migration 003 associates every job with one signed browser session UUID.
ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS owner_id UUID;

-- Existing rows predate ownership and need a value before NOT NULL can be added.
UPDATE jobs
SET owner_id = gen_random_uuid()
WHERE owner_id IS NULL;

ALTER TABLE jobs
ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_owner_id_created_at
-- This supports listing one owner's newest jobs without scanning other users.
ON jobs (owner_id, created_at DESC);
