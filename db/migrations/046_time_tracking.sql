-- 046_time_tracking.sql
-- Тракване на време през The Pact Tools разширението (+ ръчни корекции).
-- Един запис = един непрекъснат сегмент работа по Basecamp задача/карта.
-- Работещ таймер = ред с ended_at IS NULL; разширението праща heartbeat (~30s),
-- а сървърен sweeper затваря записи без пулс към последния beat — така времето
-- е достоверно дори при затворен таб/забил браузър. "Пауза" = затворен сегмент
-- (stopped_by='pause'); продължаване = нов запис към същата задача.

-- Старите незадействани скици от schema.sql (card_id-базирани, никога ползвани
-- от код и никога създавани от миграция) се махат, за да няма разминаване при
-- fresh bootstrap.
DROP TABLE IF EXISTS active_timers;
DROP TABLE IF EXISTS time_entries;

CREATE TABLE time_entries (
    id               SERIAL PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bc_project_id    BIGINT,                        -- Basecamp bucket (проект → клиент)
    bc_recording_id  BIGINT,                        -- Basecamp todo/card id
    recording_type   TEXT NOT NULL DEFAULT '',      -- todos | cards | ...
    title            TEXT NOT NULL DEFAULT '',      -- заглавие към момента на старта
    url              TEXT NOT NULL DEFAULT '',      -- линк към задачата в Basecamp
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at         TIMESTAMPTZ,                   -- NULL = таймерът върви
    last_beat        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_seconds INTEGER,                       -- попълва се при стоп
    is_manual        BOOLEAN NOT NULL DEFAULT FALSE,-- ръчно добавен/коригиран запис
    stopped_by       TEXT NOT NULL DEFAULT '',      -- user | pause | switch | unload | sweeper
    note             TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Един работещ таймер на човек (старт на нова задача спира стария сегмент).
CREATE UNIQUE INDEX idx_time_entries_one_running
    ON time_entries(user_id) WHERE ended_at IS NULL;
CREATE INDEX idx_time_entries_user_started ON time_entries(user_id, started_at);
CREATE INDEX idx_time_entries_recording    ON time_entries(bc_recording_id);
CREATE INDEX idx_time_entries_project      ON time_entries(bc_project_id);
CREATE INDEX idx_time_entries_started      ON time_entries(started_at);

-- Дълготрайни токени за разширението (Authorization: Bearer pt_...).
-- Пази се само SHA-256 отпечатък; самият токен се показва еднократно при издаване.
CREATE TABLE extension_tokens (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    label        TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);
CREATE INDEX idx_extension_tokens_user ON extension_tokens(user_id);
