// Google Calendar → Basecamp „Календар известия".
//
// Всяка минута: инкрементален sync (syncToken) на всички включени календари (gcal_feeds).
//   Ново събитие      → съобщение в Message Board-а (ботът ThePactAlerts). Никой не се
//                       известява масово — само @споменатите: създателят на събитието
//                       (мапнат по имейл) + отговорниците за календара (gcal_feed_responsibles).
//   Промяна / отмяна  → коментар под оригиналното съобщение (Фаза 2); известява абонатите
//                       на нишката (спомената̀тите се абонират при публикуването).
//
// Първият sync на календар е само baseline (запазва syncToken, нищо не обявява),
// ограничен с timeMin=сега — стари събития не заливат борда. Събития, създадени от
// самия service account (Production Calendar sync-а), се пропускат — анти-шум.
const cron = require('node-cron');
const { query, queryOne, execute } = require('../db/pool');
const { getCalendarClient, getServiceAccountEmail } = require('./google-calendar');
const bc = require('./basecamp');
const { getServiceAuth } = require('./basecamp-token');

const TZ = 'Europe/Sofia';
let running = false;

function initGcalAlerts() {
  try {
    cron.schedule('* * * * *', () => {
      syncAllFeeds().catch((err) => console.error('[gcal-alerts] sync error:', err.message));
    });
    console.log('  GCal alerts: active (every minute)');
  } catch (err) {
    console.log('  GCal alerts: skipped —', err.message);
  }
}

// ---------- настройки + контекст ----------

async function loadConfig() {
  const rows = await query(
    "SELECT key, value FROM settings WHERE key IN ('gcal_alerts_enabled','gcal_alerts_bc_project','gcal_alerts_bc_board')"
  );
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    enabled: s.gcal_alerts_enabled === 'true',
    project: parseInt(s.gcal_alerts_bc_project) || null,
    board: parseInt(s.gcal_alerts_bc_board) || null,
  };
}

// Хората в Basecamp проекта (person id → { sgid, name }) — кеш 10 мин.
let _peopleCache = { at: 0, project: null, map: null };
async function getPeopleMap(auth, projectId) {
  const now = Date.now();
  if (_peopleCache.map && _peopleCache.project === projectId && now - _peopleCache.at < 10 * 60_000) {
    return _peopleCache.map;
  }
  const people = await bc.getProjectPeople(auth.token, auth.account, projectId);
  const map = new Map();
  for (const p of people) map.set(Number(p.id), { sgid: p.attachable_sgid, name: p.name });
  _peopleCache = { at: now, project: projectId, map };
  return map;
}

function mentionHtml(peopleMap, basecampUserId, fallbackName) {
  const p = basecampUserId ? peopleMap.get(Number(basecampUserId)) : null;
  if (p && p.sgid) return `<bc-attachment sgid="${p.sgid}"></bc-attachment>`;
  return `<strong>${escHtml(fallbackName || 'неизвестен')}</strong>`;
}

// Google имейл → платформен потребител: първо ръчния мапинг, после users.email.
async function resolveUserByGoogleEmail(email) {
  if (!email) return null;
  const lower = String(email).toLowerCase();
  const mapped = await queryOne(
    'SELECT u.* FROM gcal_person_map m JOIN users u ON u.id = m.user_id WHERE LOWER(m.google_email) = $1',
    [lower]
  );
  if (mapped) return mapped;
  return queryOne('SELECT * FROM users WHERE LOWER(email) = $1 AND is_active = true', [lower]);
}

// ---------- форматиране (български, Europe/Sofia) ----------

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(d, opts) {
  return new Intl.DateTimeFormat('bg-BG', { timeZone: TZ, ...opts }).format(d);
}

