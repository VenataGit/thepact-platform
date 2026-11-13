-- 071_content_agent_format_pitch.sql
-- Каталогът с формати по-сбит и по-лесен за търсене (Венци, 13.11.2026): всеки формат
-- получава „pitch" — едно конкретно изречение какво точно се вижда/прави (като описание
-- на тренд: „Човек сочи нагоре: 'Ако имаш това' — с другата ръка: 'Направи това'") — и
-- категория за филтриране.
--
-- ВНИМАНИЕ: създава се и от кода (src/services/content-agent/store.js #ensureSchema).

ALTER TABLE ca_formats ADD COLUMN IF NOT EXISTS pitch TEXT NOT NULL DEFAULT '';
ALTER TABLE ca_formats ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';
