// Basecamp-backed Production Calendar.
// Sidebar = Production card-table cards not yet scheduled, sorted by the FILMING deadline
// (publish date = card due date; filming = publish − 11 working days). Drag onto the week
// view to schedule (stored locally in bc_production_calendar, keyed by Basecamp card id),
// which also syncs to Google Calendar with a link back to the Basecamp card.
// GET /external е обратната посока: събития, добавени директно в Google Calendar,
// се показват в седмичния изглед само за четене (за да се вижда, че часът е зает).
// Календарите са няколко: гледат се всички следени, а се пише в избрания (само
// там, където service account-ът има права) — виж listCalendars/resolveWriteCalendar.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const config = require('../config');
const { query, queryOne, execute } = require('../db/pool');
const bc = require('../services/basecamp');
const { getUserAuth } = require('../services/basecamp-token');
const {
  createGCalEvent, updateGCalEvent, deleteGCalEvent,
  isGCalEnabled, getCalendarClient, getTargetCalendarId, getServiceAccountEmail,
} = require('../services/google-calendar');

const FILMING_OFFSET = parseInt(process.env.BASECAMP_FILMING_OFFSET) || 11; // working days before publish
const { subtractWorkingDays, workingDaysUntil } = require('../services/workdays');

// Filming deadline (срок за снимки) = publish date − FILMING_OFFSET working days (skips weekends + BG holidays).
function filmingDeadline(dueOn) { return dueOn ? subtractWorkingDays(dueOn, FILMING_OFFSET) : null; }
// Preferred source: the "Видеограф - Насрочване на снимачен ден" step carries the filming date.
function filmingFromSteps(steps) {
  const s = (steps || []).find((x) => /насрочване на снимач/i.test(x.title || '') || (/видеограф/i.test(x.title || '') && /снима/i.test(x.title || '')));
  return s && s.due_on ? s.due_on : null;
}
function dlClassFor(deadlineStr) {
  if (!deadlineStr) return 'dl-none';
  const wd = workingDaysUntil(deadlineStr);
  if (wd < 0) return 'dl-black';
  if (wd === 0) return 'dl-red';
  if (wd <= 4) return 'dl-yellow';
  return 'dl-green';
}

// Fetch the "Production" card table's cards (excluding Done columns).
async function getProductionCards(token, account) {
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  const project = await bc.getProject(token, account, projectId);
  const tool = (project.dock || []).find((t) =>
    t.enabled && /kanban|card/i.test(t.name) && /production/i.test(t.title || '') && !/post|pre/i.test(t.title || ''));
  if (!tool) return [];
  const table = (await bc.authedGet(tool.url, token)).json;
  const lists = (table.lists || []).filter((l) => !/DoneColumn/i.test(l.type || ''));
  const out = [];
  for (const list of lists) {
    if (!list.cards_count) continue;
    const cards = await bc.getColumnCards(token, account, projectId, list.id);
    cards.forEach((c) => {
      // Prefer the filming step's date (current workflow); fall back to publish − 11 wd.
      const deadline = filmingFromSteps(c.steps) || filmingDeadline(c.due_on);
      out.push({ id: c.id, title: c.title, url: bc.normalizeAppUrl(c.app_url), due_on: c.due_on, column: list.title, deadline, dl_class: dlClassFor(deadline) });
    });
  }
  return out;
}

