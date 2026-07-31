-- 053: Инструмент „Създаване на задачи" (More → Създаване на задачи).
-- Всеки в екипа може да поръча карта в Basecamp — самата карта се създава от бот
-- профила ThePactAlerts, а тук се пази КОЙ я е поръчал (Венци го гледа в админ панела).

CREATE TABLE IF NOT EXISTS created_task_log (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name     TEXT NOT NULL DEFAULT '',   -- снимка на името към момента на създаване
  kind          TEXT NOT NULL,              -- 'plan' (измисляне/контент план) | 'single' (единична задача)
  title         TEXT NOT NULL,
  bc_card_id    BIGINT,
  card_url      TEXT NOT NULL DEFAULT '',
  board_title   TEXT NOT NULL DEFAULT '',
  column_title  TEXT NOT NULL DEFAULT '',
  video_count   INTEGER,                    -- само за 'plan'
  due_on        DATE,                       -- датата за публикуване / крайният срок на картата
  step_dates    JSONB,                      -- {"Видеограф - …":"2026-08-01", …} за 'single'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_created_task_log_created ON created_task_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_created_task_log_user ON created_task_log (user_id);
