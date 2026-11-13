-- Контент стратегия агент: админът трие проекти, които не са клиенти (вътрешни и т.н.).
-- „Изтрит" = не излиза никъде (и в скритите), засичането не го връща; пусканията остават.
ALTER TABLE cs_projects ADD COLUMN IF NOT EXISTS removed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cs_projects ADD COLUMN IF NOT EXISTS removed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE cs_projects ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
