-- Migration 011: Daily report support + nullable campfire bot messages

-- Allow NULL user_id for system/bot messages in campfire
ALTER TABLE campfire_messages ALTER COLUMN user_id DROP NOT NULL;

-- Settings for daily report (Mon-Fri 9:30 by default)
INSERT INTO settings (key, value) VALUES
  ('daily_report_enabled', 'true'),
  ('daily_report_room_id', '1'),
  ('daily_report_cron', '30 9 * * 1-5')
ON CONFLICT (key) DO NOTHING;
