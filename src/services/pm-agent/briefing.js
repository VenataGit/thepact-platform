// PM Agent — гласовият брифинг „какво ме чака днес".
//
// Три кофи, всичките детерминистичен SQL върху снапшота (без LLM, бързо):
//   mine      — назначено на Венци и още не е свършено
//   mentioned — тагнат е в коментар и още не е отговорил
//   stalled   — никой не е реагирал / просрочено / застояло (и там, където НЕ е тагнат)
//
// ВАЖНО: всичко тук е само четене от локалния снапшот. Нищо не се маркира като
// прочетено в Basecamp (API-то и без това няма такъв endpoint), нищо не се чеква.
// Курсорът „какво вече съм чул" е наш — таблица agent_briefing_seen (056).
const config = require('../../config');
const { query, queryOne, execute } = require('../../db/pool');
const { callClaude } = require('./claude');

// Прагове — държим ги тук, за да са на едно място.
const NO_REPLY_HOURS = 24;     // клиент е писал, никой не е отговорил
const STALE_DAYS = 14;         // карта без никакво движение
const LOOKBACK_DAYS = 30;      // по-старо от това не влиза в брифинга
const MAX_PER_BUCKET = 25;     // таван, за да не подуем промпта

// Границите ги смятаме тук, а не в SQL: `$1 || ' days'` върху нетипизиран
// параметър гърми с „operator is not unique" в PostgreSQL.
const agoIso = (ms) => new Date(Date.now() - ms).toISOString();
const daysAgo = (d) => agoIso(d * 24 * 3600 * 1000);
const hoursAgo = (h) => agoIso(h * 3600 * 1000);

// Кой е „аз" — Basecamp person записът на админа (Венци).
async function whoAmI() {
  const row = await queryOne(
    `SELECT person_id, name, attachable_sgid FROM bc_people
      WHERE LOWER(email) = ANY($1::text[]) AND active ORDER BY person_id LIMIT 1`,
    [config.ADMIN_EMAILS]
  );
  if (!row) {
    throw new Error('Няма Basecamp профил за админа в bc_people — пусни синхронизация на екипа (Админ → Екип и роли).');
  }
  return row;
}

// HTML от Basecamp → четим текст за LLM-а (и за говорене).
function plain(html, limit = 600) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function names(assignees) {
  if (!Array.isArray(assignees)) return [];
  return assignees.map((a) => a && a.name).filter(Boolean);
}

// ---------- кофа 1: назначено на мен ----------

async function bucketMine(me) {
  const mineJson = JSON.stringify([{ id: Number(me.person_id) }]);

  const cards = await query(
    `SELECT c.card_id, c.title, c.board_title, c.column_title, c.due_on, c.content,
            c.assignees, c.steps, c.comments_count, c.app_url, c.on_hold, c.bc_updated_at,
            p.name AS project_name
       FROM bc_cards_snap c
       LEFT JOIN bc_projects p ON p.project_id = c.project_id
      WHERE c.active AND NOT c.completed
        AND c.assignees @> $1::jsonb
      ORDER BY (c.due_on IS NULL), c.due_on, c.bc_updated_at DESC
      LIMIT $2`,
    [mineJson, MAX_PER_BUCKET]
  );

  const todos = await query(
    `SELECT t.todo_id, t.title, t.todolist_title, t.due_on, t.description,
            t.app_url, t.bc_updated_at, p.name AS project_name
       FROM bc_todos_snap t
       LEFT JOIN bc_projects p ON p.project_id = t.project_id
      WHERE NOT t.completed
        AND t.assignees @> $1::jsonb
      ORDER BY (t.due_on IS NULL), t.due_on, t.bc_updated_at DESC
      LIMIT $2`,
    [mineJson, MAX_PER_BUCKET]
  );

  const out = [];
  for (const c of cards) {
    // Последният коментар обяснява „защо чака мен" — точно контекстът, който Венци иска.
    const last = await lastComment(c.card_id);
    out.push({
      ref: `card:${c.card_id}`,
      kind: 'card',
      title: c.title,
      where: [c.project_name, c.board_title, c.column_title].filter(Boolean).join(' · '),
      due_on: c.due_on,
      on_hold: c.on_hold,
      with_me: names(c.assignees),
      open_steps: (Array.isArray(c.steps) ? c.steps : []).filter((s) => s && !s.completed).map((s) => s.title).slice(0, 6),
      summary: plain(c.content, 400),
      last_comment: last,
      url: c.app_url,
      state: String(c.bc_updated_at || ''),
    });
  }
  for (const t of todos) {
    const last = await lastComment(t.todo_id);
    out.push({
      ref: `todo:${t.todo_id}`,
      kind: 'todo',
      title: t.title,
      where: [t.project_name, t.todolist_title].filter(Boolean).join(' · '),
      due_on: t.due_on,
      summary: plain(t.description, 300),
      last_comment: last,
      url: t.app_url,
      state: String(t.bc_updated_at || ''),
    });
  }
  return out;
}

