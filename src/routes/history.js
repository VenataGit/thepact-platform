// Дневник „История" (Настройки → 📜 История) — кой какво и кога е правил.
//
// Тук НИЩО не се записва. Платформата вече води няколко отделни дневника, но всеки
// се вижда на различно място (или изобщо не се вижда). Този маршрут ги чете и ги
// нормализира до един и същ вид, за да стоят на едно място с таб за всяка дейност.
//
// Поводът: картите в Basecamp се създават от бота ThePactAlerts, затова там авторът
// е винаги един и същ — кой ги е поръчал наистина се вижда само от платформата.
const express = require('express');
const router = express.Router();
const { query } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const cardTextLog = require('../services/card-text-log');

const MAX_LIMIT = 500;

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
// Източниците. Всеки връща еднакви редове:
//   { source, icon, ts, who, avatar, action, title, url, details }
// ─────────────────────────────────────────────────────────────────────────────

const LOADERS = {
  // Инструментът „Създаване на задачи" — истинският поръчител зад бота.
  tasks: (limit) => safe('tasks', async () => {
    const rows = await query(
      `SELECT l.id, l.created_at, l.kind, l.title, l.card_url, l.board_title, l.column_title,
              l.video_count, l.due_on,
              COALESCE(NULLIF(u.name, ''), l.user_name) AS who, u.avatar_url
         FROM created_task_log l
         LEFT JOIN users u ON u.id = l.user_id
        ORDER BY l.created_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map((r) => ({
      source: 'tasks', icon: '🧾', ts: r.created_at,
      who: r.who || '—', avatar: r.avatar_url || '',
      action: r.kind === 'plan' ? 'Поръча задача „Измисляне"' : 'Поръча единична задача',
      title: r.title || '', url: r.card_url || '',
      details: [
        [r.board_title, r.column_title].filter(Boolean).join(' → '),
        r.kind === 'plan' && r.video_count ? `${r.video_count} видеа` : '',
        r.due_on ? `публикуване ${dmy(r.due_on)}` : '',
      ].filter(Boolean).join(' · '),
    }));
  }),

  // Текстът на Basecamp картите: какъв е бил и с какво е заменен. Пълните текстове
  // се пращат само на собствения таб — обединеният не бива да мъкне мегабайти.
  text: (limit, withText) => safe('text', async () => {
    const rows = await cardTextLog.recentTextChanges(limit, !!withText);
    return rows.map((r) => {
      const isTitle = r.field === 'title';
      const item = {
        source: 'text', key: `text-${r.id}`, icon: '✏️', ts: r.created_at,
        who: r.who_name || 'не се знае', avatar: '',
        action: isTitle ? 'Преименува задача' : 'Промени текста на задача',
        title: r.card_title || `Карта ${r.card_id}`,
        url: r.app_url || '',
        details: [r.board_title, `беше ${r.old_len} знака, стана ${r.new_len}`].filter(Boolean).join(' · '),
      };
      if (withText) item.diff = { field: r.field, old: r.old_text || '', new: r.new_text || '' };
      return item;
    });
  }),

  // КП-автоматизацията: клиенти, карти, коментари. „Система" = графикът, не човек.
  kp: (limit) => safe('kp', async () => {
    const rows = await query(
      `SELECT id, created_at, user_name, action, client_name, details
         FROM kp_audit_log ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map((r) => ({
      source: 'kp', icon: '📋', ts: r.created_at,
      who: r.user_name || '—', avatar: '',
      action: KP_ACTIONS[r.action] || r.action || '',
      title: r.client_name || '', url: firstUrl(r.details),
      details: prettyDetails(r.details),
    }));
  }),

  // Производственият календар — насрочване и местене на снимачните дни.
  calendar: (limit) => safe('calendar', async () => {
    const rows = await query(
      `SELECT id, created_at, user_name, action, card_title, details, basecamp_card_id
         FROM bc_production_calendar_log ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    return rows.map((r) => ({
      source: 'calendar', icon: '📅', ts: r.created_at,
      who: r.user_name || '—', avatar: '',
      action: CAL_ACTIONS[r.action] || r.action || '',
      title: r.card_title || (r.basecamp_card_id ? `Карта ${r.basecamp_card_id}` : ''),
      url: '', details: r.details || '',
    }));
  }),

  // Картите в платформата: card_events носи всичко освен коментарите, те са в
  // activity_log. „created" стои само в card_events, за да не излиза два пъти.
  cards: (limit) => safe('cards', async () => {
    const [events, comments] = await Promise.all([
      query(
        `SELECT e.id, e.created_at, e.event_type, e.metadata, e.card_id,
                c.title AS card_title, u.name AS who, u.avatar_url,
                fb.title AS from_board, fc.title AS from_col,
                tb.title AS to_board,   tc.title AS to_col
           FROM card_events e
           LEFT JOIN cards   c  ON c.id  = e.card_id
           LEFT JOIN users   u  ON u.id  = e.user_id
           LEFT JOIN boards  fb ON fb.id = e.from_board_id
           LEFT JOIN columns fc ON fc.id = e.from_column_id
           LEFT JOIN boards  tb ON tb.id = e.to_board_id
           LEFT JOIN columns tc ON tc.id = e.to_column_id
          ORDER BY e.created_at DESC LIMIT $1`,
        [limit]
      ),
      query(
        `SELECT a.id, a.created_at, a.target_id, a.target_title, a.board_name,
                COALESCE(NULLIF(a.user_name, ''), u.name) AS who, u.avatar_url
           FROM activity_log a
           LEFT JOIN users u ON u.id = a.user_id
          WHERE a.action = 'commented'
          ORDER BY a.created_at DESC LIMIT $1`,
        [limit]
      ),
    ]);

    const fromEvents = events.map((r) => {
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
        source: 'cards', icon: '🗂', ts: r.created_at,
        who: r.who || meta.user_name || '—', avatar: r.avatar_url || '',
        action, title: r.card_title || (r.card_id ? `Карта ${r.card_id}` : ''),
        url: r.card_id ? `#/card/${r.card_id}` : '', details,
      };
    });

    const fromComments = comments.map((r) => ({
      source: 'cards', icon: '💬', ts: r.created_at,
      who: r.who || '—', avatar: r.avatar_url || '',
      action: 'Коментира по карта',
      title: r.target_title || (r.target_id ? `Карта ${r.target_id}` : ''),
      url: r.target_id ? `#/card/${r.target_id}` : '',
      details: r.board_name || '',
    }));

    return fromEvents.concat(fromComments)
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, limit);
  }),

  // Местените дати по картите — отделен дневник, за да се вижда старата стойност.
  dates: (limit) => safe('dates', async () => {
    const rows = await query(
      `SELECT d.id, d.changed_at, d.field_name, d.old_value, d.new_value, d.card_id,
              COALESCE(NULLIF(d.changed_by_name, ''), u.name) AS who, u.avatar_url,
              c.title AS card_title
         FROM card_date_changes d
         LEFT JOIN users u ON u.id = d.changed_by
         LEFT JOIN cards c ON c.id = d.card_id
        ORDER BY d.changed_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map((r) => ({
      source: 'dates', icon: '📆', ts: r.changed_at,
      who: r.who || '—', avatar: r.avatar_url || '',
      action: `Промени ${fieldLabel(r.field_name)}`,
      title: r.card_title || (r.card_id ? `Карта ${r.card_id}` : ''),
      url: r.card_id ? `#/card/${r.card_id}` : '',
      details: `${dmy(r.old_value) || '(празно)'} → ${dmy(r.new_value) || '(празно)'}`,
    }));
  }),

  // CRM — хронологията на сделките (бележки, обаждания, смяна на етап).
  crm: (limit) => safe('crm', async () => {
    const rows = await query(
      `SELECT e.id, e.created_at, e.kind, e.body, e.from_stage, e.to_stage, e.deal_id,
              COALESCE(NULLIF(e.user_name, ''), u.name) AS who, u.avatar_url,
              d.title AS deal_title, d.company
         FROM crm_events e
         LEFT JOIN users u ON u.id = e.user_id
         LEFT JOIN crm_deals d ON d.id = e.deal_id
        ORDER BY e.created_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map((r) => ({
      source: 'crm', icon: '💼', ts: r.created_at,
      who: r.who || '—', avatar: r.avatar_url || '',
      action: CRM_KINDS[r.kind] || r.kind || '',
      title: [r.deal_title, r.company].filter(Boolean).join(' · ') || (r.deal_id ? `Сделка ${r.deal_id}` : ''),
      url: r.deal_id ? `#/crm/${r.deal_id}` : '',
      details: r.kind === 'stage'
        ? [r.from_stage, r.to_stage].filter(Boolean).join(' → ')
        : String(r.body || '').slice(0, 400),
    }));
  }),
};

const TABS = Object.keys(LOADERS);

// GET /api/history?tab=all&limit=60 — най-новото отгоре.
//
// Няма offset: „Покажи още" вдига limit-а. При обединения таб редовете идват от
// няколко таблици и един offset би пропускал записи между източниците.
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tab = TABS.includes(req.query.tab) ? req.query.tab : 'all';
    const raw = parseInt(req.query.limit, 10);
    const limit = Math.min(MAX_LIMIT, Math.max(1, raw > 0 ? raw : 60));

    // +1 ред, за да се разбере има ли още, без втора заявка.
    const wanted = limit + 1;
    // Вторият аргумент значи „това е собственият таб на източника" — само тогава
    // се пращат тежките полета (целите стар и нов текст).
    const lists = tab === 'all'
      ? await Promise.all(TABS.map((t) => LOADERS[t](wanted, false)))
      : [await LOADERS[tab](wanted, true)];

    const merged = [].concat(...lists).sort((a, b) => new Date(b.ts) - new Date(a.ts));
    res.json({
      tab,
      limit,
      hasMore: merged.length > limit,
      items: merged.slice(0, limit),
    });
  } catch (err) {
    console.error('[history]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
