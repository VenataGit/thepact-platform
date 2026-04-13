-- Message boards as a board type — each board has its own messages
ALTER TABLE message_board ADD COLUMN IF NOT EXISTS board_id INTEGER REFERENCES boards(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_message_board_board ON message_board(board_id);

-- Comments on individual messages
CREATE TABLE IF NOT EXISTS message_comments (
    id              SERIAL PRIMARY KEY,
    message_id      INTEGER NOT NULL REFERENCES message_board(id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id),
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_comments_msg ON message_comments(message_id);
