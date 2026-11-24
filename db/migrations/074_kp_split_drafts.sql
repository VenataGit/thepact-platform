-- 074_kp_split_drafts.sql
-- „Създай задачи по КП": чернова на прегледа (сменени дати, „Пропусни", подредба),
-- докато задачите не са пуснати. Една на контент план (Basecamp card id), обща за
-- всички — който отвори плана, вижда заложените дати. Трие се след успешно „Създай".
CREATE TABLE IF NOT EXISTS kp_split_drafts (
  card_id         TEXT PRIMARY KEY,
  data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by      INTEGER,
  updated_by_name TEXT NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
