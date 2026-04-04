CREATE TABLE IF NOT EXISTS production_calendar (
  id               SERIAL PRIMARY KEY,
  card_id          INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  scheduled_date   DATE NOT NULL,
  start_minute     INTEGER NOT NULL DEFAULT 540,  -- minutes from midnight (9:00 = 540)
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prod_cal_date ON production_calendar(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_prod_cal_card ON production_calendar(card_id);
