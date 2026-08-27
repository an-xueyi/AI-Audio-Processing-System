-- Migration 002 implements the transactional outbox between PostgreSQL and Kafka.
CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic TEXT NOT NULL,
    event_key TEXT NOT NULL,
    -- payload is the JSON message that the publisher later sends to Kafka.
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    published_at TIMESTAMP,
    CONSTRAINT outbox_events_status_check
        CHECK (status IN  ('PENDING', 'PUBLISHED'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_pending
ON outbox_events (created_at)
-- A partial index stores only unpublished rows, keeping the publisher's frequent
-- pending-event query small after old events have been published.
WHERE status = 'PENDING';
