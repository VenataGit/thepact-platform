-- Daily report now posts to a message board instead of campfire
INSERT INTO settings (key, value) VALUES
  ('daily_report_board_id', '23')
ON CONFLICT (key) DO NOTHING;
