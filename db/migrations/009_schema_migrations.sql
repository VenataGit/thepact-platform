-- Migration 009: Schema migrations tracking
-- Adds schema_migrations table to track which migrations have been applied

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);
