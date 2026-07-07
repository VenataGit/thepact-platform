-- 044_pm_agent.sql
-- PM Agent (Фаза 0): снапшот на Basecamp в локалната БД + журнал на агента.
-- Снапшотът позволява на агента да анализира ВСИЧКО (карти+съдържание+коментари,
-- клиентски проекти: съобщения/задачи/campfire), без да препрочита Basecamp при
-- всеки анализ и без да опира в rate limits.

-- Всички проекти, които четящият токен вижда (Video Production + клиентските).
CREATE TABLE IF NOT EXISTS bc_projects (
    project_id    BIGINT PRIMARY KEY,
    name          TEXT NOT NULL DEFAULT '',
    description   TEXT NOT NULL DEFAULT '',
    dock          JSONB NOT NULL DEFAULT '[]',   -- инструментите на проекта (message_board, todoset, chat, kanban_board...)
    clients_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    bc_updated_at TIMESTAMPTZ,
    active        BOOLEAN NOT NULL DEFAULT TRUE, -- FALSE = вече не се вижда в Basecamp
    synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Карти от card tables (Video Production) — с пълното съдържание, за разлика от
-- in-memory кеша на bc-aggregate (който пази само заглавия/дати за дашборда).
CREATE TABLE IF NOT EXISTS bc_cards_snap (
    card_id       BIGINT PRIMARY KEY,
    project_id    BIGINT NOT NULL,
    board_id      BIGINT,
    board_title   TEXT NOT NULL DEFAULT '',
    column_title  TEXT NOT NULL DEFAULT '',
    title         TEXT NOT NULL DEFAULT '',
    content       TEXT NOT NULL DEFAULT '',      -- rich HTML от Basecamp
    due_on        DATE,
    completed     BOOLEAN NOT NULL DEFAULT FALSE,
    assignees     JSONB NOT NULL DEFAULT '[]',   -- [{id,name}]
    steps         JSONB NOT NULL DEFAULT '[]',   -- [{title,due_on,completed,assignees}]
    comments_count INT NOT NULL DEFAULT 0,
    app_url       TEXT NOT NULL DEFAULT '',
    on_hold       BOOLEAN NOT NULL DEFAULT FALSE,
    bc_created_at TIMESTAMPTZ,
    bc_updated_at TIMESTAMPTZ,
    active        BOOLEAN NOT NULL DEFAULT TRUE, -- FALSE = картата липсва от борда (архив/кош)
    synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bc_cards_snap_project ON bc_cards_snap(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_cards_snap_board   ON bc_cards_snap(board_id);

-- Коментари под какъвто и да е recording (карта, съобщение, todo...).
CREATE TABLE IF NOT EXISTS bc_comments_snap (
    comment_id    BIGINT PRIMARY KEY,
    project_id    BIGINT NOT NULL,
    parent_id     BIGINT NOT NULL,
    parent_type   TEXT NOT NULL DEFAULT '',      -- Kanban::Card / Message / Todo ...
    parent_title  TEXT NOT NULL DEFAULT '',
    creator_id    BIGINT,
    creator_name  TEXT NOT NULL DEFAULT '',
    creator_is_client BOOLEAN NOT NULL DEFAULT FALSE,
    content       TEXT NOT NULL DEFAULT '',
    app_url       TEXT NOT NULL DEFAULT '',
    bc_created_at TIMESTAMPTZ,
    bc_updated_at TIMESTAMPTZ,
    synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bc_comments_snap_parent  ON bc_comments_snap(parent_id);
CREATE INDEX IF NOT EXISTS idx_bc_comments_snap_project ON bc_comments_snap(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_comments_snap_created ON bc_comments_snap(bc_created_at);

-- Съобщения от message boards (вкл. клиентските проекти).
CREATE TABLE IF NOT EXISTS bc_messages_snap (
    message_id    BIGINT PRIMARY KEY,
    project_id    BIGINT NOT NULL,
    subject       TEXT NOT NULL DEFAULT '',
    content       TEXT NOT NULL DEFAULT '',
    creator_id    BIGINT,
    creator_name  TEXT NOT NULL DEFAULT '',
    creator_is_client BOOLEAN NOT NULL DEFAULT FALSE,
    comments_count INT NOT NULL DEFAULT 0,
    app_url       TEXT NOT NULL DEFAULT '',
    bc_created_at TIMESTAMPTZ,
    bc_updated_at TIMESTAMPTZ,
    synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bc_messages_snap_project ON bc_messages_snap(project_id);

-- To-do задачи (клиентските проекти ползват todoset, не card tables).
CREATE TABLE IF NOT EXISTS bc_todos_snap (
    todo_id       BIGINT PRIMARY KEY,
    project_id    BIGINT NOT NULL,
    todolist_id   BIGINT,
    todolist_title TEXT NOT NULL DEFAULT '',
    title         TEXT NOT NULL DEFAULT '',      -- Basecamp полето е `content`
    description   TEXT NOT NULL DEFAULT '',
    due_on        DATE,
    completed     BOOLEAN NOT NULL DEFAULT FALSE,
    assignees     JSONB NOT NULL DEFAULT '[]',
    creator_name  TEXT NOT NULL DEFAULT '',
    creator_is_client BOOLEAN NOT NULL DEFAULT FALSE,
    comments_count INT NOT NULL DEFAULT 0,
    app_url       TEXT NOT NULL DEFAULT '',
    bc_created_at TIMESTAMPTZ,
    bc_updated_at TIMESTAMPTZ,
    synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bc_todos_snap_project ON bc_todos_snap(project_id);

-- Campfire (чат) редове — най-новите от всеки проект.
CREATE TABLE IF NOT EXISTS bc_campfire_lines_snap (
    line_id       BIGINT PRIMARY KEY,
    project_id    BIGINT NOT NULL,
    campfire_id   BIGINT,
    creator_id    BIGINT,
    creator_name  TEXT NOT NULL DEFAULT '',
    creator_is_client BOOLEAN NOT NULL DEFAULT FALSE,
    content       TEXT NOT NULL DEFAULT '',
    bc_created_at TIMESTAMPTZ,
    synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bc_campfire_snap_project ON bc_campfire_lines_snap(project_id);
CREATE INDEX IF NOT EXISTS idx_bc_campfire_snap_created ON bc_campfire_lines_snap(bc_created_at);

-- Журнал на изпълненията на агента (sync / audit / digest).
CREATE TABLE IF NOT EXISTS agent_runs (
    id           SERIAL PRIMARY KEY,
    kind         TEXT NOT NULL,                    -- 'sync' | 'audit' | 'digest'
    status       TEXT NOT NULL DEFAULT 'running',  -- running | done | error
    report       TEXT,                             -- финалният доклад (HTML)
    bc_message_url TEXT,                           -- линк към Basecamp публикацията
    stats        JSONB NOT NULL DEFAULT '{}',      -- токени, бройки, продължителност
    error        TEXT,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at  TIMESTAMPTZ
);

-- Предложени действия (Фаза 3): агентът предлага, Венци одобрява, чак тогава се изпълнява.
CREATE TABLE IF NOT EXISTS agent_proposals (
    id           SERIAL PRIMARY KEY,
    run_id       INT REFERENCES agent_runs(id) ON DELETE SET NULL,
    kind         TEXT NOT NULL,                    -- create_card | create_step | add_comment | post_message | move_card
    title        TEXT NOT NULL DEFAULT '',
    payload      JSONB NOT NULL DEFAULT '{}',
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | done | error
    result       JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_status ON agent_proposals(status);
