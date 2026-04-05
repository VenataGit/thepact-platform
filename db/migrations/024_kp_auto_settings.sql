-- Migration 024: KP automation configurable settings
INSERT INTO settings (key, value) VALUES
  ('kp_calendar_window', '30'),
  ('kp_days_before_next_kp', '15')
ON CONFLICT (key) DO NOTHING;
