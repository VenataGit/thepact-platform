-- Migration 007: Multi-project support
-- Adds projects and project_members tables, links existing data to project 1

CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(7) DEFAULT '#1cb0f6',
    creator_id INTEGER REFERENCES users(id),
    is_pinned BOOLEAN DEFAULT FALSE,
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);

-- Seed initial project
INSERT INTO projects (id, name, description, is_pinned) VALUES (1, 'Video Production', 'ThePact видео продукция', TRUE) ON CONFLICT DO NOTHING;

-- Link all existing users to project 1
INSERT INTO project_members (project_id, user_id, role) SELECT 1, id, role FROM users ON CONFLICT DO NOTHING;

-- Add project_id to boards
ALTER TABLE boards ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) DEFAULT 1;

-- Add project_id to message_board
ALTER TABLE message_board ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) DEFAULT 1;
