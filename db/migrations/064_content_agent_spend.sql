-- 064_content_agent_spend.sql
-- Разход в Apify по клиент (точната цена на всяко пускане — usageTotalUsd от Apify).
-- Лимитът е настройка ca_apify_budget_usd (по подразбиране $5 на клиент, по Венци 29.10.2026).
--
-- ВНИМАНИЕ: създава се и от кода (src/services/content-agent/store.js #ensureSchema).

CREATE TABLE IF NOT EXISTS ca_spend (
    id          SERIAL PRIMARY KEY,
    client_id   INTEGER,                 -- за кой клиент е пуснато (NULL = без клиент)
    source      TEXT NOT NULL DEFAULT '', -- discover | profiles | library
    actor       TEXT NOT NULL DEFAULT '',
    run_id      TEXT NOT NULL DEFAULT '',
    usd         NUMERIC(10,4) NOT NULL DEFAULT 0,
    items       INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ca_spend_client ON ca_spend(client_id);
