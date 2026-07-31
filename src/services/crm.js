// CRM — чистата логика (без мрежа и без Express).
//
// Тук живеят трите неща, които правят един CRM полезен, вместо просто списък:
//   1. „Следваща стъпка"  — сделка без насрочено следващо действие е мъртва сделка.
//   2. Застояване         — колко дни сделката стои в един етап спрямо нормата за етапа.
//   3. Претеглена прогноза — сумата по вероятността на етапа, не по мечтите.
// Заявките към базата стоят в routes/crm.js, за да може всичко тук да се тества.
const { query, queryOne, execute } = require('../db/pool');

const MAX_TEXT = 200;
const MAX_LONG = 10000;
const MAX_VALUE = 100000000; // 100 млн. — таван срещу изтървана нула

const DEAL_KINDS = ['note', 'call', 'meeting', 'email'];

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function isDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

// ---------- валидация на сделка ----------

// Връща изчистените полета или хвърля Error с текст на български (той отива право
// към човека). `partial` = PUT, при който липсващо поле значи „не го пипай".
function normalizeDeal(body, partial) {
  const b = body || {};
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);

  if (!partial || has('title')) {
    const title = clean(b.title, MAX_TEXT);
    if (!title) throw new Error('Напиши име на сделката.');
    out.title = title;
  }
  ['company', 'contact_name', 'contact_email', 'contact_phone', 'source', 'next_step', 'lost_reason'].forEach((k) => {
    if (!partial || has(k)) out[k] = clean(b[k], MAX_TEXT);
  });
  if (!partial || has('notes')) out.notes = clean(b.notes, MAX_LONG);

  if (!partial || has('value')) {
    const raw = String(b.value == null ? '' : b.value).replace(',', '.').replace(/\s/g, '');
    const num = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(num) || num < 0) throw new Error('Стойността трябва да е число (лв.).');
    if (num > MAX_VALUE) throw new Error('Стойността изглежда прекалено голяма — провери я.');
    out.value = Math.round(num * 100) / 100;
  }
  if (!partial || has('recurring')) out.recurring = !!b.recurring;

  if (!partial || has('next_step_at')) {
    const d = b.next_step_at ? String(b.next_step_at).slice(0, 10) : '';
    if (d && !isDate(d)) throw new Error('Невалидна дата за следващата стъпка.');
    out.next_step_at = d || null;
  }
  if (!partial || has('owner_id')) {
    const id = parseInt(b.owner_id, 10);
    out.owner_id = Number.isFinite(id) && id > 0 ? id : null;
  }
  if (!partial || has('stage_id')) {
    const id = parseInt(b.stage_id, 10);
    if (!Number.isFinite(id) || id <= 0) throw new Error('Избери етап.');
    out.stage_id = id;
  }
  return out;
}

// ---------- здраве на сделката ----------

const DAY = 24 * 60 * 60 * 1000;
const todayISO = (now) => new Date(now == null ? Date.now() : now).toISOString().slice(0, 10);

function daysBetween(from, to) {
  if (!from) return 0;
  const a = new Date(from).getTime();
  if (Number.isNaN(a)) return 0;
  return Math.max(0, Math.floor((to - a) / DAY));
}

// Сигналите за една сделка. `stage` може да липсва (изтрит етап) — тогава без застояване.
function dealHealth(deal, stage, now) {
  const t = now == null ? Date.now() : now;
  const open = deal.status === 'open';
  const daysInStage = daysBetween(deal.stage_since || deal.created_at, t);
  const rotDays = stage && Number.isFinite(Number(stage.rot_days)) ? Number(stage.rot_days) : 0;
  const nextAt = deal.next_step_at ? String(deal.next_step_at).slice(0, 10) : '';
  const today = todayISO(t);
  return {
    daysInStage,
    rotting: open && rotDays > 0 && daysInStage > rotDays,
    nextStepOverdue: open && !!nextAt && nextAt < today,
    nextStepToday: open && !!nextAt && nextAt === today,
    noNextStep: open && !nextAt,
  };
}

