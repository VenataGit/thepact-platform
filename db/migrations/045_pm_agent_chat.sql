-- 045_pm_agent_chat.sql
-- PM Agent Фаза 2-4: чат история + дедуп на watchdog алармите.

-- Чат с агента (един активен разговор; "Нов разговор" архивира стария).
-- content = Claude content blocks (text / tool_use / tool_result) — пазим ги
-- 1:1, за да може разговорът да продължи коректно след рестарт.
CREATE TABLE IF NOT EXISTS agent_chat_messages (
    id         SERIAL PRIMARY KEY,
    role       TEXT NOT NULL,               -- 'user' | 'assistant'
    content    JSONB NOT NULL,
    archived   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_chat_active ON agent_chat_messages(archived, id);

-- Watchdog аларми — една аларма на клиентски запис (никога повторно).
CREATE TABLE IF NOT EXISTS agent_alerts (
    id         SERIAL PRIMARY KEY,
    kind       TEXT NOT NULL,               -- 'client_waiting'
    ref_key    TEXT NOT NULL UNIQUE,        -- напр. 'comment:12345' / 'message:678' / 'campfire:90'
    project_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
