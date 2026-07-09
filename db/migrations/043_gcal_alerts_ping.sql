-- 043_gcal_alerts_ping.sql
-- Календар известия v2: пазим имейла на създателя на събитието (за да можем да го
-- тагваме и при промяна/отмяна, когато Google не праща creator в payload-а) +
-- настройка за Campfire ping (най-близкото до Basecamp Ping, което API-то позволява).

ALTER TABLE gcal_event_log ADD COLUMN IF NOT EXISTS creator_email TEXT;

INSERT INTO settings (key, value, updated_at) VALUES
    ('gcal_alerts_ping_campfire', 'true', NOW())
ON CONFLICT (key) DO NOTHING;
