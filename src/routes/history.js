// Дневник „История" (#/history) — кой какво и кога е правил.
//
// Тук НИЩО не се записва. Платформата вече води няколко отделни дневника, но всеки
// се вижда на различно място (или изобщо не се вижда). Този маршрут ги чете и ги
// нормализира до един и същ вид, за да стоят на едно място с таб за всяка дейност.
//
// Поводът: картите в Basecamp се създават от бота ThePactAlerts, затова там авторът
// е винаги един и същ — кой ги е поръчал наистина се вижда само от платформата.
//
// Достъп: страницата е за ЦЕЛИЯ екип. Единственото изключение е табът CRM — сделки
// и суми се виждат само от хората с поименен достъп до инструмента (crm_access).
//
// Филтрите (период, човек, задача, търсене) се прилагат в SQL-а, а не върху вече
// свалените редове. Иначе „последните 24 часа" щеше да търси само в последните 60
// записа и да пропуска всичко останало.
const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const cardTextLog = require('../services/card-text-log');
const crm = require('../services/crm');

const MAX_LIMIT = 500;

// Периодите, които се предлагат в лентата с филтри. `all` = без ограничение.
const RANGES = { '24h': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365 };

function sinceFromRange(range) {
  const days = RANGES[range];
  if (!days) return null;
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}

// Един източник да падне (липсваща таблица, стара база) не бива да събаря целия
// изглед — дневникът на производствения календар например се създава в движение.
async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[history:${label}]`, err.message);
    return [];
  }
}

// pg връща DATE като Date на ЛОКАЛНА полунощ — компонентите се четат локално,
// защото през UTC на сървър извън UTC би излязъл предният ден.
// Тук минават и стойности, които изобщо не са дати (заглавие, приоритет) — те се
// връщат както са, вместо да чупят четенето.
function dmy(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(v.getDate())}.${p(v.getMonth() + 1)}.${v.getFullYear()}`;
  }
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

const firstUrl = (s) => {
  const m = /https?:\/\/\S+/.exec(String(s || ''));
  return m ? m[0].replace(/[),.;]+$/, '') : '';
};

// kp_audit_log пази цялото тяло на заявката като JSON — на екрана става четим ред.
function prettyDetails(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s.startsWith('{')) return s.slice(0, 400);
  try {
    const obj = JSON.parse(s);
    return Object.keys(obj)
      .filter((k) => obj[k] !== null && obj[k] !== undefined && obj[k] !== '')
      .map((k) => `${k}: ${typeof obj[k] === 'object' ? JSON.stringify(obj[k]) : obj[k]}`)
      .join(' · ')
      .slice(0, 400);
  } catch {
    return s.slice(0, 400);
  }
}

const asObj = (v) => {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v) || {}; } catch { return {}; }
};

const DATE_FIELD_LABELS = {
  publish_date: 'датата на публикуване',
  brainstorm_date: 'датата за измисляне',
  filming_date: 'датата за снимане',
  editing_date: 'датата за монтаж',
  upload_date: 'датата за качване',
  due_on: 'крайния срок',
  title: 'заглавието',
  priority: 'приоритета',
  is_on_hold: 'статуса „на пауза"',
};
const fieldLabel = (f) => DATE_FIELD_LABELS[f] || f || 'поле';

const KP_ACTIONS = {
  create_client: 'Добави КП клиент',
  update_client: 'Промени КП клиент',
  delete_client: 'Изтри КП клиент',
  create_kp_card: 'Създаде КП карта',
  auto_create_kp_card: 'Автоматично създаде КП карта',
  generate_video_cards: 'Генерира видео карти',
  kp_card_comment: 'Коментар под КП картата',
  kp_card_comment_error: 'Коментарът под КП се провали',
};

const CAL_ACTIONS = {
  add: 'Насрочи снимки',
  reschedule: 'Пренасрочи снимки',
  move: 'Премести снимки',
  resize: 'Смени продължителността',
  remove: 'Върна картата в списъка',
};

