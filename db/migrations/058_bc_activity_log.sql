-- 058_bc_activity_log.sql
-- Дневник на Docs&Files/Message Board/To-dos в Basecamp — създаване, редакция,
-- изтриване. Разширение на историята отвъд Kanban::Card (виж 057_card_text_log).
--
-- ВНИМАНИЕ: миграциите в тази папка НЕ се прилагат автоматично при deploy —
-- реалното създаване на таблицата е в кода (src/services/bc-activity-log.js
-- #ensureSchema, извиква се сам при първо писане). Този файл е само за документация.

CREATE TABLE IF NOT EXISTS bc_activity_log (
    id             BIGSERIAL PRIMARY KEY,
    project_id     BIGINT NOT NULL,
    recording_type TEXT NOT NULL,        -- Document | Upload | Message | Todo
    recording_id   BIGINT NOT NULL,
    event          TEXT NOT NULL,        -- created | updated | deleted | completed
    field          TEXT NOT NULL DEFAULT '', -- content | title | ''
    title          TEXT NOT NULL DEFAULT '',
    parent_title   TEXT NOT NULL DEFAULT '', -- папка / message board / to-do лист
    old_text       TEXT NOT NULL DEFAULT '',
    new_text       TEXT NOT NULL DEFAULT '',
    who_id         BIGINT,
    who_name       TEXT NOT NULL DEFAULT '',
    app_url        TEXT NOT NULL DEFAULT '',
    bc_updated_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bc_activity_log_created ON bc_activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bc_activity_log_project ON bc_activity_log (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bc_activity_log_rec ON bc_activity_log (recording_type, recording_id, created_at DESC);

-- Снапшот на Docs & Files (документи + файлове), за диф/изтриване (виж pm-agent/snapshot.js).
CREATE TABLE IF NOT EXISTS bc_vault_snap (
    item_id       BIGINT PRIMARY KEY,
    project_id    BIGINT NOT NULL,
    vault_id      BIGINT,
    kind          TEXT NOT NULL,          -- document | upload
    title         TEXT NOT NULL DEFAULT '',
    content       TEXT NOT NULL DEFAULT '', -- само documents; uploads са двоични
    app_url       TEXT NOT NULL DEFAULT '',
    bc_created_at TIMESTAMPTZ,
    bc_updated_at TIMESTAMPTZ,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bc_vault_snap_project ON bc_vault_snap(project_id);

-- Изтриването на съобщения/задачи се засича чрез сравнение с активния снапшот —
-- нужна е колона `active`, каквато вече имаше bc_cards_snap.
ALTER TABLE bc_messages_snap ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE bc_todos_snap ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
