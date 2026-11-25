-- 075: Отделен акаунт за личния проект на Венци (25.11.2026) — dev опашка + Ping.
-- ThePactAlerts (basecamp_service_account) остава за автоматизациите към екипа.
-- Свързва се веднъж през /auth/basecamp/devqueue. Същото CREATE е и в services/devqueue-account.js.
CREATE TABLE IF NOT EXISTS basecamp_devqueue_account (
    id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    person_id       BIGINT,
    person_name     TEXT,
    person_email    TEXT,
    account_id      BIGINT,
    access_token    TEXT NOT NULL,
    refresh_token   TEXT,
    expires_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
-- Кой акаунт да отговори на съобщение от Ping: 'devqueue' или NULL (ThePactAlerts).
ALTER TABLE dev_chat ADD COLUMN IF NOT EXISTS reply_as TEXT;