// „вторник, 14 юли 2026 г., 10:00–12:00" / „цял ден, вторник, 14 юли 2026 г."
function fmtEventTime(start, end) {
  const dayOpts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const timeOpts = { hour: '2-digit', minute: '2-digit', hour12: false };
  if (start && start.date) {
    // Целодневно; end.date е ексклузивна → изваждаме 1 ден.
    const s = new Date(start.date + 'T00:00:00');
    let e = end && end.date ? new Date(end.date + 'T00:00:00') : null;
    if (e) e.setDate(e.getDate() - 1);
    if (!e || e.getTime() <= s.getTime()) return `цял ден, ${fmtDate(s, dayOpts)}`;
    return `${fmtDate(s, dayOpts)} – ${fmtDate(e, dayOpts)} (цял ден)`;
  }
  const s = new Date(start.dateTime);
  const e = end && end.dateTime ? new Date(end.dateTime) : null;
  const sameDay = e && fmtDate(s, { dateStyle: 'short' }) === fmtDate(e, { dateStyle: 'short' });
  if (!e) return `${fmtDate(s, dayOpts)}, ${fmtDate(s, timeOpts)}`;
  if (sameDay) return `${fmtDate(s, dayOpts)}, ${fmtDate(s, timeOpts)}–${fmtDate(e, timeOpts)}`;
  return `${fmtDate(s, dayOpts)}, ${fmtDate(s, timeOpts)} – ${fmtDate(e, dayOpts)}, ${fmtDate(e, timeOpts)}`;
}

function shortDate(start) {
  const d = start.date ? new Date(start.date + 'T00:00:00') : new Date(start.dateTime);
  return fmtDate(d, { day: 'numeric', month: 'long' });
}

function fingerprintOf(ev) {
  return JSON.stringify([
    ev.start && (ev.start.dateTime || ev.start.date) || '',
    ev.end && (ev.end.dateTime || ev.end.date) || '',
    ev.summary || '',
    ev.location || '',
  ]);
}

function timeFromFingerprint(fp) {
  try {
    const [s, e] = JSON.parse(fp);
    const wrap = (v) => (v && v.length === 10 ? { date: v } : { dateTime: v });
    return s ? fmtEventTime(wrap(s), e ? wrap(e) : null) : '';
  } catch { return ''; }
}

function plainDescription(html) {
  const text = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  if (!text) return '';
  const cut = text.length > 400 ? text.slice(0, 400) + '…' : text;
  return escHtml(cut).replace(/\n/g, '<br>');
}

// ---------- основен цикъл ----------

async function syncAllFeeds() {
  if (running) return;
  running = true;
  try {
    const cfg = await loadConfig();
    if (!cfg.enabled || !cfg.project || !cfg.board) return;
    const calendar = getCalendarClient();
    if (!calendar) return;

    const feeds = await query('SELECT * FROM gcal_feeds WHERE enabled = true ORDER BY id');
    for (const feed of feeds) {
      try {
        await syncFeed(calendar, feed, cfg);
        await execute('UPDATE gcal_feeds SET last_sync_at = NOW(), last_error = NULL WHERE id = $1', [feed.id]);
      } catch (err) {
        const msg = friendlyGoogleError(err);
        console.error(`[gcal-alerts] feed ${feed.google_calendar_id}: ${msg}`);
        await execute('UPDATE gcal_feeds SET last_sync_at = NOW(), last_error = $2 WHERE id = $1', [feed.id, msg]);
      }
    }
  } finally {
    running = false;
  }
}

function friendlyGoogleError(err) {
  const code = err && (err.code || err.status);
  if (code === 404 || code === 403) return 'Няма достъп — сподели календара със service account имейла.';
  return String(err.message || err).slice(0, 300);
}

