-- 066_board_overdue_timers_bigint.sql (04.11.2026, стабилност)
-- board_overdue_timers беше създадена от по-стара версия: board_id INTEGER + FK към локалните
-- boards. 039 е IF NOT EXISTS и не я поправи → Basecamp ID-тата (> 2^31) гърмяха с „out of range"
-- и POST /api/timers/boards/sync връщаше 500 при всяко отваряне на таблото (~27 000/ден).
-- Без загуба на данни: само разширяване на типа и махане на връзката към старите локални дъски.
ALTER TABLE board_overdue_timers DROP CONSTRAINT IF EXISTS board_overdue_timers_board_id_fkey;
ALTER TABLE board_overdue_timers ALTER COLUMN board_id TYPE BIGINT;
