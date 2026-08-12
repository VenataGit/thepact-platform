-- 057: Дневник на текста по Basecamp картите — какъв е бил и с какво е заменен.
--
-- Basecamp не пази версии на текста на картата: отвориш ли я, виждаш само сегашния
-- вариант. Снапшотът на PM Agent (на 15 минути) така или иначе тегли променените
-- карти, затова там се сравнява новият текст със записания и разликата идва тук.
--
-- Пази се САМО текстът. Снимките и видеата не се пазят — на тяхно място остава
-- бележка „[снимка]" / „[видео]", колкото да се вижда, че ги е имало.
--
-- who_name идва от събитията на картата в Basecamp (recordings/{id}/events.json) —
-- самата карта не казва кой я е редактирал. Може да е празно, ако Basecamp не е
-- отговорил; записът се прави и тогава, защото старият текст е по-важен от името.
--
-- Същата таблица се създава и от кода (services/card-text-log.js), за да проработи
-- дневникът и ако миграциите изостанат от деплоя.

CREATE TABLE IF NOT EXISTS bc_card_text_log (
  id            BIGSERIAL PRIMARY KEY,
  card_id       BIGINT NOT NULL,
  project_id    BIGINT,
  card_title    TEXT NOT NULL DEFAULT '',   -- заглавието към момента на промяната
  board_title   TEXT NOT NULL DEFAULT '',
  app_url       TEXT NOT NULL DEFAULT '',
  field         TEXT NOT NULL DEFAULT 'content',  -- 'content' (текстът) | 'title'
  old_text      TEXT NOT NULL DEFAULT '',
  new_text      TEXT NOT NULL DEFAULT '',
  who_id        BIGINT,
  who_name      TEXT NOT NULL DEFAULT '',
  bc_updated_at TIMESTAMPTZ,                -- кога Basecamp е отбелязал промяната
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- кога снапшотът я е засякъл
);

CREATE INDEX IF NOT EXISTS idx_bc_card_text_log_created ON bc_card_text_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bc_card_text_log_card    ON bc_card_text_log (card_id, created_at DESC);
