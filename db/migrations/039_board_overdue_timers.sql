-- 039_board_overdue_timers.sql
-- Per-board "time since no overdue task" timer for the Basecamp dashboard.
-- One row per board (Basecamp card-table id). started_at = when the current
-- clean streak began; is_paused = an overdue card is currently present.
-- Read/written by src/routes/timers.js (GET /api/timers/boards, POST /sync).
CREATE TABLE IF NOT EXISTS board_overdue_timers (
    board_id    BIGINT PRIMARY KEY,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_paused   BOOLEAN NOT NULL DEFAULT false
);
