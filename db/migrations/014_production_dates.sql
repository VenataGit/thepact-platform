-- Migration 014: Production date fields + date change log
-- Adds brainstorm/filming/editing/upload dates to cards
-- Adds card_date_changes table for audit trail

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS brainstorm_date DATE,
  ADD COLUMN IF NOT EXISTS filming_date    DATE,
  ADD COLUMN IF NOT EXISTS editing_date    DATE,
  ADD COLUMN IF NOT EXISTS upload_date     DATE;

CREATE TABLE IF NOT EXISTS card_date_changes (
  id              SERIAL PRIMARY KEY,
  card_id         INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  field_name      TEXT NOT NULL,
  old_value       DATE,
  new_value       DATE,
  changed_by      INTEGER REFERENCES users(id),
  changed_by_name TEXT,
  changed_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_date_changes_card ON card_date_changes(card_id);
CREATE INDEX IF NOT EXISTS idx_card_date_changes_at   ON card_date_changes(changed_at);
