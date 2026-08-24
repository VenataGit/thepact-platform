// Shared Basecamp board loaders + per-client aggregation.
//
// loadStructure / loadBoardCards were extracted from routes/bc-board.js so the
// Clients overview reuses the SAME cached board fetches — opening a client costs
// ~0 extra Basecamp calls when the dashboard was viewed in the last ~30-60s.
// Everything runs AS the logged-in user (their own Basecamp token), never the bot.
//
// Card -> client + КП linkage is by TITLE only: the live Basecamp card carries no
// structured client/КП field (mapCard returns title/dueOn/completed/...). The team
// convention (confirmed) is "Cineland КП-18 - Видео 3 - …", produced by kp-split.js.
const config = require('../config');
const bc = require('./basecamp');
const { query } = require('../db/pool');
const prodSteps = require('./steps'); // не `steps` — isPriority() вече ползва това име за параметър

// Run async fn over items with limited concurrency (gentle on Basecamp rate limits).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

// Per-board rule: the card's tracked date comes from a STEP whose title starts with
// a prefix (settings key bc_step_date_rules, board title → prefix). Only one such
// step carries a due date (team convention). A completed dated step no longer counts
// as the pending deadline → fall back to the card's own due_on.
// Правилата идват от services/steps.js (новите имена по колона + старите за
// преходния период), а настройката bc_step_date_rules само ДОПЪЛВА този списък.
// Нарочно е така: миграциите не се прилагат при deploy, а в базата стои старата
// стойност ("Production" → "Видеограф"). Ако тя надделяваше, Pre-Production
// нямаше да получи правило и щеше да си остане на Due On.
let rulesCache = { at: 0, rules: null };
async function loadStepRules() {
  if (rulesCache.rules && Date.now() - rulesCache.at < 60_000) return rulesCache.rules;
  const rules = {};
  for (const board of Object.keys(prodSteps.BOARD_PREFIXES)) {
    rules[board] = prodSteps.prefixesForBoard(board);
  }
  try {
    const rows = await query("SELECT value FROM settings WHERE key = 'bc_step_date_rules'");
    const raw = rows && rows[0] ? JSON.parse(rows[0].value) : {};
    for (const [board, prefix] of Object.entries(raw)) {
      const key = String(board).trim().toLowerCase();
      const extra = (Array.isArray(prefix) ? prefix : [prefix])
        .map((p) => String(p || '').trim().toLowerCase())
        .filter(Boolean);
      if (!extra.length) continue;
      rules[key] = [...new Set([...(rules[key] || []), ...extra])];
    }
  } catch (e) {
    console.warn('[bc-aggregate] bc_step_date_rules unavailable:', e.message);
  }
  rulesCache = { at: Date.now(), rules };
  return rules;
}

// Стъпката на дъската — тази, чието заглавие започва с някой от префиксите. Редът на
// префиксите е важен: новото име се пробва първо, старите са резервни.
//
// Правилото (Венци, 24.08.2026): Due On на картата значи САМО „дата за публикуване" и
// вече не е срок на никой отдел — всяка колона следи своята стъпка. Затова:
//   * има чакаща стъпка с дата → нейната дата;
//   * стъпката е чекната → пак нейната дата, но отбелязана като готова (done), за да е
//     неутрална на цвят и да не се брои за просрочена — отделът е приключил;
//   * стъпката я има, но е БЕЗ дата → картата остава без дата („Няма дата"), вместо да
//     показва датата за публикуване като чужд срок;
//   * дъската изобщо няма такава стъпка (обикновена задача, не видео) → пада на Due On.
function stepDueOf(stepList, prefixes) {
  const pfx = (prefixes || []).filter(Boolean);
  if (!pfx.length) return null;
  const titled = (stepList || []).filter((x) => String(x.title || '').trim());
  for (const p of pfx) {
    const mine = titled.filter((x) => String(x.title).trim().toLowerCase().startsWith(p));
    if (!mine.length) continue;
    const pending = mine.find((x) => !x.completed && x.due_on);
    if (pending) return { due: pending.due_on, title: pending.title, done: false };
    const done = mine.find((x) => x.completed && x.due_on);
    if (done) return { due: done.due_on, title: done.title, done: true };
    // Стъпката съществува, но е без дата — нарочно връщаме „без дата", не Due On.
    return { due: null, title: mine[0].title, done: mine.every((x) => x.completed) };
  }
  return null;
}

// Чекната стъпка „Приоритет" = картата е приоритетна (лилава, най-отгоре в дашборда).
function isPriority(steps) {
  return (steps || []).some(
    (s) => s.completed && String(s.title || '').trim().toLowerCase().startsWith('приоритет')
  );
}

