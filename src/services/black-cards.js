// Черни карти — дневен анализ в Message Board на Video Production (Венци, 13.11.2026,
// гласова бележка в задача „Черни карти информация").
//
// „Черна" карта = просрочена: датата, която картата показва в своята дъска (стъпката на
// отдела — виж #/board-logic т.3 и bc-aggregate.stepDueOf), е преди днес. Точно като
// цвета в Таблото: чекната стъпка НЕ я изчиства, приоритетните са бели, „Done" и
// „Not now" не се броят.
//
// Всеки работен ден (без съботи, недели и БГ празници) в 10:00 — едно съобщение в
// Message Board-а „Черни карти":
//   1. най-отгоре: какво сме изчистили от вчерашните черни карти + кой го е направил
//      (по дневниците bc_stage_events / bc_card_text_log), с таг на човека;
//   2. всички черни карти сега — линк, къде е, с колко е просрочена, плюс анализ от
//      Claude (през абонамента, ai-queue): какво има в картата, кой трябва да я
//      задвижи, следващите стъпки и каква информация липсва.
// Тагва се целият екип (bc_people, без бота) и само те са абонати.
//
// Данните идват от снапшота на PM агента (bc_cards_snap / bc_comments_snap /
// bc_vault_snap, обновява се на 15 мин) — нито една допълнителна заявка към Basecamp
// освен самото съобщение.
//
// Настройки (таблица settings):
//   black_cards_enabled   — 'false' спира
//   black_cards_board_url — линк към Message Board-а (…/buckets/{project}/message_boards/{board})
//   black_cards_state     — вътрешно: черните карти от последното съобщение (за „изчистени")
const cron = require('node-cron');
const config = require('../config');
const { query, queryOne, execute } = require('../db/pool');
const bc = require('./basecamp');
const { getServiceAuth } = require('./basecamp-token');
const { stepDueOf, loadStepRules, parseClientKp, videoNumberOf } = require('./bc-aggregate');
const prodSteps = require('./steps');
const { holidaySet } = require('./workdays');
const { plainText } = require('./card-text-log');

const TZ = 'Europe/Sofia';
const DEFAULT_BOARD_URL = 'https://3.basecamp.com/5750544/buckets/39396506/message_boards/10507991585';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sofiaDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD
const ymdOf = (v) => {
  if (!v) return null;
  if (v instanceof Date) return sofiaDate(v);
  return String(v).slice(0, 10);
};
const dm = (s) => (s ? s.slice(8, 10) + '.' + s.slice(5, 7) : '—');
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const cut = (s, n) => { s = String(s || '').replace(/\n{3,}/g, '\n\n').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const asArr = (v) => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };

function parseBoardUrl(url) {
  const m = String(url || '').match(/buckets\/(\d+)\/message_boards\/(\d+)/);
  return m ? { project: Number(m[1]), board: Number(m[2]) } : null;
}

