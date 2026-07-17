-- Migration 048: „Резултати за клиент" известия.
--
-- Когато всички видеа по един контент план са публикувани, екипът трябва да подготви
-- резултати за клиента. Известието идва 3 КАЛЕНДАРНИ дни след датата на публикуване на
-- последното видео (= края на отчетния период), защото чак тогава има данни за всички.
-- Периодът = първо публикуване → последно публикуване + 3 дни.
--
-- Едно известие на (клиент, КП) — UNIQUE пази от дублиране при всяко минаване на cron-а.
-- bc_message_id е котвата, под която се коментира, ако датите се променят след обявяване.

CREATE TABLE IF NOT EXISTS kp_results_alerts (
  id SERIAL PRIMARY KEY,
  client_key TEXT NOT NULL,
  client_name TEXT NOT NULL,
  kp INTEGER NOT NULL,
  range_start DATE NOT NULL,
  range_end DATE NOT NULL,
  videos_count INTEGER NOT NULL DEFAULT 0,
  plan_videos_count INTEGER,
  fingerprint TEXT,
  bc_message_id BIGINT,
  bc_project_id BIGINT,
  bc_card_id BIGINT,
  announced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_key, kp)
);

-- Кой се таг­ва/абонира за известията (Basecamp хора, от кеша bc_people).
CREATE TABLE IF NOT EXISTS kp_results_responsibles (
  bc_person_id BIGINT PRIMARY KEY
);

INSERT INTO settings (key, value) VALUES
  ('kp_results_enabled', 'false'),
  ('kp_results_time', '09:30'),
  ('kp_results_days_after', '3'),
  ('kp_results_card_enabled', 'true'),
  ('kp_results_card_workdays', '2'),
  ('kp_results_card_title', '{клиент} КП-{номер} - Резултати'),
  ('kp_results_bc_board_url', ''),
  ('kp_results_bc_project', ''),
  ('kp_results_bc_board', ''),
  ('kp_results_card_board_id', ''),
  ('kp_results_card_column_id', '')
ON CONFLICT (key) DO NOTHING;