// GET /api/bc-calendar — { cards: unscheduled (sorted by filming deadline), entries: scheduled }
router.get('/', requireAuth, async (req, res) => {
  try {
    const { token, account } = await getUserAuth(req.user.userId);
    const cards = await getProductionCards(token, account);
    const byId = {}; cards.forEach((c) => { byId[String(c.id)] = c; });

    await ensureSchema();
    const rows = await query(
      "SELECT id, basecamp_card_id, card_title, card_url, to_char(scheduled_date,'YYYY-MM-DD') AS scheduled_date, start_minute, duration_minutes, google_calendar_id FROM bc_production_calendar ORDER BY scheduled_date, start_minute"
    );
    const scheduledIds = new Set(rows.map((r) => String(r.basecamp_card_id)));

    const unscheduled = cards
      .filter((c) => !scheduledIds.has(String(c.id)))
      .sort((a, b) => { if (!a.deadline && !b.deadline) return 0; if (!a.deadline) return 1; if (!b.deadline) return -1; return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0; });

    const entries = rows.map((r) => {
      const card = byId[String(r.basecamp_card_id)];
      return {
        id: r.id,
        card_id: r.basecamp_card_id,
        card_title: card ? card.title : r.card_title,
        card_url: card ? card.url : r.card_url,
        scheduled_date: r.scheduled_date,
        start_minute: r.start_minute,
        duration_minutes: r.duration_minutes,
        calendar_id: r.google_calendar_id || null,
        dl_class: card ? card.dl_class : 'dl-none',
      };
    });

    res.json({ cards: unscheduled, entries, calendars: await listCalendars() });
  } catch (err) {
    console.error('[bc-calendar]', err.message);
    res.status(err.code === 'NO_USER_TOKEN' ? 401 : 502).json({ error: err.message });
  }
});

// ─── няколко календара ────────────────────────────────────────────────────────
// Календарите идват от следените в „Календар известия" (gcal_feeds) плюс
// производственият по подразбиране. Гледането и писането са различни списъци:
// service account-ът може да чете всичко споделено с него, но да пише само там,
// където има „Make changes to events" (напр. „Общ календар" връща 403).
//
// Deploy-ът не пуска миграции (виж коментара в pm-agent/briefing.js), затова
// двете нови колони се добавят при първа нужда — идемпотентно DDL, нищо не се трие.
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = Promise.all([
      execute('ALTER TABLE bc_production_calendar ADD COLUMN IF NOT EXISTS google_calendar_id TEXT'),
      execute('ALTER TABLE gcal_feeds ADD COLUMN IF NOT EXISTS can_write BOOLEAN'),
      // Дневник: кой какво е направил в производствения календар.
      execute(`
        CREATE TABLE IF NOT EXISTS bc_production_calendar_log (
          id               BIGSERIAL PRIMARY KEY,
          basecamp_card_id BIGINT,
          card_title       TEXT,
          action           TEXT NOT NULL,
          details          TEXT,
          user_id          INTEGER,
          user_name        TEXT,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`),
    ]).catch((err) => {
      schemaReady = null; // да опита пак при следващата заявка
      throw err;
    });
  }
  return schemaReady;
}

// Записът в дневника никога не бива да проваля самото действие — оттам catch-ът.
// Човекът идва от сесията (влиза се с Basecamp профил), затова е винаги наличен.
function logAction(req, action, entry, details) {
  execute(
    `INSERT INTO bc_production_calendar_log (basecamp_card_id, card_title, action, details, user_id, user_name)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [entry.basecamp_card_id || null, entry.card_title || null, action, details || null,
     req.user.userId, req.user.name || null]
  ).catch((err) => console.error('[bc-calendar log]', err.message));
}

// scheduled_date идва или като низ, или като Date (pg връща DATE като Date на
// ЛОКАЛНА полунощ). Затова компонентите се четат локално — `ymd` минава през UTC
// и на сървър извън UTC би върнал предния ден.
function dateOnly(value) {
  if (typeof value === 'string') return value.split('T')[0];
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// „14.07, 10:00" — кратко и четимо в списъка.
function humanWhen(dateValue, startMinute) {
  const [, m, day] = dateOnly(dateValue).split('-');
  const pad = (n) => String(n).padStart(2, '0');
  return `${Number(day)}.${m}, ${pad(Math.floor(startMinute / 60))}:${pad(startMinute % 60)}`;
}

// GET /api/bc-calendar/log?limit=60 — последните действия, най-новото отгоре.
router.get('/log', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 60));
    const rows = await query(
      `SELECT id, basecamp_card_id, card_title, action, details, user_name, created_at
       FROM bc_production_calendar_log ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    res.json({ entries: rows });
  } catch (err) {
    console.error('[bc-calendar log]', err.message);
    res.json({ entries: [] });
  }
});

