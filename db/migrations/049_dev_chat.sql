-- 049: Чат бот — Венци пише в Campfire чата на личния си проект, ботът отговаря там.
-- Отделен, самостоятелен поток от dev_tasks: истинските Basecamp Pings не са достъпни
-- през API, затова каналът е Campfire чатът на личния проект (само Венци + ThePactAlerts).
-- Всеки нов ред от Венци влиза тук; watcher-ът на PC-то го тегли през /api/dev-chat,
-- пуска Claude в разговорен режим (една продължаваща сесия) и връща отговора в чата.
-- Курсорът (последен обработен ред) и session_id на разговора стоят в settings.

CREATE TABLE IF NOT EXISTS dev_chat (
  id          SERIAL PRIMARY KEY,
  bc_line_id  BIGINT UNIQUE NOT NULL,          -- Campfire line id (дедуп)
  message     TEXT NOT NULL,                   -- текстът, който Венци е написал
  -- pending → running → done/error
  status      TEXT NOT NULL DEFAULT 'pending',
  attempts    INT NOT NULL DEFAULT 0,          -- брой claim-ове; ползва се и като fencing токен
  reply       TEXT,                            -- отговорът на Claude (за диагностика)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_chat_status ON dev_chat (status);
