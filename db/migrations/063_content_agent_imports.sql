-- 063_content_agent_imports.sql
-- Качени файлове за паметта на клиента (PDF, Word, Excel, PowerPoint, видео, аудио,
-- снимки…). Файлът се качва в платформата временно; компютърът в офиса
-- (ai-agent/worker.js) го дърпа, пази го при себе си, вади текста (pdftotext, Python,
-- Whisper за видео/аудио) и го връща. Платформата прави от текста записи в паметта
-- (чакат одобрение) и трие временния файл.
--
-- ВНИМАНИЕ: създава се и от кода (src/services/content-agent/store.js #ensureSchema).

CREATE TABLE IF NOT EXISTS ca_imports (
    id            SERIAL PRIMARY KEY,
    client_id     INTEGER NOT NULL,
    filename      TEXT NOT NULL,
    mime          TEXT NOT NULL DEFAULT '',
    size          BIGINT NOT NULL DEFAULT 0,
    tmp_path      TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'uploaded', -- uploaded | processing | importing | done | error
    kind          TEXT NOT NULL DEFAULT '',          -- document | audio | video | image | text
    pc_path       TEXT NOT NULL DEFAULT '',
    text_len      INTEGER NOT NULL DEFAULT 0,
    added         INTEGER NOT NULL DEFAULT 0,
    note          TEXT NOT NULL DEFAULT '',
    error         TEXT NOT NULL DEFAULT '',
    created_by    TEXT NOT NULL DEFAULT '',
    created_by_id INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ca_imports_status ON ca_imports(status, id);
CREATE INDEX IF NOT EXISTS idx_ca_imports_client ON ca_imports(client_id, id DESC);
