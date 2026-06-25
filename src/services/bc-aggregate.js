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

function mapCard(c) {
  return {
    id: c.id,
    title: c.title,
    dueOn: c.due_on,
    completed: c.completed,
    assignees: (c.assignees || []).map((a) => ({ id: a.id, name: a.name })),
    stepsCount: (c.steps || []).length,
    url: c.app_url,
    position: c.position,
  };
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
  structCache = { at: Date.now(), data: { projectId, boards } };
  return structCache.data;
}

async function loadBoardCards(token, account, cardTableId) {
  const key = String(cardTableId);
  const hit = cardsCache.get(key);
  if (hit && Date.now() - hit.at < CARDS_TTL) return hit;
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  const table = await bc.getCardTable(token, account, projectId, cardTableId);
  const lists = table.lists || [];
  const columns = await mapLimit(lists, 5, async (list) => {
    const cards = list.cards_count > 0 ? await bc.getColumnCards(token, account, projectId, list.id) : [];
    // On-hold cards live in a separate section (column.on_hold) with its own cards list.
    let onHoldCards = [];
    if (list.on_hold && list.on_hold.cards_count > 0) {
      const oh = await bc.getColumnCards(token, account, projectId, list.on_hold.id);
      onHoldCards = oh.map((c) => { const m = mapCard(c); m.onHold = true; return m; });
    }
    return { id: list.id, cards: cards.map(mapCard), onHoldCards };
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
        const overdue = !!(card.dueOn && card.dueOn < today && !card.completed && !card.onHold && !isDone);
        const soon = !overdue && !!(card.dueOn && card.dueOn >= today && card.dueOn <= soonEdge && !card.completed && !card.onHold && !isDone);
        const entry = {
          id: card.id, title: card.title, videoNumber: vNum,
          board: board.title, boardId: board.id, boardRole: role,
          column: info.title, isDoneColumn: isDone,
          dueOn: card.dueOn || null, completed: !!card.completed, onHold: !!card.onHold,
          overdue, soon, url: card.url,
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

module.exports = {
  mapLimit, mapCard, loadStructure, loadBoardCards, invalidateBoard,
  parseClientKp, aggregateAll,
};
