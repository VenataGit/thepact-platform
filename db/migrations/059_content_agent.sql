-- 059_content_agent.sql
-- Content агент: памет на клиента, профили в социалните мрежи, пускания на агентите
-- и събраните видеа (за outlier проучването). Клиентът = kp_clients.id.
--
-- ВНИМАНИЕ: реалното създаване на таблиците е и в кода
-- (src/services/content-agent/store.js #ensureSchema) — не разчитай само на този файл.

-- Профили на клиента — колкото трябва, във всякакви платформи (напр. Cineland има
-- отделен Meta профил за всеки град). role: own = на клиента, competitor = конкурент,
-- inspiration = чужд акаунт за вдъхновение.
CREATE TABLE IF NOT EXISTS ca_profiles (
    id            SERIAL PRIMARY KEY,
    client_id     INTEGER NOT NULL,
    platform      TEXT NOT NULL,            -- youtube | tiktok | instagram | facebook | other
    url           TEXT NOT NULL DEFAULT '',
    handle        TEXT NOT NULL DEFAULT '',
    label         TEXT NOT NULL DEFAULT '', -- напр. „Cineland Пловдив"
    role          TEXT NOT NULL DEFAULT 'own',
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    stats         JSONB NOT NULL DEFAULT '{}'::jsonb, -- медиана, брой видеа, последна грешка
    last_scraped_at TIMESTAMPTZ,
    created_by    TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ca_profiles_client ON ca_profiles(client_id);

-- Паметта: всяко нещо, което знаем за клиента. status: approved се ползва от агентите,
-- pending чака човек да натисне ✓, rejected е отхвърлено (пази се, за да не се предлага пак).
CREATE TABLE IF NOT EXISTS ca_memory (
    id            SERIAL PRIMARY KEY,
    client_id     INTEGER NOT NULL,
    kind          TEXT NOT NULL,            -- profile | like | dislike | rule | voice | past_video | note
    text          TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'approved',
    created_by    TEXT NOT NULL DEFAULT '',
    reviewed_by   TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ca_memory_client ON ca_memory(client_id, status);

-- Едно пускане на агентите (от таг в Basecamp, от нов КП или от платформата).
CREATE TABLE IF NOT EXISTS ca_runs (
    id            SERIAL PRIMARY KEY,
    client_id     INTEGER NOT NULL,
    trigger       TEXT NOT NULL,            -- mention | kp_auto | manual
    request       TEXT NOT NULL DEFAULT '',
    requested_by  TEXT NOT NULL DEFAULT '',
    bc_project_id BIGINT,
    bc_parent_id  BIGINT,                   -- картата/задачата, под която отговаряме
    bc_comment_id BIGINT UNIQUE,            -- коментарът-заявка (дедуп)
    status        TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | error
    steps         JSONB NOT NULL DEFAULT '[]'::jsonb,
    result        JSONB,
    error         TEXT NOT NULL DEFAULT '',
    usage         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ca_runs_client ON ca_runs(client_id, created_at DESC);

-- Видеата от профилите — с outlier скор спрямо медианата на същия профил.
CREATE TABLE IF NOT EXISTS ca_videos (
    id            SERIAL PRIMARY KEY,
    profile_id    INTEGER NOT NULL,
    client_id     INTEGER NOT NULL,
    platform      TEXT NOT NULL,
    video_id      TEXT NOT NULL,
    url           TEXT NOT NULL DEFAULT '',
    caption       TEXT NOT NULL DEFAULT '',
    duration_sec  INTEGER,
    views         BIGINT,
    likes         BIGINT,
    comments      BIGINT,
    shares        BIGINT,
    saves         BIGINT,
    published_at  TIMESTAMPTZ,
    outlier_score NUMERIC(10,2),
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (platform, video_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_ca_videos_client ON ca_videos(client_id, outlier_score DESC);
