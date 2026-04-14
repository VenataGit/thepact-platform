-- Positions (job titles) for users — controls permissions, notifications, visible tools
CREATE TABLE IF NOT EXISTS positions (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT DEFAULT '',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Link users to positions
ALTER TABLE users ADD COLUMN IF NOT EXISTS position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL;

-- Position-based permissions (key-value per position)
CREATE TABLE IF NOT EXISTS position_permissions (
    id              SERIAL PRIMARY KEY,
    position_id     INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    permission_key  VARCHAR(100) NOT NULL,
    UNIQUE(position_id, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_position_perms_pos ON position_permissions(position_id);

-- Seed default positions
INSERT INTO positions (name, description) VALUES
  ('Видеограф', 'Заснемане и монтаж на видео съдържание'),
  ('Акаунт мениджър', 'Управление на клиентски акаунти и комуникация'),
  ('Криейтив', 'Създаване на идеи и концепции за съдържание'),
  ('Продуцент', 'Планиране и координация на видео продукции'),
  ('Мениджър', 'Управление на екипа и проектите')
ON CONFLICT (name) DO NOTHING;
