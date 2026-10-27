-- 060_content_agent_history.sql
-- История на промените в паметта и профилите на клиентите (Content агент):
-- кой, кога, какво е било преди и какво стана. Админ може да върне всяко състояние.
--
-- ВНИМАНИЕ: таблицата се създава и от кода (src/services/content-agent/store.js #ensureSchema).

CREATE TABLE IF NOT EXISTS ca_history (
    id            BIGSERIAL PRIMARY KEY,
    client_id     INTEGER NOT NULL,
    entity        TEXT NOT NULL,            -- memory | profile
    entity_id     INTEGER NOT NULL,
    action        TEXT NOT NULL,            -- create | update | status | delete | restore
    before        JSONB,                    -- редът преди промяната (null = не е съществувал)
    after         JSONB,                    -- редът след промяната (null = изтрит)
    by_name       TEXT NOT NULL DEFAULT '',
    by_user_id    INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ca_history_client ON ca_history(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ca_history_entity ON ca_history(entity, entity_id);
