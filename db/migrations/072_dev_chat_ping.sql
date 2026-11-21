-- 072: Чат ботът слуша и Basecamp Pings (21.11.2026) — Basecamp вече ги дава през API (/circles).
-- Къде да отиде отговорът: bucket + chat на Ping-а. NULL = старият Campfire чат (dev_chat_bc_*).
ALTER TABLE dev_chat ADD COLUMN IF NOT EXISTS reply_bucket BIGINT;
ALTER TABLE dev_chat ADD COLUMN IF NOT EXISTS reply_chat BIGINT;
