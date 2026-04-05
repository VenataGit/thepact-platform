-- Migration 021: Google Calendar Integration
-- Adds google_calendar_event_id to schedule_events and settings for GCal config

ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS google_calendar_event_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_schedule_gcal_id ON schedule_events(google_calendar_event_id);

-- Store Google Calendar settings (calendar ID, enabled flag)
INSERT INTO settings (key, value) VALUES
  ('google_calendar_enabled', 'false'),
  ('google_calendar_id', '')
ON CONFLICT (key) DO NOTHING;
