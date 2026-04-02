-- Migration 004: Schedule/Calendar
-- Adds schedule_events and schedule_event_attendees tables

CREATE TABLE IF NOT EXISTS schedule_events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    all_day BOOLEAN DEFAULT FALSE,
    color VARCHAR(7),
    card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL,
    creator_id INTEGER REFERENCES users(id),
    project_id INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_dates ON schedule_events(starts_at, ends_at);

CREATE TABLE IF NOT EXISTS schedule_event_attendees (
    event_id INTEGER NOT NULL REFERENCES schedule_events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, user_id)
);