// Последният коментар под запис — кой и какво е казал.
async function lastComment(parentId) {
  const row = await queryOne(
    `SELECT creator_name, content, bc_created_at, creator_is_client
       FROM bc_comments_snap WHERE parent_id = $1
      ORDER BY bc_created_at DESC LIMIT 1`,
    [parentId]
  );
  if (!row) return null;
  return {
    by: row.creator_name,
    is_client: row.creator_is_client,
    at: row.bc_created_at,
    text: plain(row.content, 300),
  };
}

// ---------- кофа 2: тагнат съм и не съм отговорил ----------

async function bucketMentioned(me) {
  // Basecamp рендира @mention като <bc-attachment sgid="...">Име</bc-attachment>,
  // затова sgid-ът е точното съвпадение. Ако липсва — падаме на името.
  const sgid = String(me.attachable_sgid || '').trim();
  const needle = sgid || String(me.name || '').trim();
  if (!needle) return [];

  const rows = await query(
    `SELECT c.comment_id, c.parent_id, c.parent_type, c.parent_title, c.creator_name,
            c.creator_is_client, c.content, c.app_url, c.bc_created_at,
            p.name AS project_name
       FROM bc_comments_snap c
       LEFT JOIN bc_projects p ON p.project_id = c.project_id
      WHERE c.creator_id IS DISTINCT FROM $1
        AND POSITION($2::text IN c.content) > 0
        AND c.bc_created_at > $3::timestamptz
        AND NOT EXISTS (
              SELECT 1 FROM bc_comments_snap r
               WHERE r.parent_id = c.parent_id
                 AND r.creator_id = $1
                 AND r.bc_created_at > c.bc_created_at)
      ORDER BY c.bc_created_at DESC
      LIMIT $4`,
    [Number(me.person_id), needle, daysAgo(LOOKBACK_DAYS), MAX_PER_BUCKET]
  );

  return rows.map((r) => ({
    ref: `comment:${r.comment_id}`,
    kind: 'mention',
    title: r.parent_title || '(без заглавие)',
    where: [r.project_name, r.parent_type].filter(Boolean).join(' · '),
    by: r.creator_name,
    is_client: r.creator_is_client,
    at: r.bc_created_at,
    summary: plain(r.content, 500),
    url: r.app_url,
    state: String(r.comment_id),
  }));
}

// ---------- кофа 3: никой не е реагирал / просрочено / застояло ----------