const CARD_EVENTS = {
  created: 'Създаде карта',
  moved: 'Премести карта',
  trashed: 'Прати карта в кошчето',
  archived: 'Архивира карта',
  restored: 'Върна карта от кошчето',
};

const CRM_KINDS = {
  note: 'Бележка по сделка',
  call: 'Обаждане',
  meeting: 'Среща',
  email: 'Имейл',
  stage: 'Премести сделка',
  created: 'Създаде сделка',
  won: 'Спечели сделка',
  lost: 'Загуби сделка',
  basecamp: 'Направи карта в Basecamp',
};

// ─────────────────────────────────────────────────────────────────────────────
// Източниците.
//
// Всеки източник е един или няколко „парчета" (отделни таблици, слети в един таб).
// Парчето описва откъде се чете и КОИ изрази играят роля на време/човек/заглавие —
// оттам филтрите се сглобяват сами, вместо да се пише WHERE за всеки поотделно.
//
// map() привежда реда до общия вид:
//   { source, icon, ts, who, avatar, action, title, url, details }
// ─────────────────────────────────────────────────────────────────────────────

const P_TASKS = {
  from: `created_task_log l LEFT JOIN users u ON u.id = l.user_id`,
  select: `l.id, l.created_at AS ts, l.kind, l.title, l.card_url, l.board_title, l.column_title,
           l.video_count, l.due_on, COALESCE(NULLIF(u.name, ''), l.user_name) AS who, u.avatar_url`,
  ts: 'l.created_at',
  who: `COALESCE(NULLIF(u.name, ''), l.user_name)`,
  title: 'l.title',
  search: ['l.board_title', 'l.column_title'],
  map: (r) => ({
    source: 'tasks', icon: '🧾', ts: r.ts,
    who: r.who || '—', avatar: r.avatar_url || '',
    action: r.kind === 'plan' ? 'Поръча задача „Измисляне"' : 'Поръча единична задача',
    title: r.title || '', url: r.card_url || '',
    details: [
      [r.board_title, r.column_title].filter(Boolean).join(' → '),
      r.kind === 'plan' && r.video_count ? `${r.video_count} видеа` : '',
      r.due_on ? `публикуване ${dmy(r.due_on)}` : '',
    ].filter(Boolean).join(' · '),
  }),
};

const P_TEXT = {
  // Таблицата се създава в движение — затова се подсигурява преди четене.
  prepare: () => cardTextLog.ensureSchema(),
  from: 'bc_card_text_log t',
  select: (o) => `t.id, t.created_at AS ts, t.card_id, t.card_title, t.board_title, t.app_url,
                  t.field, t.who_name AS who,
                  ${o.withText ? 't.old_text, t.new_text,' : ''}
                  LENGTH(t.old_text) AS old_len, LENGTH(t.new_text) AS new_len`,
  // Същият дневник пази и смяната на датите — тя обаче е за таба „Срокове".
  where: `t.field IN ('content', 'title')`,
  ts: 't.created_at',
  who: 't.who_name',
  title: 't.card_title',
  search: ['t.board_title', 't.old_text', 't.new_text'],
  map: (r, o) => {
    const item = {
      source: 'text', key: `text-${r.id}`, icon: '✏️', ts: r.ts,
      who: r.who || 'не се знае', avatar: '',
      action: r.field === 'title' ? 'Преименува задача' : 'Промени текста на задача',
      title: r.card_title || `Карта ${r.card_id}`,
      url: r.app_url || '',
      details: [r.board_title, `беше ${r.old_len} знака, стана ${r.new_len}`].filter(Boolean).join(' · '),
    };
    if (o.withText) item.diff = { field: r.field, old: r.old_text || '', new: r.new_text || '' };
    return item;
  },
};

const P_KP = {
  from: 'kp_audit_log k',
  select: 'k.id, k.created_at AS ts, k.user_name AS who, k.action, k.client_name, k.details',
  ts: 'k.created_at',
  who: 'k.user_name',
  title: 'k.client_name',
  search: ['k.details', 'k.action'],
  map: (r) => ({
    source: 'kp', icon: '📋', ts: r.ts,
    who: r.who || '—', avatar: '',
    action: KP_ACTIONS[r.action] || r.action || '',
    title: r.client_name || '', url: firstUrl(r.details),
    details: prettyDetails(r.details),
  }),
};

