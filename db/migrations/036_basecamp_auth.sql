-- 036_basecamp_auth.sql
-- Basecamp OAuth ("Connect with Basecamp" login).
-- Links a platform user to their Basecamp identity and stores per-user OAuth tokens.

-- 1. OAuth-only users have no password — allow NULL password_hash.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 2. Link a platform user to their Basecamp identity + account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS basecamp_user_id    BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS basecamp_account_id BIGINT;

-- One platform user per Basecamp identity (NULLs allowed for legacy/password users).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_basecamp_user_id
    ON users(basecamp_user_id) WHERE basecamp_user_id IS NOT NULL;

-- 3. Per-user Basecamp OAuth tokens (kept out of the users table and the JWT).
CREATE TABLE IF NOT EXISTS basecamp_tokens (
    user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token        TEXT NOT NULL,
    refresh_token       TEXT,
    expires_at          TIMESTAMPTZ,
    basecamp_account_id BIGINT,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
