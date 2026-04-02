-- Migration 008: Email preferences
-- Adds user_email_preferences table for notification settings

CREATE TABLE IF NOT EXISTS user_email_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    on_assignment BOOLEAN DEFAULT TRUE,
    on_mention BOOLEAN DEFAULT TRUE,
    on_checkin BOOLEAN DEFAULT TRUE,
    on_comment BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
