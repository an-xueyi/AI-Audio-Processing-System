ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS owner_id UUID;

UPDATE jobs
SET owner_id = gen_random_uuid()
WHERE owner_id IS NULL;

ALTER TABLE jobs
ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_owner_id_created_at
ON jobs (owner_id, created_at DESC);
