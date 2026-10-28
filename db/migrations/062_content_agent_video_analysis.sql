-- 062_content_agent_video_analysis.sql
-- Анализ на самите видеа: сваляне (yt-dlp) → Whisper транскрипт → кадри от първите
-- секунди + смени на кадъра (ffmpeg) → агент „Анализатор на видео" (Claude, вижда кадрите)
-- + проверител. Пази се към видеото — анализира се веднъж и се ползва от всички клиенти.
--
-- ВНИМАНИЕ: създава се и от кода (src/services/content-agent/store.js #ensureSchema).

ALTER TABLE ca_videos ADD COLUMN IF NOT EXISTS analysis JSONB;
ALTER TABLE ca_videos ADD COLUMN IF NOT EXISTS transcript TEXT;
ALTER TABLE ca_videos ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMPTZ;
ALTER TABLE ca_videos ADD COLUMN IF NOT EXISTS analysis_error TEXT;
