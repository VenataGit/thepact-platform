-- 040_gcal_alerts.sql
-- Google Calendar → Basecamp „Календар известия".
-- Следени календари, отговорници по календар, мапинг Google имейл ↔ потребител
-- и лог на обявените събития (за дедупликация + Фаза 2 коментари при промяна/отмяна).

CREATE TABLE IF NOT EXISTS gcal_feeds (
    id                 SERIAL PRIMARY KEY,
    google_calendar_id TEXT NOT NULL UNIQUE,
    name               TEXT NOT NULL DEFAULT '',
    enabled            BOOLEAN NOT NULL DEFAULT TRUE,
    sync_token         TEXT,
    last_sync_at       TIMESTAMPTZ,
    last_error         TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Кой „отговаря" за календара (бива тагван във всяко известие) — не е свързано с права.
CREATE TABLE IF NOT EXISTS gcal_feed_responsibles (
    feed_id INT NOT NULL REFERENCES gcal_feeds(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (feed_id, user_id)
);

-- Ръчни съответствия, когато Google имейлът на човека е различен от Basecamp имейла.
CREATE TABLE IF NOT EXISTS gcal_person_map (
    google_email TEXT PRIMARY KEY,
    user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

-- Едно ред = едно обявено Google събитие (или инстанция на серия).
-- bc_message_id сочи Basecamp съобщението, под което Фаза 2 пише коментари.
CREATE TABLE IF NOT EXISTS gcal_event_log (
    id              SERIAL PRIMARY KEY,
    feed_id         INT NOT NULL REFERENCES gcal_feeds(id) ON DELETE CASCADE,
    google_event_id TEXT NOT NULL,
    bc_message_id   BIGINT,
    bc_project_id   BIGINT,
    title           TEXT,
    fingerprint     TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (feed_id, google_event_id)
);

-- Настройки по подразбиране: Message Board „Календар известия" във Video Production.
INSERT INTO settings (key, value, updated_at) VALUES
    ('gcal_alerts_enabled',      'true',        NOW()),
    ('gcal_alerts_bc_project',   '39396506',    NOW()),
    ('gcal_alerts_bc_board',     '10063680113', NOW()),
    ('gcal_alerts_bc_board_url', 'https://3.basecamp.com/5750544/buckets/39396506/message_boards/10063680113', NOW())
ON CONFLICT (key) DO NOTHING;

-- Първи следен календар (общият) — очаква споделяне със service account-а.
INSERT INTO gcal_feeds (google_calendar_id, name)
VALUES ('cr90ust7ppvp8g1nt4op392vro@group.calendar.google.com', 'Общ календар')
ON CONFLICT (google_calendar_id) DO NOTHING;
