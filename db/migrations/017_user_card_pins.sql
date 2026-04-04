-- Migration 017: Per-user pinned comments (replaces global cards.pinned_comment_id)
CREATE TABLE IF NOT EXISTS user_card_pins (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id    INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  comment_id INTEGER REFERENCES card_comments(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, card_id)
);
CREATE INDEX IF NOT EXISTS idx_user_card_pins_card ON user_card_pins(card_id);
