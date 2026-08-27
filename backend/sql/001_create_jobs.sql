-- Migration 001 creates the main table that tracks an audio job's lifecycle.
-- IF NOT EXISTS makes this setup safe to run again on an initialized database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS jobs (
    -- PostgreSQL generates the UUID, so API callers cannot choose primary keys.
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_file_name TEXT NOT NULL,
    input_object_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    progress INTEGER NOT NULL DEFAULT 0,
    -- JSONB stores a flexible map such as {"vocals": "results/.../vocals.wav"}.
    result_object_keys JSONB,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