// ---------- показатели ----------

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Обобщението над всички неархивирани сделки.
// `windowDays` — прозорецът за „спечелени напоследък" (по подразбиране 30 дни).
function computeMetrics(deals, stages, now, windowDays) {
  const t = now == null ? Date.now() : now;
  const win = windowDays || 30;
  const byStage = new Map((stages || []).map((s) => [Number(s.id), s]));
  const list = (deals || []).filter((d) => !d.archived);

  const open = list.filter((d) => d.status === 'open');
  const won = list.filter((d) => d.status === 'won');
  const lost = list.filter((d) => d.status === 'lost');

  const pipelineValue = open.reduce((sum, d) => sum + num(d.value), 0);
  const weighted = open.reduce((sum, d) => {
    const st = byStage.get(Number(d.stage_id));
    return sum + num(d.value) * (num(st && st.probability) / 100);
  }, 0);

  const inWindow = (d) => d.closed_at && t - new Date(d.closed_at).getTime() <= win * DAY;
  const wonRecent = won.filter(inWindow);
  const lostRecent = lost.filter(inWindow);

  const closed = won.length + lost.length;
  const winRate = closed ? Math.round((won.length / closed) * 100) : null;

  const cycles = won
    .filter((d) => d.closed_at && d.created_at)
    .map((d) => daysBetween(d.created_at, new Date(d.closed_at).getTime()));
  const avgDaysToWin = cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null;

  let overdue = 0, rotting = 0, noNext = 0;
  open.forEach((d) => {
    const h = dealHealth(d, byStage.get(Number(d.stage_id)), t);
    if (h.nextStepOverdue) overdue++;
    if (h.rotting) rotting++;
    if (h.noNextStep) noNext++;
  });

  return {
    openCount: open.length,
    pipelineValue: Math.round(pipelineValue * 100) / 100,
    weighted: Math.round(weighted * 100) / 100,
    wonCount: won.length,
    wonRecentCount: wonRecent.length,
    wonRecentValue: Math.round(wonRecent.reduce((s, d) => s + num(d.value), 0) * 100) / 100,
    lostRecentCount: lostRecent.length,
    lostCount: lost.length,
    winRate,
    avgDaysToWin,
    needAttention: { overdue, rotting, noNext },
    windowDays: win,
  };
}

// Фунията: по колко сделки и колко пари стоят във всеки етап.
function funnel(stages, deals) {
  const list = (deals || []).filter((d) => !d.archived);
  return (stages || []).map((s) => {
    const mine = list.filter((d) => Number(d.stage_id) === Number(s.id));
    return {
      id: Number(s.id),
      title: s.title,
      kind: s.kind,
      count: mine.length,
      value: Math.round(mine.reduce((sum, d) => sum + num(d.value), 0) * 100) / 100,
    };
  });
}

// ---------- достъп ----------
// Пълните админи имат достъп по право. Останалите — само ако някой ги е пуснал.

async function getAccess(user) {
  if (!user) return { access: false, canGrant: false, isAdmin: false };
  if (user.role === 'admin') return { access: true, canGrant: true, isAdmin: true };
  const row = await queryOne('SELECT can_grant FROM crm_access WHERE user_id = $1', [user.userId]);
  if (!row) return { access: false, canGrant: false, isAdmin: false };
  return { access: true, canGrant: row.can_grant !== false, isAdmin: false };
}

async function listAccess() {
  return query(
    `SELECT a.user_id, a.granted_by, a.can_grant, a.granted_at,
            u.name, u.email, u.avatar_url, u.role,
            g.name AS granted_by_name
       FROM crm_access a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN users g ON g.id = a.granted_by
      ORDER BY a.granted_at ASC`
  );
}

// Отнемането маха и всички, пуснати ОТ този човек (и надолу) — иначе остават хора
// с достъп, чийто източник вече го няма. UNION (не UNION ALL) спира евентуален цикъл.
async function revokeAccess(userId) {
  const rows = await query(
    `WITH RECURSIVE sub AS (
        SELECT user_id FROM crm_access WHERE user_id = $1
        UNION
        SELECT a.user_id FROM crm_access a JOIN sub s ON a.granted_by = s.user_id
     )
     DELETE FROM crm_access WHERE user_id IN (SELECT user_id FROM sub) RETURNING user_id`,
    [userId]
  );
  return rows.map((r) => r.user_id);
}

async function grantAccess(userId, grantedBy, canGrant) {
  await execute(
    `INSERT INTO crm_access (user_id, granted_by, can_grant) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET can_grant = EXCLUDED.can_grant`,
    [userId, grantedBy, canGrant !== false]
  );
}

module.exports = {
  DEAL_KINDS, clean, isDate, normalizeDeal, dealHealth, computeMetrics, funnel,
  getAccess, listAccess, grantAccess, revokeAccess,
  MAX_TEXT, MAX_LONG,
};