function mapCard(c, stepPrefix) {
  const sd = stepDueOf(c.steps, stepPrefix);
  const out = {
    id: c.id,
    title: c.title,
    dueOn: sd ? sd.due : c.due_on,
    completed: c.completed,
    assignees: (c.assignees || []).map((a) => ({ id: a.id, name: a.name })),
    stepsCount: (c.steps || []).length,
    url: bc.normalizeAppUrl(c.app_url), // 3.basecamp.com — там са сесията и тъмната тема
    position: c.position,
  };
  if (sd) {
    out.dueFromStep = true;
    out.dueStep = sd.title;
    out.dueStepDone = !!sd.done; // отделът е приключил — датата не е чакащ срок
    out.cardDueOn = c.due_on;
  }
  if (isPriority(c.steps)) out.priority = true;
  return out;
}

// Каноничната подредба на дъските — редът, по който задачите реално минават:
// Pre-Production → Production → Post-Production → Project Management.
// Венци (31.07.2026): „искам абсолютно навсякъде за в бъдеще да бъдат по този начин
// подредени, защото това е редът, по който минават задачите". Затова сортирането
// живее ТУК — в единствения източник на структурата — и важи за всеки изглед
// (Dashboard, КП настройки, Създаване на задачи, CRM, PM Agent…), вместо да се
// повтаря във всеки от тях. Дъската „Project Management" се води и по старото си
// име „Акаунт Мениджмънт". Непознати дъски запазват реда си от Basecamp, най-отзад.
function boardRank(title) {
  const t = (title || '').toLowerCase();
  if (/pre[\s-]*produc|предпрод/.test(t)) return 0;
  if (/post[\s-]*produc|пост[\s-]*продук/.test(t)) return 2;
  if (/produc|продук/.test(t)) return 1; // „Production" — pre/post вече са хванати
  if (/project\s*manage|проект\w*\s*мениджм|акаунт|account/.test(t)) return 3;
  return 999;
}
function sortBoards(boards) {
  return (boards || []).map((b, i) => ({ b, i }))
    .sort((x, y) => (boardRank(x.b.title) - boardRank(y.b.title)) || (x.i - y.i))
    .map((o) => o.b);
}

// The board is shared across team members, so cache both stages briefly.
let structCache = { at: 0, data: null };
const STRUCT_TTL = 60_000;
const cardsCache = new Map(); // cardTableId -> { at, cardTableId, columns }
const CARDS_TTL = 30_000;

async function loadStructure(token, account) {
  if (structCache.data && Date.now() - structCache.at < STRUCT_TTL) return structCache.data;
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  const project = await bc.getProject(token, account, projectId);
  const tools = (project.dock || []).filter((t) => t.enabled && /kanban|card/i.test(t.name));
  const boards = await mapLimit(tools, 3, async (t) => {
    const table = (await bc.authedGet(t.url, token)).json;
    return {
      id: table.id,
      title: t.title || table.title,
      projectId,
      columns: (table.lists || []).map((l) => ({ id: l.id, title: l.title, cardsCount: l.cards_count, isDone: /DoneColumn/i.test(l.type || '') })),
    };
  });
  structCache = { at: Date.now(), data: { projectId, boards: sortBoards(boards) } };
  return structCache.data;
}

async function loadBoardCards(token, account, cardTableId) {
  const key = String(cardTableId);
  const hit = cardsCache.get(key);
  if (hit && Date.now() - hit.at < CARDS_TTL) return hit;
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  const table = await bc.getCardTable(token, account, projectId, cardTableId);
  const rules = await loadStepRules();
  const stepPrefix = rules[String(table.title || '').trim().toLowerCase()] || [];
  const lists = table.lists || [];
  const columns = await mapLimit(lists, 5, async (list) => {
    const cards = list.cards_count > 0 ? await bc.getColumnCards(token, account, projectId, list.id) : [];
    // On-hold cards live in a separate section (column.on_hold) with its own cards list.
    let onHoldCards = [];
    if (list.on_hold && list.on_hold.cards_count > 0) {
      const oh = await bc.getColumnCards(token, account, projectId, list.on_hold.id);
      onHoldCards = oh.map((c) => { const m = mapCard(c, stepPrefix); m.onHold = true; return m; });
    }
    return { id: list.id, cards: cards.map((c) => mapCard(c, stepPrefix)), onHoldCards };
  });
  const result = { at: Date.now(), cardTableId: table.id, columns };
  cardsCache.set(key, result);
  return result;
}

function invalidateBoard(cardTableId) { cardsCache.delete(String(cardTableId)); }

// ==================== client aggregation ====================