async function syncFeed(calendar, feed, cfg) {
  const baseParams = { calendarId: feed.google_calendar_id, maxResults: 250, showDeleted: true };

  if (!feed.sync_token) {
    // Baseline: само взимаме syncToken (от сега нататък), без да обявяваме нищо.
    let pageToken = null;
    let syncToken = null;
    do {
      const res = await calendar.events.list({
        ...baseParams,
        timeMin: new Date().toISOString(),
        ...(pageToken ? { pageToken } : {}),
      });
      pageToken = res.data.nextPageToken || null;
      syncToken = res.data.nextSyncToken || syncToken;
    } while (pageToken);
    if (syncToken) {
      await execute('UPDATE gcal_feeds SET sync_token = $2 WHERE id = $1', [feed.id, syncToken]);
      console.log(`[gcal-alerts] baseline done: ${feed.google_calendar_id}`);
    }
    return;
  }

  // Инкрементално: само промените от последния sync.
  let pageToken = null;
  let syncToken = null;
  const events = [];
  try {
    do {
      const res = await calendar.events.list({
        ...baseParams,
        syncToken: feed.sync_token,
        ...(pageToken ? { pageToken } : {}),
      });
      if (Array.isArray(res.data.items)) events.push(...res.data.items);
      pageToken = res.data.nextPageToken || null;
      syncToken = res.data.nextSyncToken || syncToken;
    } while (pageToken);
  } catch (err) {
    if (err && (err.code === 410 || err.status === 410)) {
      // Изтекъл syncToken → нов baseline при следващия цикъл.
      await execute('UPDATE gcal_feeds SET sync_token = NULL WHERE id = $1', [feed.id]);
      console.warn(`[gcal-alerts] sync token expired, re-baseline: ${feed.google_calendar_id}`);
      return;
    }
    throw err;
  }

  for (const ev of events) {
    try {
      await processEvent(feed, ev, cfg);
    } catch (err) {
      console.error(`[gcal-alerts] event ${ev.id}: ${err.message}`);
    }
  }
  if (syncToken && syncToken !== feed.sync_token) {
    await execute('UPDATE gcal_feeds SET sync_token = $2 WHERE id = $1', [feed.id, syncToken]);
  }
}

// ---------- обработка на едно събитие ----------