// Може ли service account-ът да пише в този календар? Единственият надежден
// начин е да се пробва: Google не дава accessRole за споделен календар, а
// calendarList на service account-а е празен (споделянето не го попълва).
// Пробното събитие е далеч в бъдещето и се трие веднага; gcal-alerts пропуска
// писаното от service account-а, така че нищо не се обявява в Basecamp.
async function probeWriteAccess(calendarId) {
  const calendar = getCalendarClient();
  if (!calendar) return null;
  let createdId = null;
  try {
    const r = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: 'ThePact — проверка на достъпа',
        start: { dateTime: '2030-01-01T03:00:00', timeZone: TZ },
        end:   { dateTime: '2030-01-01T03:15:00', timeZone: TZ },
      },
      sendUpdates: 'none',
    });
    createdId = r.data.id;
    return true;
  } catch (err) {
    if (err && (err.code === 403 || err.status === 403)) return false;
    return null; // мрежа/друга грешка — не заключваме отговор
  } finally {
    if (createdId) {
      try { await calendar.events.delete({ calendarId, eventId: createdId, sendUpdates: 'none' }); }
      catch (e) { console.warn('[bc-calendar] пробното събитие не се изтри:', createdId, e.message); }
    }
  }
}

// Списъкът за фронтенда. can_write се научава веднъж на календар и се пази.
async function listCalendars() {
  await ensureSchema();
  const defaultId = await getTargetCalendarId();
  const feeds = await query(
    'SELECT google_calendar_id AS id, name, can_write FROM gcal_feeds WHERE enabled = true ORDER BY id'
  );

  const out = feeds.map((f) => ({
    id: f.id,
    name: f.name || f.id,
    is_default: f.id === defaultId,
    can_write: f.can_write,
  }));
  // Производственият календар присъства винаги, дори да не е добавен като feed.
  if (defaultId && !out.some((c) => c.id === defaultId)) {
    out.unshift({ id: defaultId, name: 'Производствен календар', is_default: true, can_write: true });
  }

  // Неизвестен достъп → проверява се веднъж и се запомня.
  for (const c of out) {
    if (c.can_write !== null && c.can_write !== undefined) continue;
    if (c.is_default) { c.can_write = true; continue; } // в него пишем открай време
    const canWrite = await probeWriteAccess(c.id);
    c.can_write = canWrite;
    if (canWrite !== null) {
      await execute('UPDATE gcal_feeds SET can_write = $2 WHERE google_calendar_id = $1', [c.id, canWrite]);
      console.log(`[bc-calendar] достъп за писане в „${c.name}": ${canWrite ? 'да' : 'не'}`);
    }
  }
  out.sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));
  return out;
}

async function calendarNameOf(calId) {
  if (!calId) return '';
  const c = (await listCalendars()).find((x) => x.id === calId);
  return c ? c.name : '';
}

// Календарът, в който да се пише: подаденият (ако е разрешен за писане) или default.
async function resolveWriteCalendar(requested) {
  const cals = await listCalendars();
  const hit = cals.find((c) => c.id === requested && c.can_write === true);
  if (hit) return hit.id;
  return (await getTargetCalendarId()) || null;
}

// ─── Google Calendar → производствен календар (обратната посока, само за четене) ──
// Ако някой запази снимки директно в Google Calendar (без да дърпа карта в
// производствения календар), часът трябва да се вижда като зает и тук. Нищо не се
// записва в базата — четем календара на живо за видимата седмица.

const TZ = 'Europe/Sofia';
const _sofiaFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// ISO момент → { date: 'YYYY-MM-DD', minute: минути от полунощ } в софийско време.
function sofiaParts(iso) {
  const parts = _sofiaFmt.formatToParts(new Date(iso));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minute: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10),
  };
}