// "Cineland КП-18 - Видео 3 - Заглавие" -> { client: "Cineland", kp: 18 }
// Also matches the plan card itself ("Cineland КП-18" / "Cineland КП-18 контент план").
function parseClientKp(title) {
  if (!title) return null;
  const m = String(title).match(/^(.+?)\s+(?:КП|KP)\s*[-–—]?\s*0*(\d+)/i);
  if (!m) return null;
  const client = m[1].trim().replace(/\s+/g, ' ');
  const kp = parseInt(m[2], 10);
  if (!client || !Number.isFinite(kp)) return null;
  return { client, kp };
}

function videoNumberOf(title) {
  const m = String(title || '').match(/Видео\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

// Map a board title to a stage role. Order matters (post/pre before production).
function boardRole(title) {
  const t = title || '';
  if (/pre[\s-]*prod|предпрод/i.test(t)) return 'pre';
  if (/post[\s-]*prod|пост/i.test(t)) return 'post';
  if (/акаунт|account/i.test(t)) return 'account';
  if (/produc|продукц/i.test(t)) return 'production';
  return 'other';
}

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(name || '?').slice(0, 2).toUpperCase();
}

function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return ymdLocal(dt);
}

// kp_clients holds curated metadata (videos/month, next КП date). Optional — if the
// table is missing or empty the overview still works purely from Basecamp titles.
async function loadRegistry() {
  const reg = {};
  try {
    const rows = await query('SELECT name, videos_per_month, current_kp_number, next_kp_date FROM kp_clients');
    for (const r of rows) {
      reg[String(r.name || '').trim().toLowerCase()] = {
        videosPerMonth: r.videos_per_month || null,
        currentKp: r.current_kp_number || null,
        nextKpDate: r.next_kp_date ? String(r.next_kp_date).split('T')[0] : null,
      };
    }
  } catch (e) {
    console.warn('[bc-aggregate] kp_clients registry unavailable:', e.message);
  }
  return reg;
}

function finalizePlan(plan) {
  const roles = ['pre', 'production', 'post', 'account', 'other'];
  const stages = {};
  for (const r of roles) stages[r] = { count: 0, active: 0, overdue: 0, videos: [] };
  const sorted = plan.videos.slice().sort((a, b) => (a.videoNumber || 999) - (b.videoNumber || 999));
  for (const v of sorted) {
    const s = stages[v.boardRole] || stages.other;
    s.videos.push(v);
    s.count += 1;
    if (v.overdue) s.overdue += 1;
    if (!v.completed && !v.isDoneColumn && !v.onHold) s.active += 1;
  }
  let planCard = plan.planCard;
  if (planCard) {
    const notFinal = /измисл|not\s*now/i.test(planCard.column || '') && !planCard.completed && !planCard.isDoneColumn;
    planCard = { ...planCard, finalized: !notFinal };
    planCard.planOverdue = !planCard.finalized && !!planCard.dueOn && planCard.overdue;
  }
  const totals = {
    active: sorted.filter((v) => !v.completed && !v.isDoneColumn && !v.onHold).length,
    overdue: sorted.filter((v) => v.overdue).length,
    soon: sorted.filter((v) => v.soon).length,
    done: sorted.filter((v) => v.completed || v.isDoneColumn).length,
  };
  return { kp: plan.kp, planCard, stages, videos: sorted, totals };
}

