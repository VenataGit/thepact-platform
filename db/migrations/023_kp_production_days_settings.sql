-- Migration 023: Configurable KP production day offsets
-- Working days before publish date for each production stage

INSERT INTO settings (key, value) VALUES
  ('kp_days_brainstorm', '10'),
  ('kp_days_filming', '7'),
  ('kp_days_editing', '5'),
  ('kp_days_upload', '1')
ON CONFLICT (key) DO NOTHING;