// Ден напред/назад по календарна дата (обяд UTC — извън обхвата на всяко лятно време).
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

// Едно Google събитие → по един блок на ден (многодневните се разрязват по дни),
// ограничено до [from, to]. Целодневните излизат с all_day.
function eventSegments(ev, from, to) {
  const out = [];
  const push = (seg) => { if (seg.date >= from && seg.date <= to) out.push(seg); };

  if (ev.start && ev.start.date) {
    // Целодневно: end.date е ексклузивна.
    const endExcl = (ev.end && ev.end.date) || addDays(ev.start.date, 1);
    let d = ev.start.date;
    for (let guard = 0; d < endExcl && guard < 366; guard++, d = addDays(d, 1)) {
      push({ date: d, all_day: true, start_minute: 0, duration_minutes: 0 });
    }
    return out;
  }

  if (!ev.start || !ev.start.dateTime) return out;
  const s = sofiaParts(ev.start.dateTime);
  const e = ev.end && ev.end.dateTime
    ? sofiaParts(ev.end.dateTime)
    : { date: s.date, minute: Math.min(1440, s.minute + 60) };

  if (e.date <= s.date) {
    push({ date: s.date, all_day: false, start_minute: s.minute, duration_minutes: Math.max(15, e.minute - s.minute) });
    return out;
  }
  let d = s.date;
  for (let guard = 0; d <= e.date && guard < 366; guard++, d = addDays(d, 1)) {
    const startMin = d === s.date ? s.minute : 0;
    const endMin   = d === e.date ? e.minute : 1440;
    if (endMin <= startMin) continue;
    push({ date: d, all_day: false, start_minute: startMin, duration_minutes: endMin - startMin });
  }
  return out;
}

// GET /api/bc-calendar/external?from=YYYY-MM-DD&to=YYYY-MM-DD&calendars=id1,id2
// Събития от Google Calendar, които НЕ са създадени от платформата.
// Без calendars= се чете само производственият календар (както преди).
router.get('/external', requireAuth, async (req, res) => {
  const from = String(req.query.from || '');
  const to   = String(req.query.to   || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    return res.status(400).json({ error: 'from and to (YYYY-MM-DD) required' });
  }
  try {
    if (!(await isGCalEnabled())) return res.json({ events: [] });
    const calendar = getCalendarClient();
    if (!calendar) return res.json({ events: [] });

    // Само познати календари — параметърът от браузъра не се ползва суров.
    const known = await listCalendars();
    const asked = String(req.query.calendars || '').split(',').map((s) => s.trim()).filter(Boolean);
    const wanted = asked.length
      ? known.filter((c) => asked.includes(c.id))
      : known.filter((c) => c.is_default);
    if (!wanted.length) return res.json({ events: [] });

    // Собствените ни събития не се показват втори път: по запомнен event id, а
    // за по-старите (и за изтритите локално) — по създател = service account-ът.
    const ourRows = await query(
      'SELECT google_calendar_event_id AS gid FROM bc_production_calendar WHERE google_calendar_event_id IS NOT NULL'
    );
    const ours = new Set(ourRows.map((r) => String(r.gid)));
    const saEmail = (getServiceAccountEmail() || '').toLowerCase();

    const events = [];
    for (const cal of wanted) {
      let listed;
      try {
        // Ден отстъп от двете страни — заявката е в UTC, точното отрязване е по софийска дата.
        listed = await calendar.events.list({
          calendarId: cal.id,
          timeMin: new Date(addDays(from, -1) + 'T00:00:00Z').toISOString(),
          timeMax: new Date(addDays(to, 2) + 'T00:00:00Z').toISOString(),
          singleEvents: true,   // поредиците се разгъват до отделни инстанции
          orderBy: 'startTime',
          maxResults: 250,
        });
      } catch (err) {
        // Един недостъпен календар не бива да събаря останалите.
        console.warn(`[bc-calendar external] ${cal.name}: ${err.message}`);
        continue;
      }

      for (const ev of listed.data.items || []) {
        if (!ev || !ev.id || ev.status === 'cancelled') continue;
        if (ev.eventType && ev.eventType !== 'default') continue; // outOfOffice, workingLocation…
        if (ours.has(String(ev.id))) continue;
        if (saEmail && String((ev.creator && ev.creator.email) || '').toLowerCase() === saEmail) continue;

        const creator = (ev.creator && (ev.creator.displayName || ev.creator.email)) || '';
        for (const seg of eventSegments(ev, from, to)) {
          events.push({
            id: `${ev.id}@${seg.date}`,
            title: ev.summary || 'Без заглавие',
            url: ev.htmlLink || '',
            creator,
            location: ev.location || '',
            calendar_id: cal.id,
            calendar_name: cal.name,
            ...seg,
          });
        }
      }
    }
    res.json({ events });
  } catch (err) {
    // Календарът трябва да се отвори и когато Google не отговаря — просто без тези блокове.
    console.error('[bc-calendar external]', err.message);
    res.json({ events: [] });
  }
});