const P_CALENDAR = {
  from: 'bc_production_calendar_log g',
  select: 'g.id, g.created_at AS ts, g.user_name AS who, g.action, g.card_title, g.details, g.basecamp_card_id',
  ts: 'g.created_at',
  who: 'g.user_name',
  title: 'g.card_title',
  search: ['g.details'],
  map: (r) => ({
    source: 'calendar', icon: '📅', ts: r.ts,
    who: r.who || '—', avatar: '',
    action: CAL_ACTIONS[r.action] || r.action || '',
    title: r.card_title || (r.basecamp_card_id ? `Карта ${r.basecamp_card_id}` : ''),
    url: '', details: r.details || '',
  }),
};

const P_CARD_EVENTS = {
  from: `card_events e
         LEFT JOIN cards   c  ON c.id  = e.card_id
         LEFT JOIN users   u  ON u.id  = e.user_id
         LEFT JOIN boards  fb ON fb.id = e.from_board_id
         LEFT JOIN columns fc ON fc.id = e.from_column_id
         LEFT JOIN boards  tb ON tb.id = e.to_board_id
         LEFT JOIN columns tc ON tc.id = e.to_column_id`,
  select: `e.id, e.created_at AS ts, e.event_type, e.metadata, e.card_id,
           c.title AS card_title, u.name AS who, u.avatar_url,
           fb.title AS from_board, fc.title AS from_col,
           tb.title AS to_board,   tc.title AS to_col`,
  ts: 'e.created_at',
  who: 'u.name',
  title: 'c.title',
  search: ['tb.title', 'tc.title', 'e.event_type'],
  map: (r) => {
    const meta = asObj(r.metadata);
    let action = CARD_EVENTS[r.event_type] || r.event_type || '';
    let details = '';
    if (r.event_type === 'field_changed') {
      action = `Промени ${fieldLabel(meta.field)}`;
      details = `${dmy(meta.old_value) || '(празно)'} → ${dmy(meta.new_value) || '(празно)'}`;
    } else if (r.event_type === 'assignee_added') {
      action = 'Назначи човек по карта';
      details = meta.assignee_name || '';
    } else if (r.event_type === 'assignee_removed') {
      action = 'Махна човек от карта';
      details = meta.assignee_name || '';
    } else if (r.event_type === 'moved') {
      const from = [r.from_board, r.from_col].filter(Boolean).join(' / ');
      const to = [r.to_board, r.to_col].filter(Boolean).join(' / ');
      details = from && to ? `${from} → ${to}` : to || from;
    } else if (r.event_type === 'created') {
      details = [r.to_board, r.to_col].filter(Boolean).join(' / ');
    }
    return {
      source: 'cards', icon: '🗂', ts: r.ts,
      who: r.who || meta.user_name || '—', avatar: r.avatar_url || '',
      action, title: r.card_title || (r.card_id ? `Карта ${r.card_id}` : ''),
      url: r.card_id ? `#/card/${r.card_id}` : '', details,
    };
  },
};

// Коментарите са в activity_log. „created" НЕ се взема оттам — стои в card_events
// и иначе създаването на карта би излизало два пъти.
const P_CARD_COMMENTS = {
  from: `activity_log a LEFT JOIN users u ON u.id = a.user_id`,
  select: `a.id, a.created_at AS ts, a.target_id, a.target_title, a.board_name,
           COALESCE(NULLIF(a.user_name, ''), u.name) AS who, u.avatar_url`,
  where: `a.action = 'commented'`,
  ts: 'a.created_at',
  who: `COALESCE(NULLIF(a.user_name, ''), u.name)`,
  title: 'a.target_title',
  search: ['a.board_name'],
  map: (r) => ({
    source: 'cards', icon: '💬', ts: r.ts,
    who: r.who || '—', avatar: r.avatar_url || '',
    action: 'Коментира по карта',
    title: r.target_title || (r.target_id ? `Карта ${r.target_id}` : ''),
    url: r.target_id ? `#/card/${r.target_id}` : '',
    details: r.board_name || '',
  }),
};

