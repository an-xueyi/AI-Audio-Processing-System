-- Store permanent account identity separately from temporary login sessions.
-- A user row contains a password hash, never the original password.
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT users_username_length CHECK (char_length(username) BETWEEN 3 AND 30),
    CONSTRAINT users_username_normalized CHECK (username = lower(username))
);

-- Usernames are case-insensitive because the application stores them in lower
-- case before insertion. The unique index prevents two accounts from claiming
-- the same normalized name, even when requests arrive at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
ON users (username);

-- A login session represents one browser that has successfully authenticated.
-- token_hash is a SHA-256 fingerprint of the random cookie token. If database
-- rows are exposed, they cannot be copied directly into a browser and reused.
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT user_sessions_token_hash_length CHECK (char_length(token_hash) = 64)
);

-- Authentication looks up a session by token hash on nearly every protected
-- request. This partial index keeps active-session lookup fast while excluding
-- rows that have already been logged out.
CREATE INDEX IF NOT EXISTS idx_user_sessions_active_token
ON user_sessions (token_hash, expires_at)
WHERE revoked_at IS NULL;

-- This index makes administrative cleanup of a user's sessions inexpensive.
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
ON user_sessions (user_id);