// POST /api/bc-calendar — schedule a card (one entry per card; re-scheduling updates it)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { cardId, title, url, scheduledDate, startMinute, durationMinutes, calendarId } = req.body || {};
    if (!cardId || !scheduledDate) return res.status(400).json({ error: 'cardId and scheduledDate required' });
    await ensureSchema();
    // Непознат или незаписваем календар → тихо пада на производствения.
    const targetCal = await resolveWriteCalendar(calendarId);
    const prev = await queryOne(
      'SELECT google_calendar_event_id, google_calendar_id FROM bc_production_calendar WHERE basecamp_card_id = $1',
      [cardId]
    );

    const entry = await queryOne(
      `INSERT INTO bc_production_calendar (basecamp_card_id, card_title, card_url, scheduled_date, start_minute, duration_minutes, google_calendar_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (basecamp_card_id) DO UPDATE SET
         card_title = EXCLUDED.card_title, card_url = EXCLUDED.card_url,
         scheduled_date = EXCLUDED.scheduled_date, start_minute = EXCLUDED.start_minute,
         duration_minutes = EXCLUDED.duration_minutes, google_calendar_id = EXCLUDED.google_calendar_id,
         updated_at = NOW()
       RETURNING *`,
      [cardId, title || null, url || null, scheduledDate, startMinute != null ? startMinute : 540, durationMinutes != null ? durationMinutes : 60, targetCal, req.user.userId]
    );

    // Пренасрочване в ДРУГ календар: старото събитие се маха от стария и се създава наново.
    // Празен google_calendar_id по стари редове значи производственият календар.
    const prevCal = (prev && prev.google_calendar_id) || (await getTargetCalendarId());
    if (prev && prev.google_calendar_event_id && prevCal !== targetCal) {
      deleteGCalEvent(prev.google_calendar_event_id, prevCal).catch((e) => console.error('[GCal bc]', e.message));
      await execute('UPDATE bc_production_calendar SET google_calendar_event_id = NULL WHERE id = $1', [entry.id]);
      entry.google_calendar_event_id = null;
    }

    syncCalToGCal(entry.google_calendar_event_id ? 'update' : 'create', entry).catch((e) => console.error('[GCal bc]', e.message));

    const when = humanWhen(scheduledDate, entry.start_minute);
    const calName = await calendarNameOf(targetCal);
    logAction(req, prev ? 'reschedule' : 'add', entry,
      (prev ? 'пренасрочи за ' : 'добави за ') + when + (calName ? ' · ' + calName : ''));

    res.status(201).json({
      id: entry.id, card_id: entry.basecamp_card_id, card_title: entry.card_title, card_url: entry.card_url,
      scheduled_date: scheduledDate, start_minute: entry.start_minute, duration_minutes: entry.duration_minutes,
      calendar_id: targetCal,
    });
  } catch (err) {
    console.error('[bc-calendar post]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bc-calendar/:id — move / resize
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { scheduledDate, startMinute, durationMinutes } = req.body || {};
    await ensureSchema();
    const entry = await queryOne(
      `UPDATE bc_production_calendar SET
         scheduled_date = COALESCE($1, scheduled_date),
         start_minute = COALESCE($2, start_minute),
         duration_minutes = COALESCE($3, duration_minutes),
         updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [scheduledDate || null, startMinute != null ? startMinute : null, durationMinutes != null ? durationMinutes : null, req.params.id]
    );
    if (!entry) return res.status(404).json({ error: 'Not found' });
    syncCalToGCal('update', entry).catch((e) => console.error('[GCal bc]', e.message));

    // Влаченето праща дата/начало, дърпането на ръба — само продължителност.
    if (scheduledDate || startMinute != null) {
      logAction(req, 'move', entry, 'премести за ' + humanWhen(entry.scheduled_date, entry.start_minute));
    } else if (durationMinutes != null) {
      logAction(req, 'resize', entry, 'смени продължителността на ' + entry.duration_minutes + ' мин');
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bc-calendar/:id — unschedule (card returns to the sidebar)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await ensureSchema();
    const entry = await queryOne('DELETE FROM bc_production_calendar WHERE id = $1 RETURNING *', [req.params.id]);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    if (entry.google_calendar_event_id) {
      // Празен google_calendar_id по стари редове значи производственият календар.
      deleteGCalEvent(entry.google_calendar_event_id, entry.google_calendar_id || undefined).catch(() => {});
    }
    logAction(req, 'remove', entry, 'върна в списъка (беше за ' + humanWhen(entry.scheduled_date, entry.start_minute) + ')');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Basecamp линк → „smart deep-link" мост на платформата (/go/basecamp/...).
// Тапнат от Google Calendar, той отваря нативното приложение на телефона (ако е инсталирано)
// и сайта на десктоп — вместо да дава грешка във вградения браузър на календара.
function goLink(bcUrl) {
  if (!bcUrl) return '';
  const m = /^https?:\/\/(?:3\.basecamp\.com|app\.basecamp\.com)\/(.+)$/i.exec(bcUrl);
  return m ? 'https://thepact.pro/go/basecamp/' + m[1] : bcUrl;
}

async function syncCalToGCal(action, entry) {
  try {
    const dateStr = dateOnly(entry.scheduled_date);
    const pad = (n) => String(n).padStart(2, '0');
    const sH = Math.floor(entry.start_minute / 60), sM = entry.start_minute % 60;
    const endMin = entry.start_minute + (entry.duration_minutes || 60);
    const eH = Math.floor(endMin / 60), eM = endMin % 60;
    const event = {
      title: '🎬 ' + (entry.card_title || ('Карта ' + entry.basecamp_card_id)),
      description: entry.card_url ? ('📋 Отвори в Basecamp: ' + goLink(entry.card_url)) : '',
      starts_at: dateStr + 'T' + pad(sH) + ':' + pad(sM) + ':00',
      ends_at: dateStr + 'T' + pad(eH) + ':' + pad(eM) + ':00',
      all_day: false,
    };
    // Празен google_calendar_id (стари редове) значи производственият календар.
    const targetCal = entry.google_calendar_id || undefined;
    if (action === 'create' || (action === 'update' && !entry.google_calendar_event_id)) {
      const gid = await createGCalEvent(event, [], targetCal);
      if (gid) await execute('UPDATE bc_production_calendar SET google_calendar_event_id = $1 WHERE id = $2', [gid, entry.id]);
    } else if (action === 'update' && entry.google_calendar_event_id) {
      await updateGCalEvent(entry.google_calendar_event_id, event, [], targetCal);
    }
  } catch (e) {
    console.error('[GCal bc] sync', e.message);
  }
}

module.exports = router;