const P_DATES = {
  from: `card_date_changes d
         LEFT JOIN users u ON u.id = d.changed_by
         LEFT JOIN cards c ON c.id = d.card_id`,
  select: `d.id, d.changed_at AS ts, d.field_name, d.old_value, d.new_value, d.card_id,
           COALESCE(NULLIF(d.changed_by_name, ''), u.name) AS who, u.avatar_url,
           c.title AS card_title`,
  ts: 'd.changed_at',
  who: `COALESCE(NULLIF(d.changed_by_name, ''), u.name)`,
  title: 'c.title',
  search: ['d.field_name'],
  map: (r) => ({
    source: 'dates', icon: '📆', ts: r.ts,
    who: r.who || '—', avatar: r.avatar_url || '',
    action: `Промени ${fieldLabel(r.field_name)}`,
    title: r.card_title || (r.card_id ? `Карта ${r.card_id}` : ''),
    url: r.card_id ? `#/card/${r.card_id}` : '',
    details: `${dmy(r.old_value) || '(празно)'} → ${dmy(r.new_value) || '(празно)'}`,
  }),
};

// Датите по Basecamp картите — „Due on" и датите по стъпките (subtasks). Стоят в
// същия дневник като текста (bc_card_text_log), защото се засичат по същия начин:
// сравнение на прясната карта с предишния снапшот. Тук се четат отделно, за да
// излизат при другите местени дати, а не в таба „Текст".
const P_BC_DATES = {
  prepare: () => cardTextLog.ensureSchema(),
  from: 'bc_card_text_log b',
  select: `b.id, b.created_at AS ts, b.card_id, b.card_title, b.board_title, b.app_url,
           b.field, b.step_title, b.old_text AS old_value, b.new_text AS new_value, b.who_name AS who`,
  where: `b.field IN ('due_on', 'step_due')`,
  ts: 'b.created_at',
  who: 'b.who_name',
  title: 'b.card_title',
  search: ['b.board_title', 'b.step_title'],
  map: (r) => ({
    source: 'dates', key: `bcdate-${r.id}`, icon: '📆', ts: r.ts,
    who: r.who || 'не се знае', avatar: '',
    action: r.field === 'step_due'
      ? 'Смени датата на стъпка в Basecamp'
      : 'Смени крайния срок в Basecamp',
    title: r.card_title || (r.card_id ? `Карта ${r.card_id}` : ''),
    url: r.app_url || '',
    details: [
      r.step_title ? `стъпка „${r.step_title}"` : '',
      `${dmy(r.old_value) || '(без дата)'} → ${dmy(r.new_value) || '(без дата)'}`,
      r.board_title,
    ].filter(Boolean).join(' · '),
  }),
};

const P_CRM = {
  from: `crm_events ce
         LEFT JOIN users u ON u.id = ce.user_id
         LEFT JOIN crm_deals cd ON cd.id = ce.deal_id`,
  select: `ce.id, ce.created_at AS ts, ce.kind, ce.body, ce.from_stage, ce.to_stage, ce.deal_id,
           COALESCE(NULLIF(ce.user_name, ''), u.name) AS who, u.avatar_url,
           cd.title AS deal_title, cd.company`,
  ts: 'ce.created_at',
  who: `COALESCE(NULLIF(ce.user_name, ''), u.name)`,
  title: 'cd.title',
  search: ['cd.company', 'ce.body', 'ce.to_stage'],
  map: (r) => ({
    source: 'crm', icon: '💼', ts: r.ts,
    who: r.who || '—', avatar: r.avatar_url || '',
    action: CRM_KINDS[r.kind] || r.kind || '',
    title: [r.deal_title, r.company].filter(Boolean).join(' · ') || (r.deal_id ? `Сделка ${r.deal_id}` : ''),
    url: r.deal_id ? `#/crm/${r.deal_id}` : '',
    details: r.kind === 'stage'
      ? [r.from_stage, r.to_stage].filter(Boolean).join(' → ')
      : String(r.body || '').slice(0, 400),
  }),
};

