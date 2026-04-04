-- Migration 016: Add comment_id to notifications for deep-link scroll
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS comment_id INTEGER REFERENCES card_comments(id) ON DELETE SET NULL;
