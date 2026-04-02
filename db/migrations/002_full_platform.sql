-- ============================================================
-- CARD COMMENTS (with @mentions)
-- ============================================================

CREATE TABLE IF NOT EXISTS card_comments (
    id              SERIAL PRIMARY KEY,
    card_id         INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    content         TEXT NOT NULL,
    mentions        JSONB DEFAULT '[]',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_card_comments_card ON card_comments(card_id);

-- ============================================================
-- CHAT / MESSAGING
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_channels (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255),
    type            VARCHAR(20) DEFAULT 'group' CHECK (type IN ('dm', 'group')),
    created_by      INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_members (
    channel_id      INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id              SERIAL PRIMARY KEY,
    channel_id      INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    content         TEXT NOT NULL,
    mentions        JSONB DEFAULT '[]',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel_id, created_at);

-- ============================================================
-- ACTIVITY LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_log (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id),
    user_name       VARCHAR(255),
    action          VARCHAR(100) NOT NULL,
    target_type     VARCHAR(50),
    target_id       INTEGER,
    target_title    VARCHAR(500),
    board_name      VARCHAR(255),
    details         JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_date ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);

-- ============================================================
-- MESSAGE BOARD (announcements / daily reports)
-- ============================================================

CREATE TABLE IF NOT EXISTS message_board (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id),
    title           VARCHAR(500) NOT NULL,
    content         TEXT,
    category        VARCHAR(100) DEFAULT 'general',
    pinned          BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_board_date ON message_board(created_at DESC);

-- ============================================================
-- FILE VAULT
-- ============================================================

CREATE TABLE IF NOT EXISTS vault_folders (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    parent_id       INTEGER REFERENCES vault_folders(id) ON DELETE CASCADE,
    created_by      INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_files (
    id              SERIAL PRIMARY KEY,
    folder_id       INTEGER REFERENCES vault_folders(id) ON DELETE SET NULL,
    filename        VARCHAR(500) NOT NULL,
    original_name   VARCHAR(500) NOT NULL,
    mime_type       VARCHAR(100),
    size_bytes      BIGINT,
    storage_path    TEXT NOT NULL,
    uploaded_by     INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vault_files_folder ON vault_files(folder_id);

-- ============================================================
-- UPDATE NOTIFICATIONS TABLE (add more types)
-- ============================================================

-- notifications table already exists, just needs to work with new types:
-- types: assigned, mentioned, comment, message, system

-- ============================================================
-- ADD steps_done / steps_total computed to cards query
-- ============================================================

-- These are computed in SQL queries, not stored
