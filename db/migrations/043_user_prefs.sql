-- 043_user_prefs.sql
-- Per-user настройки (ключ → JSON), за да се помнят на ВСЕКИ ЧОВЕК независимо от
-- браузъра/устройството. Първи потребител: dashboard-ът (key 'dash_prefs' —
-- скрити/минимизирани/максимизирана дъска и скрити колони). Generic — бъдещи
-- per-user настройки също отиват тук.
CREATE TABLE IF NOT EXISTS user_prefs (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key         VARCHAR(255) NOT NULL,
    value       TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, key)
);
