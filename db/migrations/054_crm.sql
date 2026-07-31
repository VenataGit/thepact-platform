-- 054: CRM — собственият инструмент за придобиване на нови клиенти (#/crm).
--
-- Достъпът НЕ е по роля, а поименен: `crm_access`. Венци пуска един човек, той
-- може да пусне следващия (`can_grant`), а `granted_by` пази кой кого е пуснал —
-- затова отнемането маха и хората под него (иначе достъпът остава без стопанин).
-- Пълните админи имат достъп по право и не се записват в таблицата.

CREATE TABLE IF NOT EXISTS crm_access (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  can_grant   BOOLEAN NOT NULL DEFAULT TRUE,   -- може ли да дава достъп нататък
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_access_by ON crm_access (granted_by);

-- Етапите на фунията. Редактируеми, за да не се пипа код при промяна на процеса.
--   kind: 'open' (в движение) | 'won' (спечелена) | 'lost' (загубена)
--   probability: % за претеглената прогноза
--   rot_days: след колко дни без движение сделката се смята за „застояла"
CREATE TABLE IF NOT EXISTS crm_stages (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL DEFAULT 'open',
  probability INTEGER NOT NULL DEFAULT 0,
  rot_days    INTEGER NOT NULL DEFAULT 14,
  color       TEXT NOT NULL DEFAULT '',
  exit_rule   TEXT NOT NULL DEFAULT '',        -- кога сделката има право да мине нататък
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Сделките (потенциалните клиенти).
CREATE TABLE IF NOT EXISTS crm_deals (
  id             SERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  company        TEXT NOT NULL DEFAULT '',
  contact_name   TEXT NOT NULL DEFAULT '',
  contact_email  TEXT NOT NULL DEFAULT '',
  contact_phone  TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL DEFAULT '',     -- откъде дойде (препоръка, Instagram, студен…)
  stage_id       INTEGER REFERENCES crm_stages(id) ON DELETE SET NULL,
  owner_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  value          NUMERIC(12,2) NOT NULL DEFAULT 0,
  recurring      BOOLEAN NOT NULL DEFAULT FALSE, -- месечен абонамент вместо еднократно
  next_step      TEXT NOT NULL DEFAULT '',
  next_step_at   DATE,
  notes          TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'open',  -- open | won | lost
  lost_reason    TEXT NOT NULL DEFAULT '',
  bc_card_id     BIGINT,                        -- картата в Basecamp, ако е създадена
  bc_card_url    TEXT NOT NULL DEFAULT '',
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stage_since    TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- откога стои в този етап
  closed_at      TIMESTAMPTZ,
  archived       BOOLEAN NOT NULL DEFAULT FALSE,
  reminded_on    DATE                           -- за да не праща едно и също напомняне два пъти
);
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals (stage_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_owner ON crm_deals (owner_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_open ON crm_deals (status) WHERE archived = FALSE;

-- Хронологията на сделката: бележки, обаждания, срещи, смени на етап.
CREATE TABLE IF NOT EXISTS crm_events (
  id         SERIAL PRIMARY KEY,
  deal_id    INTEGER NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name  TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL,                     -- note|call|meeting|email|stage|created|won|lost|basecamp
  body       TEXT NOT NULL DEFAULT '',
  from_stage TEXT NOT NULL DEFAULT '',
  to_stage   TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_events_deal ON crm_events (deal_id, created_at DESC);

-- Етапи по подразбиране — само ако таблицата е празна (иначе преправените се пазят).
INSERT INTO crm_stages (title, position, kind, probability, rot_days, color, exit_rule)
SELECT * FROM (VALUES
  ('Нов контакт',        1, 'open',  10,  7, '#6b7f8c', 'Има име, фирма и как да се свържем.'),
  ('Първи разговор',     2, 'open',  25, 10, '#3b82f6', 'Проведен разговор: разбрахме нуждата, бюджета и кой решава.'),
  ('Изпратено КП',       3, 'open',  50, 10, '#eab308', 'Офертата е изпратена и клиентът я е получил.'),
  ('Преговори',          4, 'open',  75, 14, '#e8912d', 'Договаряме обхват/цена; има дата за решение.'),
  ('Спечелена',          5, 'won',  100, 90, '#2da562', 'Подписано/потвърдено — минава в продукция.'),
  ('Загубена',           6, 'lost',   0, 90, '#e5484d', 'Клиентът отказа или замълча окончателно.')
) AS s(title, position, kind, probability, rot_days, color, exit_rule)
WHERE NOT EXISTS (SELECT 1 FROM crm_stages);
