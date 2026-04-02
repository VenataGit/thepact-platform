-- Migration 005: Automatic Check-ins
-- Adds checkin_questions and checkin_responses tables

CREATE TABLE IF NOT EXISTS checkin_questions (
    id SERIAL PRIMARY KEY,
    question TEXT NOT NULL,
    schedule_cron VARCHAR(50) NOT NULL DEFAULT '0 9 * * 1-5',
    is_active BOOLEAN DEFAULT TRUE,
    project_id INTEGER DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkin_responses (
    id SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES checkin_questions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkin_responses_question ON checkin_responses(question_id, created_at DESC);
