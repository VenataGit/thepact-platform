-- 061_content_agent_library.sql
-- Обща библиотека с открити профили и видеа (за всички клиенти).
--
-- Откривателят търси сам нови профили (TikTok/Instagram хаштагове, YouTube търсене на
-- български и английски) по ключовите думи на клиента. Откритите профили са ОБЩИ:
-- ca_profiles с client_id = 0 и role = 'library', видеата им — ca_videos с client_id = 0.
-- topics пази думите, по които са намерени — така друг клиент със сходна ниша ги
-- ползва директно от базата, без да се пуска скрейпър отново.
--
-- ВНИМАНИЕ: създава се и от кода (src/services/content-agent/store.js #ensureSchema).

ALTER TABLE ca_profiles ADD COLUMN IF NOT EXISTS topics TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE ca_profiles ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT '';
ALTER TABLE ca_profiles ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_ca_profiles_topics ON ca_profiles USING GIN (topics);

-- Думите за търсене на всеки клиент (измисля ги агентът, пазят се, за да не се
-- генерират всеки път) + кога е търсено последно.
CREATE TABLE IF NOT EXISTS ca_search (
    client_id          INTEGER PRIMARY KEY,
    terms              JSONB NOT NULL DEFAULT '{}'::jsonb,
    terms_updated_at   TIMESTAMPTZ,
    last_discovery_at  TIMESTAMPTZ,
    last_result        JSONB NOT NULL DEFAULT '{}'::jsonb
);