async function bucketStalled(me) {
  const out = [];

  // 3a. Клиент е писал коментар и НИКОЙ от екипа не е отговорил след това.
  const waiting = await query(
    `SELECT c.comment_id, c.parent_title, c.parent_type, c.creator_name, c.content,
            c.app_url, c.bc_created_at, p.name AS project_name
       FROM bc_comments_snap c
       LEFT JOIN bc_projects p ON p.project_id = c.project_id
      WHERE c.creator_is_client
        AND c.bc_created_at < $1::timestamptz
        AND c.bc_created_at > $2::timestamptz
        AND NOT EXISTS (
              SELECT 1 FROM bc_comments_snap r
               WHERE r.parent_id = c.parent_id
                 AND NOT r.creator_is_client
                 AND r.bc_created_at > c.bc_created_at)
      ORDER BY c.bc_created_at ASC
      LIMIT $3`,
    [hoursAgo(NO_REPLY_HOURS), daysAgo(LOOKBACK_DAYS), MAX_PER_BUCKET]
  );
  for (const w of waiting) {
    out.push({
      ref: `comment:${w.comment_id}`,
      kind: 'client_waiting',
      title: w.parent_title || '(без заглавие)',
      where: [w.project_name, w.parent_type].filter(Boolean).join(' · '),
      by: w.creator_name,
      at: w.bc_created_at,
      summary: plain(w.content, 400),
      url: w.app_url,
      state: String(w.comment_id),
    });
  }

  // 3b. Просрочени карти — независимо на кого са (Венци иска да знае какво се бави).
  const overdue = await query(
    `SELECT c.card_id, c.title, c.board_title, c.column_title, c.due_on,
            c.assignees, c.app_url, c.bc_updated_at, p.name AS project_name
       FROM bc_cards_snap c
       LEFT JOIN bc_projects p ON p.project_id = c.project_id
      WHERE c.active AND NOT c.completed AND NOT c.on_hold
        AND c.due_on IS NOT NULL AND c.due_on < CURRENT_DATE
      ORDER BY c.due_on ASC
      LIMIT $1`,
    [MAX_PER_BUCKET]
  );
  for (const c of overdue) {
    out.push({
      ref: `card:${c.card_id}`,
      kind: 'overdue',
      title: c.title,
      where: [c.project_name, c.board_title, c.column_title].filter(Boolean).join(' · '),
      due_on: c.due_on,
      with_me: names(c.assignees),
      url: c.app_url,
      state: String(c.due_on || '') + '|' + String(c.bc_updated_at || ''),
    });
  }

  // 3c. Застояли карти — с отговорник, с дата, но без никакво движение.
  const stale = await query(
    `SELECT c.card_id, c.title, c.board_title, c.column_title, c.due_on,
            c.assignees, c.app_url, c.bc_updated_at, p.name AS project_name
       FROM bc_cards_snap c
       LEFT JOIN bc_projects p ON p.project_id = c.project_id
      WHERE c.active AND NOT c.completed AND NOT c.on_hold
        AND jsonb_array_length(c.assignees) > 0
        AND c.bc_updated_at < $1::timestamptz
        AND (c.due_on IS NULL OR c.due_on >= CURRENT_DATE)
      ORDER BY c.bc_updated_at ASC
      LIMIT $2`,
    [daysAgo(STALE_DAYS), MAX_PER_BUCKET]
  );
  for (const c of stale) {
    out.push({
      ref: `card:${c.card_id}`,
      kind: 'stale',
      title: c.title,
      where: [c.project_name, c.board_title, c.column_title].filter(Boolean).join(' · '),
      due_on: c.due_on,
      with_me: names(c.assignees),
      idle_since: c.bc_updated_at,
      url: c.app_url,
      state: String(c.bc_updated_at || ''),
    });
  }

  // Един запис може да е и просрочен, и застоял — оставяме първото попадение.
  const seen = new Set();
  return out.filter((i) => (seen.has(i.ref) ? false : seen.add(i.ref)));
}

// ---------- курсор „вече съм го чул" ----------

// Deploy-ът е само `git pull` + `npm install` + рестарт — миграциите НЕ се пускат
// автоматично (а `npm run migrate` изпълнява само schema.sql и seed.sql, без
// db/migrations/). Затова таблицата се създава при първа нужда: идемпотентно
// DDL, нищо не се трие. 056_agent_briefing.sql остава за чисти инсталации.
let tableReady = null;

function ensureSeenTable() {
  if (!tableReady) {
    tableReady = execute(`
      CREATE TABLE IF NOT EXISTS agent_briefing_seen (
        ref_key    TEXT PRIMARY KEY,
        bucket     TEXT NOT NULL DEFAULT '',
        told_state TEXT NOT NULL DEFAULT '',
        told_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`).catch((err) => {
      tableReady = null; // да опита пак при следващата заявка
      throw err;
    });
  }
  return tableReady;
}

async function filterUnheard(items) {
  if (!items.length) return items;
  await ensureSeenTable();
  const refs = items.map((i) => i.ref);
  const rows = await query(
    'SELECT ref_key, told_state FROM agent_briefing_seen WHERE ref_key = ANY($1::text[])',
    [refs]
  );
  const told = new Map(rows.map((r) => [r.ref_key, r.told_state]));
  // Казвали сме го САМО ако и състоянието е същото — промени ли се, изплува пак.
  return items.filter((i) => told.get(i.ref) !== String(i.state || ''));
}

