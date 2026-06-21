-- 037_basecamp_service.sql
-- Stores the ThePactAlerts service-account OAuth token (single row).
-- Automated Basecamp actions (create/move cards) run AS this bot so real people
-- don't get auto-subscribed. Connected once by an admin via /auth/basecamp/service.

CREATE TABLE IF NOT EXISTS basecamp_service_account (
    id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    person_id       BIGINT,
    person_name     TEXT,
    person_email    TEXT,
    account_id      BIGINT,
    access_token    TEXT NOT NULL,
    refresh_token   TEXT,
    expires_at      TIMESTAMPTZ,
    connected_by    INTEGER REFERENCES users(id),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
