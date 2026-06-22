-- 038_bc_production_calendar.sql
-- Scheduling state for the Basecamp-backed Production Calendar.
-- One row per scheduled Basecamp Production card (card leaves the sidebar once scheduled).
CREATE TABLE IF NOT EXISTS bc_production_calendar (
    id                       SERIAL PRIMARY KEY,
    basecamp_card_id         BIGINT NOT NULL UNIQUE,
    card_title               TEXT,
    card_url                 TEXT,
    scheduled_date           DATE NOT NULL,
    start_minute             INTEGER NOT NULL DEFAULT 540,   -- 9:00, minutes from midnight
    duration_minutes         INTEGER NOT NULL DEFAULT 60,
    google_calendar_event_id VARCHAR(255),
    created_by               INTEGER REFERENCES users(id),
    created_at               TIMESTAMPTZ DEFAULT NOW(),
    updated_at               TIMESTAMPTZ DEFAULT NOW()
);
