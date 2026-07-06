-- 041_gcal_alerts_bc_people.sql
-- Календар известията работят с ХОРАТА ОТ BASECAMP (Video Production проекта),
-- не с потребителите на старата платформа. Локален кеш bc_people се пълни от
-- Basecamp API (бутон „Обнови екипа" + авто на 6ч) — никой не трябва да се логва.

CREATE TABLE IF NOT EXISTS bc_people (
    person_id       BIGINT PRIMARY KEY,          -- Basecamp person id
    name            TEXT NOT NULL DEFAULT '',
    email           TEXT NOT NULL DEFAULT '',
    title           TEXT NOT NULL DEFAULT '',
    avatar_url      TEXT NOT NULL DEFAULT '',
    attachable_sgid TEXT NOT NULL DEFAULT '',    -- за @mentions в rich text
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Таблиците са от вчера и празни — безопасно ги пресъздаваме към Basecamp person ids.
DROP TABLE IF EXISTS gcal_feed_responsibles;
CREATE TABLE gcal_feed_responsibles (
    feed_id      INT NOT NULL REFERENCES gcal_feeds(id) ON DELETE CASCADE,
    bc_person_id BIGINT NOT NULL,
    PRIMARY KEY (feed_id, bc_person_id)
);

DROP TABLE IF EXISTS gcal_person_map;
CREATE TABLE gcal_person_map (
    google_email TEXT PRIMARY KEY,
    bc_person_id BIGINT NOT NULL
);
