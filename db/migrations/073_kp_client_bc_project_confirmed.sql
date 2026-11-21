-- 073_kp_client_bc_project_confirmed.sql
-- КП-Автоматизация → Настройки: ръчно потвърдена връзка клиент ↔ Basecamp проект.
-- TRUE = връзката е проверена от човек и авто-съвпадението по име не я подменя.
ALTER TABLE kp_clients ADD COLUMN IF NOT EXISTS bc_project_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