const getSetting = async (key) => (await queryOne('SELECT value FROM settings WHERE key = $1', [key]))?.value ?? null;
const saveSetting = (key, value) => execute(
  `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
   ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
  [key, String(value)]
);

// „Done" / „Not now" колоните не са работа за вършене — като в Таблото (скрити по подразбиране).
const isParkedColumn = (t) => /not\s*now/i.test(t || '') || /^\s*(done|готово)\s*$/i.test(t || '');

// Датата, която картата показва в своята дъска (същото правило като mapCard в bc-aggregate).
function effectiveDue(row, rules) {
  const steps = asArr(row.steps);
  const sd = stepDueOf(steps, rules[String(row.board_title || '').trim().toLowerCase()] || []);
  if (sd) return { due: ymdOf(sd.due), step: sd.title, stepDone: !!sd.done };
  return { due: ymdOf(row.due_on), step: null, stepDone: false };
}

// Черна ли е картата днес. Връща { due, step, stepDone, overdue } или null.
function blackInfo(row, rules, today) {
  if (row.completed || isParkedColumn(row.column_title)) return null;
  const steps = asArr(row.steps);
  if (steps.some((s) => s.completed && prodSteps.isPriorityTitle(s.title))) return null; // приоритет = бяла
  const e = effectiveDue(row, rules);
  if (!e.due || e.due >= today) return null;
  return { ...e, overdue: daysBetween(e.due, today) };
}

async function loadCards() {
  return query(
    `SELECT card_id, board_title, column_title, title, content, due_on, completed, assignees, steps,
            app_url, on_hold, active, bc_updated_at
       FROM bc_cards_snap WHERE project_id = $1`,
    [config.BASECAMP_TEAM_PROJECT_ID]
  );
}

async function findBlack(rows, rules, today) {
  const out = [];
  for (const r of rows) {
    if (!r.active) continue;
    const info = blackInfo(r, rules, today);
    if (info) out.push({ row: r, ...info });
  }
  // най-просрочените най-отгоре, групирани по реда на отделите
  const rank = (b) => { const i = ['pre-production', 'production', 'post-production', 'project management'].indexOf(String(b || '').toLowerCase()); return i < 0 ? 9 : i; };
  out.sort((a, b) => rank(a.row.board_title) - rank(b.row.board_title) || b.overdue - a.overdue);
  return out;
}

// ---------- кой какво е изчистил ----------

// Защо вчерашна черна карта вече не е черна и кой го е направил.
async function clearedSince(prev, rowsById, rules, today) {
  if (!prev || !Array.isArray(prev.cards) || !prev.at) return [];
  const out = [];
  for (const p of prev.cards) {
    const now = rowsById.get(String(p.id));
    if (now && now.active && blackInfo(now, rules, today)) continue; // още е черна
    let how;
    if (!now || !now.active) how = 'приключена / махната от дъските';
    else if (now.completed || /^\s*(done|готово)\s*$/i.test(now.column_title || '')) how = 'приключена';
    else if (/not\s*now/i.test(now.column_title || '')) how = 'преместена в „Not now"';
    else if (String(now.board_title) !== String(p.board)) how = 'преместена в ' + now.board_title + ' → ' + now.column_title;
    else if (asArr(now.steps).some((s) => s.completed && prodSteps.isPriorityTitle(s.title))) how = 'маркирана като приоритет';
    else how = 'с нов срок (' + dm(effectiveDue(now, rules).due) + ')';
    const who = await queryOne(
      `SELECT who_id, who_name FROM (
         SELECT who_id, who_name, occurred_at AS t FROM bc_stage_events
          WHERE card_id = $1 AND occurred_at > $2 AND who_name <> ''
         UNION ALL
         SELECT who_id, who_name, created_at AS t FROM bc_card_text_log
          WHERE card_id = $1 AND created_at > $2 AND who_name <> ''
       ) x ORDER BY t DESC LIMIT 1`,
      [p.id, p.at || prev.at]
    ).catch(() => null);
    out.push({ id: p.id, title: (now && now.title) || p.title, url: (now && now.app_url) || p.url, how, whoId: who && who.who_id, whoName: who && who.who_name });
  }
  return out;
}

// ---------- контекст за анализа ----------

async function cardContext(black) {
  const ids = black.map((b) => b.row.card_id);
  const comments = ids.length ? await query(
    `SELECT parent_id, creator_name, creator_is_client, content, bc_created_at FROM (
       SELECT c.*, ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY bc_created_at DESC) rn
         FROM bc_comments_snap c WHERE parent_id = ANY($1::bigint[])) x
      WHERE rn <= 6 ORDER BY parent_id, bc_created_at`,
    [ids]
  ).catch(() => []) : [];
  const byCard = new Map();
  comments.forEach((c) => { const k = String(c.parent_id); if (!byCard.has(k)) byCard.set(k, []); byCard.get(k).push(c); });
  return byCard;
}

// Профилът на клиента: КП картата (планът) + документите в Basecamp със същото име.
async function clientContext(black, allRows) {
  const clients = new Map();
  for (const b of black) {
    const ck = parseClientKp(b.row.title);
    if (ck && !clients.has(ck.client.toLowerCase())) clients.set(ck.client.toLowerCase(), ck.client);
  }
  const out = [];
  for (const [key, name] of clients) {
    const plan = allRows
      .filter((r) => r.active && videoNumberOf(r.title) == null && (parseClientKp(r.title) || {}).client?.toLowerCase() === key)
      .sort((a, b) => (parseClientKp(b.title).kp - parseClientKp(a.title).kp))[0];
    const docs = await query(
      `SELECT title, content FROM bc_vault_snap
        WHERE active AND kind = 'document' AND title ILIKE $1 AND length(content) > 0
        ORDER BY bc_updated_at DESC NULLS LAST LIMIT 2`,
      ['%' + name.replace(/[%_]/g, '') + '%']
    ).catch(() => []);
    const parts = [];
    if (plan) parts.push('КП карта „' + plan.title + '" (' + plan.board_title + ' → ' + plan.column_title + '):\n' + cut(plainText(plan.content), 1500));
    docs.forEach((d) => parts.push('Документ „' + d.title + '":\n' + cut(plainText(d.content), 1500)));
    if (parts.length) out.push('### ' + name + '\n' + parts.join('\n\n'));
  }
  return out.join('\n\n');
}

function cardBrief(b, comments) {
  const r = b.row;
  const steps = asArr(r.steps).map((s) => '  - [' + (s.completed ? 'x' : ' ') + '] ' + s.title +
    (s.due_on ? ' (до ' + dm(ymdOf(s.due_on)) + ')' : ' (без дата)') +
    (s.assignees && s.assignees.length ? ' — ' + s.assignees.join(', ') : '')).join('\n');
  const com = (comments || []).map((c) => '  - ' + (c.creator_is_client ? '[КЛИЕНТ] ' : '') + c.creator_name + ' (' + dm(ymdOf(c.bc_created_at)) + '): ' + cut(plainText(c.content), 300)).join('\n');
  return [
    'ID: ' + r.card_id,
    'Заглавие: ' + r.title,
    'Къде: ' + r.board_title + ' → ' + r.column_title + (r.on_hold ? ' (ON HOLD — спряна)' : ''),
    'Срок в тази дъска: ' + dm(b.due) + (b.step ? ' (от стъпка „' + b.step + '"' + (b.stepDone ? ', ЧЕКНАТА — отделът е приключил, картата не е преместена' : '') + ')' : ' (Due On)') + ' — просрочена с ' + b.overdue + ' дни',
    'Дата за публикуване (Due On): ' + dm(ymdOf(r.due_on)),
    'Отговорници на картата: ' + (asArr(r.assignees).map((a) => a.name).join(', ') || 'няма'),
    'Стъпки:\n' + (steps || '  няма'),
    'Описание:\n' + (cut(plainText(r.content), 1200) || '  празно'),
    'Последни коментари:\n' + (com || '  няма'),
  ].join('\n');
}

const SYSTEM = `Ти си проджект мениджър в The Pact — българска агенция за видео продукция.
Процесът: Pre-Production (идея/сценарий) → Production (снимане) → Post-Production (монтаж) → Project Management (към клиента, качване/насрочване).
Всяка дъска следи своята стъпка („Pre-Production - Готов сценарий", „Production - Заснет материал", „Post-Production - Приключен монтаж", „Project Management - Качване/Насрочване"). Due On на картата = датата за публикуване.
Черна карта = срокът ѝ в текущата дъска е минал. Целта е екипът да задвижи и приключи тези карти.
Пишеш на български, кратко и конкретно, без празни приказки. Опирай се САМО на дадената информация — не измисляй факти; ако нещо не е ясно, кажи какво липсва.`;

function buildPrompt(black, ctxByCard, clientsText, team) {
  return `Днес е ${sofiaDate(new Date())}. Ето черните (просрочени) карти във Video Production.

