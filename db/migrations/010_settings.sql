-- Migration 010: Settings table + pinned comment support

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO settings (key, value) VALUES ('comment_edit_window_minutes', '10') ON CONFLICT DO NOTHING;

-- Add pinned_comment_id to cards
ALTER TABLE cards ADD COLUMN IF NOT EXISTS pinned_comment_id INTEGER REFERENCES card_comments(id) ON DELETE SET NULL;
