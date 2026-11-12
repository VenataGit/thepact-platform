-- Контент стратегия агент (#/strategy) — Венци, 12.11.2026.
-- Всеки клиентски проект в Basecamp = ред в cs_projects (засича се сам от bc_projects);
-- всяко пускане на агента = ред в cs_runs. Идемпотентно — пуска се и от кода (store.ensureSchema).

CREATE TABLE IF NOT EXISTS cs_projects (
    project_id   BIGINT PRIMARY KEY,           -- Basecamp проектът на клиента
    name         TEXT NOT NULL DEFAULT '',     -- името на проекта (от bc_projects)
    client_name  TEXT NOT NULL DEFAULT '',     -- ръчно име на клиента ('' = от името на проекта)
    status       TEXT NOT NULL DEFAULT 'waiting', -- waiting (без стратегия) | done
    is_new       BOOLEAN NOT NULL DEFAULT FALSE,  -- засечен след първото обхождане = нов клиент
    hidden       BOOLEAN NOT NULL DEFAULT FALSE,  -- вътрешен проект / не ни трябва
    doc_url      TEXT NOT NULL DEFAULT '',     -- стратегията в Клиентски карти (Video Production)
    detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cs_runs (
    id            SERIAL PRIMARY KEY,
    project_id    BIGINT NOT NULL,
    notes         TEXT NOT NULL DEFAULT '',     -- допълнителни бележки от човека, пуснал агента
    requested_by  TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | error
    steps         JSONB NOT NULL DEFAULT '[]'::jsonb,
    result        JSONB,
    error         TEXT NOT NULL DEFAULT '',
    usage         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cs_runs_project_idx ON cs_runs (project_id, id DESC);
