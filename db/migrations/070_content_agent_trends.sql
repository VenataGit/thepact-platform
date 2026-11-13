-- 070_content_agent_trends.sql
-- „Ловецът на трендове" (Венци, 13.11.2026): с един бутон търси какво е вайръл в момента
-- (Google Trends за България и света, най-гледаното в YouTube, какво избухва в нашата
-- библиотека) и агент + проверител го превръщат в трендове с идеи за клиентите.
-- Всяко търсене се пази (история).
--
-- ВНИМАНИЕ: създава се и от кода (src/services/content-agent/store.js #ensureSchema).

CREATE TABLE IF NOT EXISTS ca_trends (
    id          SERIAL PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'running',   -- running | done | error
    created_by  TEXT NOT NULL DEFAULT '',
    summary     TEXT NOT NULL DEFAULT '',
    items       JSONB NOT NULL DEFAULT '[]'::jsonb, -- трендовете
    sources     JSONB NOT NULL DEFAULT '{}'::jsonb, -- суровите сигнали (за проверка)
    error       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);
