-- 069_content_agent_formats.sql
-- Каталог с формати (Венци, 13.11.2026): от всяко анализирано успешно видео агентът
-- „Каталогизатор на формати" (+ проверител) разбира какъв е форматът и го слага в общ
-- каталог — име от няколко думи, кратко описание, как да се ползва за клиент — а
-- видеата стават примери към формата. Расте с всяко пускане, търсене и нощ.
--
-- ВНИМАНИЕ: създава се и от кода (src/services/content-agent/store.js #ensureSchema).

CREATE TABLE IF NOT EXISTS ca_formats (
    id           SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,              -- няколко думи
    description  TEXT NOT NULL DEFAULT '',   -- какво се прави, едно изречение
    how_to       TEXT NOT NULL DEFAULT '',   -- как да се пренесе към клиент
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Едно видео — един формат. format_id NULL = прегледано, без ясен формат (не се гледа пак).
CREATE TABLE IF NOT EXISTS ca_format_videos (
    video_id     INTEGER PRIMARY KEY,
    format_id    INTEGER,
    note         TEXT NOT NULL DEFAULT '',   -- как точно видеото прилага формата
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ca_format_videos_format ON ca_format_videos(format_id);
