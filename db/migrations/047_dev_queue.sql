-- 047: Dev Queue — мостът „задача в личния Basecamp проект на Венци → Claude Code на PC-то му".
-- Отделният to-dos панел в личния му проект е опашката: всяка отворена задача там
-- (без значение в кой лист) влиза тук като ред. Watcher скрипт на компютъра му тегли
-- задачите през /api/dev-queue и пуска headless Claude Code сесия; ботът ThePactAlerts
-- връща резултата като коментар под самата задача.

CREATE TABLE IF NOT EXISTS dev_tasks (
  id              SERIAL PRIMARY KEY,
  bc_todo_id      BIGINT UNIQUE NOT NULL,
  bc_project_id   BIGINT NOT NULL,
  bc_list_id      BIGINT,
  list_name       TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL,
  notes_html      TEXT NOT NULL DEFAULT '',
  todo_url        TEXT NOT NULL DEFAULT '',
  -- pending → running → done/error; running → waiting_reply → pending (диалог с Венци)
  status          TEXT NOT NULL DEFAULT 'pending',
  session_id      TEXT,            -- Claude Code session id (за --resume при диалог)
  reply_html      TEXT,            -- отговорът на Венци от коментар (подава се при resume)
  last_comment_id BIGINT,          -- последният познат коментар — новите след него са отговор
  attempts        INT NOT NULL DEFAULT 0,  -- брой claim-ове; ползва се и като fencing токен
  stale_retries   INT NOT NULL DEFAULT 0,  -- само сривове (заседнал running) — 1 ретрай, после error
  result          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_tasks_status ON dev_tasks (status);