// Отбелязва като „казано". Викаме го чак СЛЕД като брифингът е стигнал до Венци,
// за да не изгубим нещо при грешка по пътя.
async function markTold(items) {
  if (!items.length) return 0;
  await ensureSeenTable();
  for (const i of items) {
    await execute(
      `INSERT INTO agent_briefing_seen (ref_key, bucket, told_state, told_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (ref_key) DO UPDATE SET bucket = $2, told_state = $3, told_at = NOW()`,
      [i.ref, i.bucket || i.kind || '', String(i.state || '')]
    );
  }
  return items.length;
}

// ---------- сглобяване ----------

/**
 * Събира брифинга. `onlyNew` реже вече казаното.
 * Връща { me, generated_at, counts, mine, mentioned, stalled }.
 */
async function collect({ onlyNew = true } = {}) {
  const me = await whoAmI();
  let [mine, mentioned, stalled] = await Promise.all([
    bucketMine(me),
    bucketMentioned(me),
    bucketStalled(me),
  ]);

  mine = mine.map((i) => ({ ...i, bucket: 'mine' }));
  mentioned = mentioned.map((i) => ({ ...i, bucket: 'mentioned' }));
  // Каквото вече е в „моите", не го повтаряме в „бави се".
  const mineRefs = new Set(mine.map((i) => i.ref));
  stalled = stalled.filter((i) => !mineRefs.has(i.ref)).map((i) => ({ ...i, bucket: 'stalled' }));

  if (onlyNew) {
    [mine, mentioned, stalled] = await Promise.all([
      filterUnheard(mine), filterUnheard(mentioned), filterUnheard(stalled),
    ]);
  }

  return {
    me: { person_id: me.person_id, name: me.name },
    generated_at: new Date().toISOString(),
    only_new: onlyNew,
    counts: { mine: mine.length, mentioned: mentioned.length, stalled: stalled.length },
    mine,
    mentioned,
    stalled,
  };
}

const NARRATE_SYSTEM = `Ти си Митко — личният асистент на Венци (основател на видео агенция The Pact). Говориш му на глас, на български.

Пишеш текст, който ЩЕ БЪДЕ ИЗЧЕТЕН ОТ СИНТЕЗАТОР НА РЕЧ. Затова:
- само чист текст — без markdown, без заглавия, без звездички, без емоджита, без линкове, без изброявания с тирета;
- числата и датите ги пиши както се изговарят („до петък", „вчера", „три дни");
- кратки изречения, всяко на нов ред (така се говорят по-естествено);
- обръщай се към него на „ти"; наричай го „Вена".

Структура на брифинга:
1. Едно изречение общо: колко неща го чакат.
2. После по едно нещо на ред — какво е, къде е, и ЗАЩО чака него. Дай му яснота, не преразказ на заглавието. Пример за тон: „Имаш задача по ЕКОПАК КП-9 — Веси е качила промените и чака ти да ги прегледаш, за да тръгне към клиента."
3. Накрая, ако има: какво се бави или никой не е реагирал.

Правила:
- Ползвай САМО подадените данни. Не си измисляй карти, хора, дати или коментари.
- Ако нещо няма достатъчно контекст, кажи го кратко („без подробности в картата").
- Приоритет: просрочено и клиенти, които чакат отговор — първо.
- Ако няма нищо ново, кажи го с едно изречение и спри.
- Максимум около 250 думи — това се слуша, не се чете.`;

/**
 * Превръща структурата в текст за говорене (един Claude вик).
 */
async function narrate(data) {
  const total = data.counts.mine + data.counts.mentioned + data.counts.stalled;
  if (!total) {
    return data.only_new
      ? 'Няма нищо ново от последния път. Чисто е.'
      : 'В момента нямаш нищо отворено, което да чака теб.';
  }
  const today = new Date().toLocaleDateString('bg-BG', { timeZone: 'Europe/Sofia', weekday: 'long', day: 'numeric', month: 'long' });
  const res = await callClaude({
    system: NARRATE_SYSTEM,
    messages: [{
      role: 'user',
      content: `Днес е ${today}. Ето какво чака Вена (JSON). Направи говорим брифинг:\n\n${JSON.stringify({
        чака_мен: data.mine,
        тагнат_съм: data.mentioned,
        бави_се: data.stalled,
      }, null, 1)}`,
    }],
    maxTokens: 2000,
    effort: 'medium',
  });
  return (res.text || '').trim() || 'Не успях да съставя брифинга.';
}

module.exports = { collect, narrate, markTold, whoAmI, NO_REPLY_HOURS, STALE_DAYS };
