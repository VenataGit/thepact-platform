// Basecamp-backed Production Calendar.
// Sidebar = Production card-table cards not yet scheduled, sorted by the FILMING deadline
// (publish date = card due date; filming = publish − 11 working days). Drag onto the week
// view to schedule (stored locally in bc_production_calendar, keyed by Basecamp card id),
// which also syncs to Google Calendar with a link back to the Basecamp card.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const config = require('../config');
const { query, queryOne, execute } = require('../db/pool');
const bc = require('../services/basecamp');
const { getUserAuth } = require('../services/basecamp-token');
const { createGCalEvent, updateGCalEvent, deleteGCalEvent } = require('../services/google-calendar');

const FILMING_OFFSET = parseInt(process.env.BASECAMP_FILMING_OFFSET) || 11; // working days before publish
const { ymd, subtractWorkingDays, workingDaysUntil } = require('../services/workdays');

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
      out.push({ id: c.id, title: c.title, url: c.app_url, due_on: c.due_on, column: list.title, deadline, dl_class: dlClassFor(deadline) });
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

    const rows = await query(
      "SELECT id, basecamp_card_id, card_title, card_url, to_char(scheduled_date,'YYYY-MM-DD') AS scheduled_date, start_minute, duration_minutes FROM bc_production_calendar ORDER BY scheduled_date, start_minute"
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
        dl_class: card ? card.dl_class : 'dl-none',
      };
    });

    res.json({ cards: unscheduled, entries });
  } catch (err) {
    console.error('[bc-calendar]', err.message);
    res.status(err.code === 'NO_USER_TOKEN' ? 401 : 502).json({ error: err.message });
  }
});

// POST /api/bc-calendar — schedule a card (one entry per card; re-scheduling updates it)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { cardId, title, url, scheduledDate, startMinute, durationMinutes } = req.body || {};
    if (!cardId || !scheduledDate) return res.status(400).json({ error: 'cardId and scheduledDate required' });
    const entry = await queryOne(
      `INSERT INTO bc_production_calendar (basecamp_card_id, card_title, card_url, scheduled_date, start_minute, duration_minutes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (basecamp_card_id) DO UPDATE SET
         card_title = EXCLUDED.card_title, card_url = EXCLUDED.card_url,
         scheduled_date = EXCLUDED.scheduled_date, start_minute = EXCLUDED.start_minute,
         duration_minutes = EXCLUDED.duration_minutes, updated_at = NOW()
       RETURNING *`,
      [cardId, title || null, url || null, scheduledDate, startMinute != null ? startMinute : 540, durationMinutes != null ? durationMinutes : 60, req.user.userId]
    );
    syncCalToGCal(entry.google_calendar_event_id ? 'update' : 'create', entry).catch((e) => console.error('[GCal bc]', e.message));
    res.status(201).json({
      id: entry.id, card_id: entry.basecamp_card_id, card_title: entry.card_title, card_url: entry.card_url,
      scheduled_date: scheduledDate, start_minute: entry.start_minute, duration_minutes: entry.duration_minutes,
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
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bc-calendar/:id — unschedule (card returns to the sidebar)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const entry = await queryOne('DELETE FROM bc_production_calendar WHERE id = $1 RETURNING *', [req.params.id]);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    if (entry.google_calendar_event_id) deleteGCalEvent(entry.google_calendar_event_id).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function syncCalToGCal(action, entry) {
  try {
    const dateStr = typeof entry.scheduled_date === 'string' ? entry.scheduled_date.split('T')[0] : ymd(new Date(entry.scheduled_date));
    const pad = (n) => String(n).padStart(2, '0');
    const sH = Math.floor(entry.start_minute / 60), sM = entry.start_minute % 60;
    const endMin = entry.start_minute + (entry.duration_minutes || 60);
    const eH = Math.floor(endMin / 60), eM = endMin % 60;
    const event = {
      title: '🎬 ' + (entry.card_title || ('Карта ' + entry.basecamp_card_id)),
      description: entry.card_url ? ('📋 Отвори в Basecamp: ' + entry.card_url) : '',
      starts_at: dateStr + 'T' + pad(sH) + ':' + pad(sM) + ':00',
      ends_at: dateStr + 'T' + pad(eH) + ':' + pad(eM) + ':00',
      all_day: false,
    };
    if (action === 'create' || (action === 'update' && !entry.google_calendar_event_id)) {
      const gid = await createGCalEvent(event);
      if (gid) await execute('UPDATE bc_production_calendar SET google_calendar_event_id = $1 WHERE id = $2', [gid, entry.id]);
    } else if (action === 'update' && entry.google_calendar_event_id) {
      await updateGCalEvent(entry.google_calendar_event_id, event);
    }
  } catch (e) {
    console.error('[GCal bc] sync', e.message);
  }
}

module.exports = router;
