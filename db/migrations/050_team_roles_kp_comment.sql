-- 050_team_roles_kp_comment.sql
-- Админ панел „Екип и роли" + коментар с тагове под всяка нова КП карта.
--
-- Защо: досега „Потребители" в админа показваше само хората, които са се логвали в
-- платформата (users). Хората от екипа, които ползват само Basecamp, не се виждаха
-- никъде и не можеха да получат позиция. Панелът вече работи с bc_people (кешът на
-- Video Production проекта от 041_gcal_alerts_bc_people.sql), който се опреснява
-- всеки ден автоматично — виж services/bc-team.js.

-- 1) Кои позиции значат „отговаря за създаването на контент плана".
--    Всички активни хора с такава позиция се тагват в коментара под новата КП карта.
ALTER TABLE positions ADD COLUMN IF NOT EXISTS kp_responsible BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Позиция за човек ОТ BASECAMP (не за логнат потребител на платформата).
ALTER TABLE bc_people ADD COLUMN IF NOT EXISTS position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL;

-- 3) Кой Basecamp проект е „проектът на този клиент" — оттам ботът чете какво
--    конкретно трябва да се направи по КП-то. Празно = авто-съвпадение по име
--    (резултатът се запомня тук при първото успешно съвпадение).
ALTER TABLE kp_clients ADD COLUMN IF NOT EXISTS bc_project_id BIGINT;

-- 4) Настройки на коментара под новата КП карта + часът на дневния sync на екипа.
INSERT INTO settings (key, value) VALUES
  ('kp_comment_enabled', 'true'),        -- пише ли се коментар под новата КП карта
  ('kp_comment_ai', 'true'),             -- Claude чете проекта на клиента и обобщава
  ('kp_comment_lookback_days', '45'),    -- колко назад се чете от проекта на клиента
  ('bc_team_sync_time', '07:30')         -- дневен sync на екипа от Basecamp (BG време)
ON CONFLICT (key) DO NOTHING;

-- „Криейтив" е позицията, която прави контент плановете (виж 035_positions.sql).
UPDATE positions SET kp_responsible = TRUE WHERE name = 'Криейтив';