const SOURCES = {
  tasks: { icon: '🧾', label: 'Задачи', parts: [P_TASKS] },
  text: { icon: '✏️', label: 'Текст', parts: [P_TEXT] },
  kp: { icon: '📋', label: 'КП', parts: [P_KP] },
  calendar: { icon: '📅', label: 'Календар', parts: [P_CALENDAR] },
  cards: { icon: '🗂', label: 'Карти', parts: [P_CARD_EVENTS, P_CARD_COMMENTS] },
  dates: { icon: '📆', label: 'Срокове', parts: [P_DATES, P_BC_DATES] },
  crm: { icon: '💼', label: 'CRM', parts: [P_CRM], needsCrm: true },
};

const TABS = Object.keys(SOURCES);

// ─────────────────────────────────────────────────────────────── филтрите в SQL

function whereFor(part, f, params) {
  const conds = [];
  if (part.where) conds.push(part.where);
  if (f.since) { params.push(f.since); conds.push(`${part.ts} >= $${params.length}`); }
  if (f.who) { params.push(f.who); conds.push(`${part.who} = $${params.length}`); }
  if (f.card) { params.push(`%${f.card}%`); conds.push(`${part.title} ILIKE $${params.length}`); }
  if (f.q) {
    params.push(`%${f.q}%`);
    const i = params.length;
    const cols = [part.who, part.title].concat(part.search || []);
    conds.push(`(${cols.map((c) => `${c} ILIKE $${i}`).join(' OR ')})`);
  }
  return conds.length ? `WHERE ${conds.join(' AND ')}` : '';
}

async function runPart(part, f, limit, opts) {
  if (part.prepare) await part.prepare();
  const params = [];
  const where = whereFor(part, f, params);
  const select = typeof part.select === 'function' ? part.select(opts) : part.select;
  params.push(limit);
  const rows = await query(
    `SELECT ${select} FROM ${part.from} ${where} ORDER BY ${part.ts} DESC LIMIT $${params.length}`,
    params
  );
  return rows.map((r) => part.map(r, opts));
}

async function loadSource(key, f, limit, opts) {
  return safe(key, async () => {
    // Всяко парче е подсигурено ПООТДЕЛНО: слетите табове (карти + коментари,
    // срокове от платформата + срокове от Basecamp) не бива да остават празни,
    // защото едната им таблица е паднала.
    const lists = await Promise.all(
      SOURCES[key].parts.map((p) => safe(key, () => runPart(p, f, limit, opts))));
    const all = [].concat(...lists);
    // Слетите източници (карти + коментари) се подреждат и режат тук, за да не
    // върнат двойно повече редове от поисканите.
    return all.length > limit
      ? all.sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, limit)
      : all;
  });
}

// ──────────────────────────────────────────────────────────────────── достъпът

// CRM се вижда само от хората с поименен достъп до инструмента; останалите табове
// са за целия екип. Провалена проверка = без CRM (по-скоро скрий, отколкото пусни).
async function crmAllowed(user) {
  try {
    const acc = await crm.getAccess(user);
    return !!(acc && acc.access);
  } catch (err) {
    console.error('[history:crm-access]', err.message);
    return false;
  }
}

const visibleTabs = (withCrm) => TABS.filter((t) => withCrm || !SOURCES[t].needsCrm);

function readFilters(q) {
  const range = Object.prototype.hasOwnProperty.call(RANGES, q.range) ? q.range : 'all';
  const clean = (v) => String(v == null ? '' : v).trim().slice(0, 200);
  return {
    range,
    since: sinceFromRange(range),
    who: clean(q.who),
    card: clean(q.card),
    q: clean(q.q),
  };
}

