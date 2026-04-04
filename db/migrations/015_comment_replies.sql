-- Migration 015: Comment replies support
ALTER TABLE card_comments ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES card_comments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_comments_reply_to ON card_comments(reply_to_id);