// Build the full per-client picture from every Video Production board (cached fetch).
async function aggregateAll(token, account) {
  const struct = await loadStructure(token, account);
  const boards = struct.boards || [];
  const today = ymdLocal(new Date());
  const soonEdge = addDaysYmd(today, 2);

  const perBoard = await mapLimit(boards, 4, async (b) => {
    try { return { board: b, data: await loadBoardCards(token, account, b.id) }; }
    catch (e) { console.warn('[bc-aggregate] board failed', b.title, e.message); return { board: b, data: { columns: [] } }; }
  });

  const clients = new Map(); // key -> { name, key, plans: Map<kp, plan> }

  for (const { board, data } of perBoard) {
    const role = boardRole(board.title);
    const colInfo = {};
    (board.columns || []).forEach((c) => { colInfo[c.id] = { title: c.title, isDone: !!c.isDone }; });
    for (const col of (data.columns || [])) {
      const info = colInfo[col.id] || { title: '', isDone: false };
      const cards = [
        ...(col.cards || []).map((c) => ({ ...c, onHold: false })),
        ...(col.onHoldCards || []).map((c) => ({ ...c, onHold: true })),
      ];
      for (const card of cards) {
        const parsed = parseClientKp(card.title);
        if (!parsed) continue;
        const key = parsed.client.toLowerCase();
        if (!clients.has(key)) clients.set(key, { name: parsed.client, key, plans: new Map() });
        const cl = clients.get(key);
        if (!cl.plans.has(parsed.kp)) cl.plans.set(parsed.kp, { kp: parsed.kp, planCard: null, videos: [] });
        const plan = cl.plans.get(parsed.kp);

        const vNum = videoNumberOf(card.title);
        const isVideo = vNum != null;
        const isDone = info.isDone;
        // Чекната стъпка = отделът е приключил; датата ѝ вече не е чакащ срок, затова
        // не вдига нито „просрочена", нито „наближава".
        const pending = !card.completed && !card.onHold && !isDone && !card.dueStepDone;
        const overdue = !!(card.dueOn && card.dueOn < today && pending);
        const soon = !overdue && !!(card.dueOn && card.dueOn >= today && card.dueOn <= soonEdge && pending);
        const entry = {
          id: card.id, title: card.title, videoNumber: vNum,
          board: board.title, boardId: board.id, boardRole: role,
          column: info.title, isDoneColumn: isDone,
          dueOn: card.dueOn || null, completed: !!card.completed, onHold: !!card.onHold,
          dueStepDone: !!card.dueStepDone,
          overdue, soon, url: card.url,
          // Датата на публикуване = собственият Due на картата. dueOn може да е изместен
          // към стъпка (bc_step_date_rules), затова тук винаги връщаме картовия Due.
          publishOn: (card.dueFromStep ? card.cardDueOn : card.dueOn) || null,
        };
        if (!isVideo && role === 'pre') {
          // The content-plan card itself. Prefer a non-archived/active one if duplicated.
          if (!plan.planCard || (plan.planCard.isDoneColumn && !isDone)) plan.planCard = entry;
        } else {
          plan.videos.push(entry);
        }
      }
    }
  }

  const registry = await loadRegistry();
  const out = [];
  for (const cl of clients.values()) {
    const plans = [...cl.plans.values()].map(finalizePlan).sort((a, b) => b.kp - a.kp);
    const kpNumbers = plans.map((p) => p.kp);
    const activeVideos = plans.reduce((s, p) => s + p.totals.active, 0);
    const overdueVideos = plans.reduce((s, p) => s + p.totals.overdue, 0);
    const soonVideos = plans.reduce((s, p) => s + p.totals.soon, 0);
    const planAlerts = plans
      .filter((p) => p.planCard && p.planCard.planOverdue)
      .map((p) => ({ kp: p.kp, column: p.planCard.column, dueOn: p.planCard.dueOn }));
    const meta = registry[cl.key] || null;
    const currentKp = (meta && meta.currentKp) || kpNumbers[0] || null;
    let signal = 'ok';
    if (overdueVideos > 0 || planAlerts.length > 0) signal = 'overdue';
    else if (soonVideos > 0) signal = 'warning';
    out.push({
      name: cl.name, key: cl.key, initials: initialsOf(cl.name),
      signal, currentKp, kpNumbers,
      activeVideos, overdueVideos, soonVideos,
      planAlert: planAlerts[0] || null,
      plans, meta,
    });
  }
  out.sort((a, b) => {
    const rank = { overdue: 0, warning: 1, ok: 2 };
    if (rank[a.signal] !== rank[b.signal]) return rank[a.signal] - rank[b.signal];
    return a.name.localeCompare(b.name, 'bg');
  });
  return { generatedAt: new Date().toISOString(), clients: out };
}

// Само имената на клиентите, както реално стоят в заглавията на картите. По-евтино
// от aggregateAll (без планове/стъпки), но ползва същите кеширани дъски. Служи за
// падащото меню при създаване на клиент/задача — да не се раждат втори изписвания
// на един и същи клиент („Св. Влас" срещу „Свети Влас").
async function listClientNames(token, account) {
  const struct = await loadStructure(token, account);
  const boards = struct.boards || [];
  const perBoard = await mapLimit(boards, 4, async (b) => {
    try { return await loadBoardCards(token, account, b.id); }
    catch (e) { console.warn('[bc-aggregate] board failed', b.title, e.message); return { columns: [] }; }
  });

  const seen = new Map(); // key -> { name, cards }
  for (const data of perBoard) {
    for (const col of (data.columns || [])) {
      for (const card of [...(col.cards || []), ...(col.onHoldCards || [])]) {
        const parsed = parseClientKp(card.title);
        if (!parsed) continue;
        const key = parsed.client.toLowerCase();
        const hit = seen.get(key);
        if (hit) hit.cards += 1;
        else seen.set(key, { name: parsed.client, cards: 1 });
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'bg'));
}

module.exports = {
  mapLimit, mapCard, stepDueOf, loadStructure, loadBoardCards, invalidateBoard,
  parseClientKp, aggregateAll, listClientNames, boardRank, sortBoards,
};
