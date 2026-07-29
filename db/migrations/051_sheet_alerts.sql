-- 051_sheet_alerts.sql
-- Google Sheets → Basecamp „Известия от таблица" (първи клиент: Re/Shape).
--
-- Клиентът не иска да работи в Basecamp — постинг планът живее в Google Sheets.
-- Затова таблицата остава ТЯХНАТА среда, а ние получаваме известията при нас:
-- Apps Script в самата таблица (инсталируем onEdit/onChange тригер) вика
-- /webhooks/sheet/:secret при всяка редакция; платформата решава кое е важно
-- и пише в Message Board-а на Video Production.
--
-- Скриптът е „тъп": праща заглавния ред + променените клетки. ЦЯЛАТА логика
-- (кои колони са важни, кое е заглавието на видеото) е тук на сървъра, за да
-- може Венци да я мени от Настройки, без да пипа скрипта в таблицата.
--
-- Една нишка = едно видео (ред): първата важна промяна отваря съобщение,
-- всяка следваща коментира под него — точно както Календар известията.

CREATE TABLE IF NOT EXISTS sheet_alert_threads (
    id             SERIAL PRIMARY KEY,
    spreadsheet_id TEXT NOT NULL,
    sheet_name     TEXT NOT NULL,
    -- Нормализираното име на видеото, а не номерът на реда: вмъкването на ред
    -- по средата размества номерата, но не и имената.
    row_key        TEXT NOT NULL,
    title          TEXT NOT NULL DEFAULT '',
    last_row       INTEGER,
    bc_message_id  BIGINT,
    bc_project_id  BIGINT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (spreadsheet_id, sheet_name, row_key)
);

-- Последните получени промени — виждат се в админ панела. Служи и за
-- тестването („идва ли изобщо нещо от таблицата?"), преди да е пуснато в Basecamp.
CREATE TABLE IF NOT EXISTS sheet_alert_events (
    id             SERIAL PRIMARY KEY,
    spreadsheet_id TEXT NOT NULL DEFAULT '',
    sheet_name     TEXT NOT NULL DEFAULT '',
    row_num        INTEGER,
    title          TEXT NOT NULL DEFAULT '',
    column_name    TEXT NOT NULL DEFAULT '',
    old_value      TEXT NOT NULL DEFAULT '',
    new_value      TEXT NOT NULL DEFAULT '',
    editor_email   TEXT NOT NULL DEFAULT '',
    important      BOOLEAN NOT NULL DEFAULT FALSE,
    posted         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sheet_alert_events_at ON sheet_alert_events(created_at DESC);

-- Кой се тагва и абонира за известията (Basecamp хора, от кеша bc_people).
CREATE TABLE IF NOT EXISTS sheet_alert_responsibles (
    bc_person_id BIGINT PRIMARY KEY
);

-- По подразбиране изключено — пуска се от Настройки чак след като скриптът е
-- сложен в таблицата и тестът е минал.
INSERT INTO settings (key, value, updated_at) VALUES
    ('sheet_alerts_enabled',      'false', NOW()),
    ('sheet_alerts_secret',       '',      NOW()),
    ('sheet_alerts_bc_project',   '39396506',    NOW()),
    ('sheet_alerts_bc_board',     '10143861702', NOW()),
    ('sheet_alerts_bc_board_url', 'https://3.basecamp.com/5750544/buckets/39396506/message_boards/10143861702', NOW()),
    -- Колони, при които известяваме веднага (търси се СЪДЪРЖАНЕ в името на колоната).
    ('sheet_alerts_important',    'одобрение,коментар', NOW()),
    -- От коя колона взимаме името на видеото за заглавие на нишката.
    ('sheet_alerts_title_cols',   'име,видео,заглавие', NOW()),
    -- true = известие при ВСЯКА промяна (шумно); false = само важните колони.
    ('sheet_alerts_all_changes',  'false', NOW()),
    -- Секунди изчакване, докато човекът дописва реда → едно обобщено известие.
    ('sheet_alerts_delay',        '60',    NOW())
ON CONFLICT (key) DO NOTHING;
