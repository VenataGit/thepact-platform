-- Rich text documents in Docs & Files (like Basecamp's text documents)
CREATE TABLE IF NOT EXISTS vault_documents (
    id              SERIAL PRIMARY KEY,
    folder_id       INTEGER REFERENCES vault_folders(id) ON DELETE SET NULL,
    title           VARCHAR(500) NOT NULL,
    content         TEXT DEFAULT '',
    created_by      INTEGER REFERENCES users(id),
    updated_by      INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vault_docs_folder ON vault_documents(folder_id);
