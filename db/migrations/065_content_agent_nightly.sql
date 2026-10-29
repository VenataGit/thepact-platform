-- 065_content_agent_nightly.sql
-- Нощното YouTube търсене (всяка нощ в 01:00): курсорите на търсенията (докъде е стигнало
-- всяко търсене, за да намира нови неща всяка нощ) и резултатът от последната нощ.
--
-- ВНИМАНИЕ: създава се и от кода (src/services/content-agent/store.js #ensureSchema).

ALTER TABLE ca_search ADD COLUMN IF NOT EXISTS nightly JSONB NOT NULL DEFAULT '{}'::jsonb;
