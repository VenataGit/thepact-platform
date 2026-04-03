-- Migration 013: Add KP column ID settings — reference by ID, not by name
INSERT INTO settings (key, value) VALUES
  ('kp_izmislyane_column_id', ''),
  ('kp_razpredelenie_column_id', '')
ON CONFLICT (key) DO NOTHING;
