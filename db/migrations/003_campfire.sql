-- Migration 003: Campfire group chat
-- Adds campfire_rooms and campfire_messages tables for real-time group chat

CREATE TABLE IF NOT EXISTS campfire_rooms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL DEFAULT 'Campfire',
    project_id INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campfire_messages (
    id SERIAL PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES campfire_rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    mentions JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campfire_messages_room ON campfire_messages(room_id, created_at);

-- Seed default campfire room
INSERT INTO campfire_rooms (id, name, project_id) VALUES (1, 'Campfire', 1) ON CONFLICT DO NOTHING;