async function processEvent(feed, ev, cfg) {
  if (!ev || !ev.id) return;
  if (ev.eventType && ev.eventType !== 'default') return; // outOfOffice/workingLocation и т.н.

  // Нашите собствени събития (Production Calendar sync-а пише през същия service account).
  const saEmail = (getServiceAccountEmail() || '').toLowerCase();
  const creatorEmail = (ev.creator && ev.creator.email || '').toLowerCase();
  if (saEmail && creatorEmail === saEmail) return;

  // Отминали събития (край преди >24ч) не носят стойност — тишина.
  const endRaw = ev.end && (ev.end.dateTime || (ev.end.date && ev.end.date + 'T23:59:59'));
  if (endRaw && new Date(endRaw).getTime() < Date.now() - 24 * 3600_000) return;

  const logRow = await queryOne(
    'SELECT * FROM gcal_event_log WHERE feed_id = $1 AND google_event_id = $2',
    [feed.id, ev.id]
  );

  if (ev.status === 'cancelled') {
    // Отменена инстанция на серия → коментар под съобщението на серията.
    if (!logRow && ev.recurringEventId) {
      const master = await queryOne(
        'SELECT * FROM gcal_event_log WHERE feed_id = $1 AND google_event_id = $2',
        [feed.id, ev.recurringEventId]
      );
      if (master && master.bc_message_id) {
        const when = ev.originalStartTime ? fmtEventTime(ev.originalStartTime, null) : '';
        await postComment(cfg, master, `❌ <strong>Отменена дата</strong> от „${escHtml(master.title || '')}"${when ? `: ${escHtml(when)}` : ''}.`);
        await insertLog(feed, ev, master, 'cancelled');
      }
      return;
    }
    if (logRow && logRow.status !== 'cancelled' && logRow.bc_message_id) {
      const oldTime = timeFromFingerprint(logRow.fingerprint);
      await postComment(cfg, logRow, `❌ <strong>Отменено:</strong> „${escHtml(logRow.title || '')}"${oldTime ? ` (${escHtml(oldTime)})` : ''} е изтрито от календара.`);
      await execute("UPDATE gcal_event_log SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [logRow.id]);
    }
    return;
  }

  // Активно събитие.
  const fp = fingerprintOf(ev);

  if (!logRow) {
    if (ev.recurringEventId) {
      // Променена инстанция на серия → коментар под съобщението на серията.
      const master = await queryOne(
        'SELECT * FROM gcal_event_log WHERE feed_id = $1 AND google_event_id = $2',
        [feed.id, ev.recurringEventId]
      );
      if (master && master.bc_message_id) {
        const from = ev.originalStartTime ? fmtEventTime(ev.originalStartTime, null) : '';
        await postComment(cfg, master,
          `⏰ <strong>Преместена дата</strong> от „${escHtml(master.title || '')}"${from ? ` (беше: ${escHtml(from)})` : ''}<br>Ново време: <strong>${escHtml(fmtEventTime(ev.start, ev.end))}</strong>`);
        await insertLog(feed, ev, master, 'active', fp);
      }
      return;
    }
    await postNewEventMessage(feed, ev, cfg, fp);
    return;
  }

  if (logRow.status === 'cancelled') {
    if (logRow.bc_message_id) {
      await postComment(cfg, logRow, `↩️ <strong>Възстановено:</strong> „${escHtml(ev.summary || logRow.title || '')}" — ${escHtml(fmtEventTime(ev.start, ev.end))}`);
    }
    await execute("UPDATE gcal_event_log SET status = 'active', fingerprint = $2, title = $3, updated_at = NOW() WHERE id = $1", [logRow.id, fp, ev.summary || '']);
    return;
  }

  if (fp !== logRow.fingerprint && logRow.bc_message_id) {
    const lines = buildChangeLines(logRow, ev);
    if (lines.length) await postComment(cfg, logRow, lines.join('<br>'));
    await execute('UPDATE gcal_event_log SET fingerprint = $2, title = $3, updated_at = NOW() WHERE id = $1', [logRow.id, fp, ev.summary || '']);
  }
}

function buildChangeLines(logRow, ev) {
  let old = ['', '', '', ''];
  try { old = JSON.parse(logRow.fingerprint) || old; } catch { /* ignore */ }
  const [oldStart, oldEnd, oldTitle, oldLocation] = old;
  const lines = [];
  const newStart = ev.start && (ev.start.dateTime || ev.start.date) || '';
  const newEnd = ev.end && (ev.end.dateTime || ev.end.date) || '';
  if (newStart !== oldStart || newEnd !== oldEnd) {
    const was = timeFromFingerprint(logRow.fingerprint);
    lines.push(`⏰ <strong>Ново време:</strong> ${escHtml(fmtEventTime(ev.start, ev.end))}${was ? ` <em>(беше: ${escHtml(was)})</em>` : ''}`);
  }
  if ((ev.summary || '') !== oldTitle) {
    lines.push(`✏️ <strong>Ново заглавие:</strong> „${escHtml(ev.summary || '')}"${oldTitle ? ` <em>(беше: „${escHtml(oldTitle)}")</em>` : ''}`);
  }
  if ((ev.location || '') !== (oldLocation || '')) {
    lines.push(`📍 <strong>Ново място:</strong> ${escHtml(ev.location || '—')}`);
  }
  if (lines.length) lines.unshift(`<strong>Промяна</strong> по „${escHtml(ev.summary || logRow.title || '')}":`);
  return lines;
}

async function insertLog(feed, ev, master, status, fp) {
  await execute(
    `INSERT INTO gcal_event_log (feed_id, google_event_id, bc_message_id, bc_project_id, title, fingerprint, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (feed_id, google_event_id) DO UPDATE SET status = $7, fingerprint = $6, updated_at = NOW()`,
    [feed.id, ev.id, master ? master.bc_message_id : null, master ? master.bc_project_id : null,
     ev.summary || (master && master.title) || '', fp || fingerprintOf(ev), status]
  );
}

// ---------- Basecamp публикуване ----------

async function postNewEventMessage(feed, ev, cfg, fp) {
  const auth = await getServiceAuth();
  const peopleMap = await getPeopleMap(auth, cfg.project);

  const creatorUser = await resolveUserByGoogleEmail(ev.creator && ev.creator.email);
  const creatorName = (creatorUser && creatorUser.name)
    || (ev.creator && (ev.creator.displayName || ev.creator.email)) || 'неизвестен';
  let responsibles = await query(
    `SELECT u.* FROM gcal_feed_responsibles r JOIN users u ON u.id = r.user_id
     WHERE r.feed_id = $1 AND u.is_active = true ORDER BY u.name`,
    [feed.id]
  );
  // Създателят не се тагва втори път като отговорник.
  if (creatorUser) responsibles = responsibles.filter((u) => u.id !== creatorUser.id);

  const calName = feed.name || feed.google_calendar_id;
  const isNew = !ev.created || (Date.now() - new Date(ev.created).getTime()) < 24 * 3600_000;
  const isRecurring = Array.isArray(ev.recurrence) && ev.recurrence.length > 0;

  const lines = [];
  lines.push(`🗓 <strong>${escHtml(fmtEventTime(ev.start, ev.end))}</strong>`);
  lines.push(`📆 Календар: <strong>${escHtml(calName)}</strong>`);
  if (ev.location) lines.push(`📍 ${escHtml(ev.location)}`);
  if (isRecurring) lines.push('🔁 Повтарящо се събитие');
  lines.push('');
  lines.push(`✍️ Създадено от: ${mentionHtml(peopleMap, creatorUser && creatorUser.basecamp_user_id, creatorName)}`);
  if (responsibles.length) {
    const tags = responsibles.map((u) => mentionHtml(peopleMap, u.basecamp_user_id, u.name)).join(' ');
    lines.push(`👥 Отговорни за календара: ${tags}`);
  }
  const desc = plainDescription(ev.description);
  if (desc) { lines.push(''); lines.push(`<em>${desc}</em>`); }
  if (ev.htmlLink) { lines.push(''); lines.push(`<a href="${escHtml(ev.htmlLink)}">Отвори в Google Calendar</a>`); }

  const subject = `📅 ${isNew ? 'Ново събитие' : 'Събитие'}: ${ev.summary || 'Без заглавие'} — ${shortDate(ev.start || {})}`;
  const message = await bc.createMessage(auth.token, auth.account, cfg.project, cfg.board, {
    subject,
    content: `<div>${lines.join('<br>')}</div>`,
  });

  await execute(
    `INSERT INTO gcal_event_log (feed_id, google_event_id, bc_message_id, bc_project_id, title, fingerprint, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     ON CONFLICT (feed_id, google_event_id) DO UPDATE SET bc_message_id = $3, bc_project_id = $4, title = $5, fingerprint = $6, status = 'active', updated_at = NOW()`,
    [feed.id, ev.id, message.id, cfg.project, ev.summary || '', fp]
  );

  // Абонираме създателя + отговорниците за нишката → Фаза 2 коментарите ги известяват.
  const subscriberIds = [creatorUser, ...responsibles]
    .filter((u) => u && u.basecamp_user_id && peopleMap.has(Number(u.basecamp_user_id)))
    .map((u) => Number(u.basecamp_user_id));
  if (subscriberIds.length) {
    try {
      await bc.addSubscribers(auth.token, auth.account, cfg.project, message.id, [...new Set(subscriberIds)]);
    } catch (err) {
      console.warn('[gcal-alerts] subscribe failed:', err.message);
    }
  }
  console.log(`[gcal-alerts] posted: "${subject}" (message ${message.id})`);
}

async function postComment(cfg, logRow, content) {
  const auth = await getServiceAuth();
  const projectId = logRow.bc_project_id || cfg.project;
  await bc.createComment(auth.token, auth.account, projectId, logRow.bc_message_id, `<div>${content}</div>`);
  console.log(`[gcal-alerts] comment on message ${logRow.bc_message_id}`);
}

// ---------- помощни за админ панела ----------

// Жива проверка: има ли service account-ът достъп до календара. Връща и името му.
async function checkCalendarAccess(calendarId) {
  const calendar = getCalendarClient();
  if (!calendar) return { ok: false, error: 'Google credentials не са конфигурирани на сървъра.' };
  try {
    const res = await calendar.calendars.get({ calendarId });
    return { ok: true, name: res.data.summary || '' };
  } catch (err) {
    return { ok: false, error: friendlyGoogleError(err) };
  }
}

// Тестово съобщение в борда — проверка на Basecamp връзката от админ панела.
async function postTestMessage() {
  const cfg = await loadConfig();
  if (!cfg.project || !cfg.board) throw new Error('Не е зададен Message Board.');
  const auth = await getServiceAuth();
  const now = fmtDate(new Date(), { dateStyle: 'medium', timeStyle: 'short' });
  return bc.createMessage(auth.token, auth.account, cfg.project, cfg.board, {
    subject: '🔧 Тест: Календар известия',
    content: `<div>Връзката Google Calendar → Basecamp работи. Изпратено от платформата на ${escHtml(now)}. Това съобщение може да се изтрие.</div>`,
  });
}

module.exports = {
  initGcalAlerts,
  syncAllFeeds,
  checkCalendarAccess,
  postTestMessage,
};