// ─────────────────────────────────────────────────────────────────── маршрутите

// GET /api/history?tab=all&range=7d&who=&card=&q=&limit=60 — най-новото отгоре.
//
// Няма offset: „Покажи още" вдига limit-а. При обединения таб редовете идват от
// няколко таблици и един offset би пропускал записи между източниците.
router.get('/', requireAuth, async (req, res) => {
  try {
    const withCrm = await crmAllowed(req.user);
    const allowed = visibleTabs(withCrm);

    const asked = req.query.tab;
    if (asked && SOURCES[asked] && SOURCES[asked].needsCrm && !withCrm) {
      return res.status(403).json({ error: 'Историята на CRM е само за хората с достъп до CRM.' });
    }
    const tab = allowed.includes(asked) ? asked : 'all';

    const f = readFilters(req.query);
    const raw = parseInt(req.query.limit, 10);
    const limit = Math.min(MAX_LIMIT, Math.max(1, raw > 0 ? raw : 60));

    // +1 ред, за да се разбере има ли още, без втора заявка.
    const wanted = limit + 1;
    // withText значи „това е собственият таб на източника" — само тогава се пращат
    // тежките полета (целите стар и нов текст).
    const lists = tab === 'all'
      ? await Promise.all(allowed.map((t) => loadSource(t, f, wanted, { withText: false })))
      : [await loadSource(tab, f, wanted, { withText: true })];

    const merged = [].concat(...lists).sort((a, b) => new Date(b.ts) - new Date(a.ts));
    res.json({
      tab,
      limit,
      range: f.range,
      hasMore: merged.length > limit,
      items: merged.slice(0, limit),
    });
  } catch (err) {
    console.error('[history]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/history/filters?tab=&range= — какво да предложат падащите менюта.
//
// Списъците се вадят от самите дневници (не от `users`), защото в тях има и имена
// отвън: „Система" за графика, Basecamp профили за редакциите по картите.
// Гледа се прозорец от последните N реда на източник, не цялата таблица.
const FILTER_SCAN = 3000;

router.get('/filters', requireAuth, async (req, res) => {
  try {
    const withCrm = await crmAllowed(req.user);
    const allowed = visibleTabs(withCrm);
    const asked = req.query.tab;
    const tabs = allowed.includes(asked) ? [asked] : allowed;
    const f = readFilters(req.query);

    const distinctOf = (part, expr) => safe('filters', async () => {
      if (part.prepare) await part.prepare();
      const params = [];
      // Само периодът стеснява списъка — иначе избраният човек би изчистил
      // менюто с хора и нямаше как да се превключи на друг.
      const where = whereFor(part, { since: f.since }, params);
      params.push(FILTER_SCAN);
      const rows = await query(
        `SELECT DISTINCT v FROM (
           SELECT ${expr} AS v FROM ${part.from} ${where}
            ORDER BY ${part.ts} DESC LIMIT $${params.length}
         ) s WHERE v IS NOT NULL AND btrim(v) <> ''`,
        params
      );
      return rows.map((r) => r.v);
    });

    const jobs = [];
    for (const t of tabs) {
      for (const part of SOURCES[t].parts) {
        jobs.push(distinctOf(part, part.who));
        jobs.push(distinctOf(part, part.title).then((v) => ({ cards: v })));
      }
    }
    const results = await Promise.all(jobs);

    const people = new Set();
    const cards = new Set();
    results.forEach((r) => {
      if (Array.isArray(r)) r.forEach((v) => people.add(v));
      else if (r && r.cards) r.cards.forEach((v) => cards.add(v));
    });

    const bg = (a, b) => String(a).localeCompare(String(b), 'bg');
    res.json({
      tabs: allowed.map((id) => ({ id, icon: SOURCES[id].icon, label: SOURCES[id].label })),
      crmAllowed: withCrm,
      people: [...people].sort(bg).slice(0, 300),
      cards: [...cards].sort(bg).slice(0, 500),
    });
  } catch (err) {
    console.error('[history:filters]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
