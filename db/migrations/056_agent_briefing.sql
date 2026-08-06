-- 056_agent_briefing.sql
-- Гласов брифинг (Фаза 2): следа какво вече е КАЗАНО на Венци.
--
-- Basecamp API няма endpoint за „прочетено" и няма endpoint за известия —
-- затова четенето през API физически не може да махне жълтите точки в Basecamp.
-- Обратната страна: няма как да питаме Basecamp „кое е непрочетено", затова си
-- водим собствен курсор ТУК. Той е напълно отделен от Basecamp: ако Венци сам
-- е прочел нещо, агентът пак ще му го спомене; щом го е чул от агента — пада.

CREATE TABLE IF NOT EXISTS agent_briefing_seen (
    ref_key    TEXT PRIMARY KEY,             -- 'card:123' | 'todo:456' | 'comment:789' | 'message:1'
    bucket     TEXT NOT NULL DEFAULT '',     -- mine | mentioned | stalled
    -- Състоянието на записа в момента на казването (обикновено bc_updated_at).
    -- Ако се промени (нов коментар, нова дата), редът пак изплува като „ново" —
    -- това е и отговорът на „свърших нещо, докато не сме говорили".
    told_state TEXT NOT NULL DEFAULT '',
    told_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_briefing_seen_told ON agent_briefing_seen(told_at);
