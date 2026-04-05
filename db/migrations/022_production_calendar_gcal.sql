-- Migration 022: Add Google Calendar event ID to production_calendar
ALTER TABLE production_calendar ADD COLUMN IF NOT EXISTS google_calendar_event_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_prod_cal_gcal_id ON production_calendar(google_calendar_event_id);