Екипът (използвай ТОЧНО тези имена в "who"):
${team.map((p) => '- ' + p.name + ' — ' + (p.title || '')).join('\n')}

Профили на клиентите:
${clientsText || '(няма)'}

Карти:
${black.map((b) => cardBrief(b, ctxByCard.get(String(b.row.card_id)))).join('\n\n---\n\n')}

За ВСЯКА карта върни анализ. Отговори САМО с валиден JSON (без markdown). В текстовете НЕ ползвай знака " — за цитати ползвай „ и “. Формат:
{"summary": "2-3 изречения общ поглед — къде е задръстването и какво е най-спешно",
 "cards": [{"id": <ID>,
            "who": ["Име от екипа", ...],     // кой трябва да задейства картата сега (1-2 души)
            "status": "какво има в картата и докъде е стигнала — 1-2 изречения",
            "next": ["следваща стъпка 1", "стъпка 2"],   // конкретни действия, кой какво прави
            "missing": "каква информация липсва или трябва да се извлече, за да се приключи (празно, ако няма)"}]}`;
}

// Claude често затваря българските кавички „…" с ASCII " — това чупи JSON-а.
// Втори опит: „текст" → „текст“.
function parseJson(text) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  const raw = s.slice(a, b + 1);
  try { return JSON.parse(raw); } catch { /* опитай с поправка */ }
  try { return JSON.parse(raw.replace(/„([^"„“\n]{0,300})"/g, '„$1“')); } catch { return null; }
}

// По един анализ на отдел (и на парчета до 30 карти) — 80+ карти в една заявка са
// твърде тежки за абонамента. Обобщението на всяко парче стои под заглавието на отдела.
async function analyze(black, allRows, team) {
  const byId = new Map();
  const summaries = new Map(); // board_title → [текст]
  const errors = [];
  if (!black.length) return { byId, summaries, errors };
  const { callClaude } = require('./pm-agent/claude');
  const groups = [];
  for (const b of black) {
    const last = groups[groups.length - 1];
    if (last && last.board === b.row.board_title && last.cards.length < 30) last.cards.push(b);
    else groups.push({ board: b.row.board_title, cards: [b] });
  }
  for (const g of groups) {
    try {
      const ctxByCard = await cardContext(g.cards);
      const clientsText = await clientContext(g.cards, allRows);
      const res = await callClaude({
        system: SYSTEM,
        messages: [{ role: 'user', content: buildPrompt(g.cards, ctxByCard, clientsText, team) }],
        maxTokens: 16000,
        effort: 'medium',
      });
      const j = parseJson(res.text);
      if (!j || !Array.isArray(j.cards)) throw new Error('анализът не върна валиден JSON');
      j.cards.forEach((c) => { if (c && c.id != null) byId.set(String(c.id), c); });
      if (j.summary) { if (!summaries.has(g.board)) summaries.set(g.board, []); summaries.get(g.board).push(String(j.summary)); }
    } catch (err) {
      errors.push(g.board + ': ' + err.message);
    }
  }
  return { byId, summaries, errors };
}

// ---------- съобщението ----------

function mention(people, idOrName) {
  const p = people.find((x) => String(x.person_id) === String(idOrName)) ||
    people.find((x) => String(x.name).trim().toLowerCase() === String(idOrName || '').trim().toLowerCase());
  if (p && p.attachable_sgid) return '<bc-attachment sgid="' + esc(p.attachable_sgid) + '"></bc-attachment>';
  return idOrName ? '<strong>' + esc(p ? p.name : idOrName) + '</strong>' : '';
}

function buildMessage({ today, black, cleared, analysis, analysisError, people, team }) {
  const html = [];
  html.push(team.map((p) => mention(people, p.person_id)).join(' '));

  // 1) изчистено от вчера — най-отгоре
  if (cleared.length) {
    html.push('<h1>✅ Изчистено от последния път (' + cleared.length + ')</h1>');
    html.push('<ul>' + cleared.map((c) => '<li><a href="' + esc(bc.normalizeAppUrl(c.url)) + '">' + esc(c.title) + '</a> — ' + esc(c.how) +
      (c.whoName ? ' · ' + mention(people, c.whoId || c.whoName) : '') + '</li>').join('') + '</ul>');
  }

  // 2) черните карти сега
  html.push('<h1>⬛ Черни карти днес: ' + black.length + '</h1>');
  if (!black.length) html.push('Няма просрочени карти. 🎉');
  if (analysisError) html.push('<em>⚠ Анализът не успя навсякъде (' + esc(analysisError) + ') — там са само фактите от картите.</em>');

  let board = null;
  let items = [];
  const flush = () => { if (items.length) html.push('<ul>' + items.join('') + '</ul>'); items = []; };
  for (const b of black) {
    const r = b.row;
    if (r.board_title !== board) { flush(); board = r.board_title; html.push('<h2>' + esc(board) + '</h2>');
      ((analysis && analysis.summaries.get(board)) || []).forEach((t) => html.push('<em>' + esc(t) + '</em>')); }
    const a = (analysis && analysis.byId.get(String(r.card_id))) || null;
    const lines = [];
    lines.push('<a href="' + esc(bc.normalizeAppUrl(r.app_url)) + '"><strong>' + esc(r.title) + '</strong></a>');
    lines.push(esc(r.column_title) + (r.on_hold ? ' (On Hold)' : '') + ' · просрочена с <strong>' + b.overdue + ' ' + (b.overdue === 1 ? 'ден' : 'дни') + '</strong> (срок ' + dm(b.due) +
      (b.step ? ', „' + esc(b.step) + '"' + (b.stepDone ? ' — чекната, чака преместване' : '') : '') + ') · публикуване ' + dm(ymdOf(r.due_on)));
    const who = a && Array.isArray(a.who) && a.who.length ? a.who : asArr(r.assignees).map((x) => x.name);
    if (who.length) lines.push('👤 Задвижва: ' + who.map((n) => mention(people, n)).join(' '));
    if (a && a.status) lines.push('📋 ' + esc(a.status));
    if (a && Array.isArray(a.next) && a.next.length) lines.push('➡️ Следващи стъпки: ' + a.next.map((s) => esc(s)).join('; '));
    if (a && a.missing) lines.push('❓ Липсва: ' + esc(a.missing));
    items.push('<li>' + lines.join('<br>') + '</li>');
  }
  flush();

  const subject = '⬛ Черни карти — ' + dm(today) + ': ' + black.length + (cleared.length ? ', изчистени ' + cleared.length : '');
  return { subject, content: '<div>' + html.join('<br>') + '</div>' };
}

// ---------- главното ----------

async function loadConfig() {
  const boardUrl = (await getSetting('black_cards_board_url')) || DEFAULT_BOARD_URL;
  return { enabled: (await getSetting('black_cards_enabled')) !== 'false', boardUrl, ids: parseBoardUrl(boardUrl) };
}

function isWorkday(ymd) {
  const d = new Date(ymd + 'T00:00:00Z');
  const w = d.getUTCDay();
  return w !== 0 && w !== 6 && !holidaySet(d.getUTCFullYear()).has(ymd);
}

// dryRun → само сглобява съобщението, не праща и не пипа състоянието.
async function runBlackCards({ now = new Date(), dryRun = false, force = false } = {}) {
  const cfg = await loadConfig();
  if (!cfg.enabled && !dryRun) return { skipped: 'disabled' };
  if (!cfg.ids) throw new Error('Невалиден линк към Message Board: ' + cfg.boardUrl);
  const today = sofiaDate(now);
  if (!force && !dryRun && !isWorkday(today)) return { skipped: 'non-working day' };

  const rules = await loadStepRules();
  const rows = await loadCards();
  const rowsById = new Map(rows.map((r) => [String(r.card_id), r]));
  const black = await findBlack(rows, rules, today);
  let prev = null;
  try { prev = JSON.parse((await getSetting('black_cards_state')) || 'null'); } catch { prev = null; }
  const cleared = await clearedSince(prev, rowsById, rules, today);

  const people = await query('SELECT person_id, name, title, attachable_sgid, active FROM bc_people');
  const auth = dryRun ? null : await getServiceAuth();
  const botName = /thepactalerts/i;
  const team = people.filter((p) => p.active && !botName.test(p.name || ''));

  let analysis = null, analysisError = null;
  try {
    analysis = await analyze(black, rows, team);
    if (analysis.errors.length) analysisError = analysis.errors.join('; ');
  } catch (err) { analysisError = err.message; }
  if (analysisError) console.error('[black-cards] анализ:', analysisError);

  const msg = buildMessage({ today, black, cleared, analysis, analysisError, people, team });
  if (dryRun) return { dryRun: true, black: black.length, cleared: cleared.length, analysisError, msg };

  await bc.createMessage(auth.token, auth.account, cfg.ids.project, cfg.ids.board, {
    ...msg, subscriptions: team.map((p) => Number(p.person_id)),
  });
  // чак след успешно пращане
  await saveSetting('black_cards_state', JSON.stringify({
    at: now.toISOString(),
    cards: black.map((b) => ({ id: String(b.row.card_id), title: b.row.title, url: b.row.app_url, board: b.row.board_title, at: now.toISOString() })),
  }));
  return { black: black.length, cleared: cleared.length, analysisError, sent: true };
}

function initBlackCards() {
  cron.schedule('0 10 * * 1-5', () => {
    runBlackCards().then((r) => console.log('[black-cards]', JSON.stringify(r)))
      .catch((e) => console.error('[black-cards]', e.message));
  }, { timezone: TZ });
  console.log('  Black cards: active (работни дни в 10:00)');
}

module.exports = { initBlackCards, runBlackCards, blackInfo, clearedSince, parseJson, buildMessage, isWorkday, parseBoardUrl, DEFAULT_BOARD_URL };
