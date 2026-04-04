-- Add trashed_at column to cards for 30-day soft-delete trash bin
ALTER TABLE cards ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ;
