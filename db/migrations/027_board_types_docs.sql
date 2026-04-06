-- Add type column to boards (board = kanban, docs = Docs & Files)
ALTER TABLE boards ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'board';

-- Add board_id to vault_folders for scoping docs boards
ALTER TABLE vault_folders ADD COLUMN IF NOT EXISTS board_id INTEGER REFERENCES boards(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_vault_folders_board ON vault_folders(board_id);
