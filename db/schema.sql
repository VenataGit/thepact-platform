-- ThePact Platform — Database Schema
-- PostgreSQL 15+

-- ============================================================
-- USERS & AUTH
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    avatar_url      TEXT,
    role            VARCHAR(20) DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    is_active       BOOLEAN DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BOARDS & COLUMNS (Kanban structure)
-- ============================================================

CREATE TABLE IF NOT EXISTS boards (
    id              SERIAL PRIMARY KEY,
    title           VARCHAR(255) NOT NULL,
    position        INTEGER DEFAULT 0,
    color           VARCHAR(7),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS columns (
    id              SERIAL PRIMARY KEY,
    board_id        INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title           VARCHAR(255) NOT NULL,
    position        INTEGER DEFAULT 0,
    wip_limit       INTEGER,
    is_done_column  BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_columns_board ON columns(board_id);

-- ============================================================
-- CARDS
-- ============================================================

CREATE TABLE IF NOT EXISTS cards (
    id              SERIAL PRIMARY KEY,
    board_id        INTEGER NOT NULL REFERENCES boards(id),
    column_id       INTEGER NOT NULL REFERENCES columns(id),
    title           VARCHAR(500) NOT NULL,
    content         TEXT,
    due_on          DATE,
    publish_date    DATE,
    priority        VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
    is_on_hold      BOOLEAN DEFAULT FALSE,
    position        INTEGER DEFAULT 0,
    creator_id      INTEGER REFERENCES users(id),
    parent_id       INTEGER REFERENCES cards(id) ON DELETE SET NULL,
    client_name     VARCHAR(255),
    kp_number       INTEGER,
    video_number    INTEGER,
    video_title     VARCHAR(500),
    completed_at    TIMESTAMPTZ,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cards_board ON cards(board_id);
CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due_on) WHERE due_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cards_client ON cards(client_name, kp_number);
CREATE INDEX IF NOT EXISTS idx_cards_parent ON cards(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cards_active ON cards(id) WHERE archived_at IS NULL;

-- ============================================================
-- CARD ASSIGNEES (M2M)
-- ============================================================

CREATE TABLE IF NOT EXISTS card_assignees (
    card_id         INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at     TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (card_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_card_assignees_user ON card_assignees(user_id);

-- ============================================================
-- CARD STEPS (checklist items)
-- ============================================================

CREATE TABLE IF NOT EXISTS card_steps (
    id              SERIAL PRIMARY KEY,
    card_id         INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    title           VARCHAR(500) NOT NULL,
    completed       BOOLEAN DEFAULT FALSE,
    completed_at    TIMESTAMPTZ,
    due_on          DATE,
    assignee_id     INTEGER REFERENCES users(id),
    position        INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_card_steps_card ON card_steps(card_id);

-- ============================================================
-- CARD EVENTS (movement & lifecycle history)
-- ============================================================

CREATE TABLE IF NOT EXISTS card_events (
    id              SERIAL PRIMARY KEY,
    card_id         INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    event_type      VARCHAR(50) NOT NULL,
    from_board_id   INTEGER REFERENCES boards(id),
    from_column_id  INTEGER REFERENCES columns(id),
    to_board_id     INTEGER REFERENCES boards(id),
    to_column_id    INTEGER REFERENCES columns(id),
    user_id         INTEGER REFERENCES users(id),
    metadata        JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_card_events_card ON card_events(card_id);
CREATE INDEX IF NOT EXISTS idx_card_events_date ON card_events(created_at);

-- ============================================================
-- TIME TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS time_entries (
    id              SERIAL PRIMARY KEY,
    card_id         INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    started_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ,
    duration_minutes INTEGER,
    stage           VARCHAR(100),
    is_manual       BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_entries_card ON time_entries(card_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id);

CREATE TABLE IF NOT EXISTS active_timers (
    id              SERIAL PRIMARY KEY,
    card_id         INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL,
    stage           VARCHAR(100),
    UNIQUE(user_id)
);

-- ============================================================
-- KP AUTOMATION
-- ============================================================

CREATE TABLE IF NOT EXISTS kp_clients (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    videos_per_month INTEGER DEFAULT 10,
    current_kp_number INTEGER DEFAULT 1,
    publish_interval_days INTEGER DEFAULT 3,
    first_publish_date DATE,
    last_video_date DATE,
    next_kp_date    DATE,
    notes           TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kp_audit_log (
    id              SERIAL PRIMARY KEY,
    user_name       VARCHAR(255) NOT NULL,
    action          VARCHAR(100) NOT NULL,
    client_name     VARCHAR(255),
    details         TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- VIDEO ARCHIVE
-- ============================================================

CREATE TABLE IF NOT EXISTS video_archive (
    id              SERIAL PRIMARY KEY,
    original_card_id INTEGER,
    client_name     VARCHAR(255),
    kp_number       INTEGER,
    video_number    INTEGER,
    video_title     VARCHAR(500),
    full_title      VARCHAR(500),
    board_title     VARCHAR(255),
    column_title    VARCHAR(255),
    due_on          DATE,
    publish_date    DATE,
    assignee_names  JSONB,
    creator_name    VARCHAR(255),
    content         TEXT,
    created_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    archived_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_video_archive_client ON video_archive(client_name, kp_number);

-- ============================================================
-- CARD NOTES
-- ============================================================

CREATE TABLE IF NOT EXISTS card_notes (
    id              SERIAL PRIMARY KEY,
    card_id         INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id),
    content         TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_card_notes_card ON card_notes(card_id);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id),
    type            VARCHAR(50) NOT NULL,
    title           VARCHAR(500) NOT NULL,
    body            TEXT,
    reference_type  VARCHAR(50),
    reference_id    INTEGER,
    is_read         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

-- ============================================================
-- APP SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
    key             VARCHAR(255) PRIMARY KEY,
    value           TEXT,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FILE ATTACHMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS attachments (
    id              SERIAL PRIMARY KEY,
    card_id         INTEGER REFERENCES cards(id) ON DELETE SET NULL,
    filename        VARCHAR(500) NOT NULL,
    mime_type       VARCHAR(100),
    size_bytes      BIGINT,
    storage_path    TEXT NOT NULL,
    uploaded_by     INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attachments_card ON attachments(card_id);
