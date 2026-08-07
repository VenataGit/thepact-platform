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
const { getCalendarClient, getServiceAccountEmail, getTargetCalendarId } = require('./google-calendar');
const bc = require('./basecamp');
const agg = require('./bc-aggregate');
const team = require('./bc-team');
const { getServiceAuth } = require('./basecamp-token');

const TZ = 'Europe/Sofia';
let running = false;

function initGcalAlerts() {
  try {
    ensureProductionFeed().catch((err) => console.warn('[gcal-alerts] prod feed:', err.message));
    cron.schedule('* * * * *', () => {
      syncAllFeeds().catch((err) => console.error('[gcal-alerts] sync error:', err.message));
    });
    console.log('  GCal alerts: active (every minute)');
  } catch (err) {
    console.log('  GCal alerts: skipped —', err.message);
  }
}

// Производственият календар минава през същите известия като останалите: запази ли
// някой снимки направо в Google, екипът научава в Basecamp. Собствените ни събития
// (писани от service account-а) се пропускат в processEvent, така че влаченето на
// карта в календара не вдига шум.
//
// Засява се веднъж — изтрие ли се feed-ът от админ панела, не се връща при рестарт.
// Първият sync е само baseline (запазва syncToken, нищо не обявява), затова
// съществуващите събития в календара не заливат борда.
async function ensureProductionFeed() {
  const calId = await getTargetCalendarId();
  if (!calId) return; // още няма конфигуриран производствен календар — пробваме пак при следващия старт

  const flag = await queryOne("SELECT value FROM settings WHERE key = 'gcal_alerts_prod_feed_seeded'");
  if (!flag || flag.value !== 'true') {
    const access = await checkCalendarAccess(calId);
    await execute(
      `INSERT INTO gcal_feeds (google_calendar_id, name, last_error) VALUES ($1, $2, $3)
       ON CONFLICT (google_calendar_id) DO NOTHING`,
      [calId, access.name || 'Производствен календар', access.ok ? null : access.error]
    );
    await execute(
      `INSERT INTO settings (key, value, updated_at) VALUES ('gcal_alerts_prod_feed_seeded', 'true', NOW())
       ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()`
    );
    console.log(`[gcal-alerts] производственият календар е включен в известията: ${calId}`);
  }

  const feed = await queryOne('SELECT id FROM gcal_feeds WHERE google_calendar_id = $1', [calId]);
  if (feed) await ensureProductionResponsibles(feed.id);
}

// Календар без отговорници тагва само създателя на събитието — тогава останалите
// от екипа не научават нищо. Точно това стана при първото включване на
// производствения календар: известието излезе, но видя го само Венци.
//
// Затова новият календар наследява хората, зададени на вече следените календари
// („схемата с видеографите"). Веднъж — оттам нататък се управлява от
// Настройки → Календар известия и махнат човек не се връща при рестарт.
// Флагът се вдига само при реално копиране: няма ли още отговорници никъде,
// пробваме пак при следващия старт, вместо да заключим празен списък.
async function ensureProductionResponsibles(feedId) {
  const flag = await queryOne("SELECT value FROM settings WHERE key = 'gcal_alerts_prod_resp_seeded'");
  if (flag && flag.value === 'true') return;

  const inherited = await query(
    'SELECT DISTINCT bc_person_id FROM gcal_feed_responsibles WHERE feed_id <> $1',
    [feedId]
  );
  if (!inherited.length) return;

  for (const row of inherited) {
    await execute(
      'INSERT INTO gcal_feed_responsibles (feed_id, bc_person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [feedId, row.bc_person_id]
    );
  }
  await execute(
    `INSERT INTO settings (key, value, updated_at) VALUES ('gcal_alerts_prod_resp_seeded', 'true', NOW())
     ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()`
  );
  console.log(`[gcal-alerts] производственият календар наследи ${inherited.length} отговорника`);
}

// ---------- настройки + контекст ----------

async function loadConfig() {
  const rows = await query(
    "SELECT key, value FROM settings WHERE key IN ('gcal_alerts_enabled','gcal_alerts_bc_project','gcal_alerts_bc_board','gcal_alerts_ping_campfire')"
  );
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    enabled: s.gcal_alerts_enabled === 'true',
    project: parseInt(s.gcal_alerts_bc_project) || null,
    board: parseInt(s.gcal_alerts_bc_board) || null,
    ping: s.gcal_alerts_ping_campfire !== 'false', // default включен
  };
}

// ---------- екип от Basecamp (bc_people кеш) ----------
// Хората идват от Video Production проекта — никой не трябва да се логва в платформата.
// Самият sync живее в services/bc-team.js със свой дневен cron, за да работи и когато
// Календар известията са изключени. Тук остават само делегиращи обвивки, защото
// routes/gcal-alerts.js и services/kp-results.js викат тези имена.

async function refreshBcPeople() {
  return (await team.refreshTeam()).count;
}

async function ensurePeopleFresh() {
  return team.ensureFresh();
}

const mentionOf = team.mentionOf;

// Person id на самия бот (ThePactAlerts) — ползва се като „празен" абонатен списък:
// Basecamp известява целия проект, ако subscriptions липсва/е празен, затова
// винаги подаваме поне бота (нула човешки известия).
let _botPersonId = null;
async function getBotPersonId(auth) {
  if (_botPersonId) return _botPersonId;
  try {
    const me = await bc.getMyProfile(auth.token, auth.account);
    if (me && me.id) _botPersonId = Number(me.id);
  } catch (err) {
    console.warn('[gcal-alerts] bot profile failed:', err.message);
  }
  return _botPersonId;
}

// Google имейл → Basecamp човек: първо ръчния мапинг, после по имейл в bc_people.
async function resolvePersonByGoogleEmail(email) {
  if (!email) return null;
  const lower = String(email).toLowerCase();
  const mapped = await queryOne(
    `SELECT p.* FROM gcal_person_map m JOIN bc_people p ON p.person_id = m.bc_person_id
     WHERE LOWER(m.google_email) = $1`,
    [lower]
  );
  if (mapped) return mapped;
  return queryOne('SELECT * FROM bc_people WHERE LOWER(email) = $1 AND active = TRUE', [lower]);
}

async function feedResponsibles(feedId) {
  return query(
    `SELECT p.* FROM gcal_feed_responsibles r JOIN bc_people p ON p.person_id = r.bc_person_id
     WHERE r.feed_id = $1 AND p.active = TRUE ORDER BY p.name`,
    [feedId]
  );
}

// Кого касае събитието: създателят (от event payload-а или от лога — Google не праща
// creator при отмяна) + отговорниците за календара. Без дубли.
async function changeAudience(feed, ev, anchorRow) {
  const email = (ev && ev.creator && ev.creator.email) || (anchorRow && anchorRow.creator_email) || null;
  const creator = await resolvePersonByGoogleEmail(email);
  const responsibles = await feedResponsibles(feed.id);
  const uniq = new Map();
  for (const p of [creator, ...responsibles]) {
    if (p && p.person_id) uniq.set(String(p.person_id), p);
  }
  const people = [...uniq.values()];
  return { creator, people, mentionsHtml: people.map((p) => mentionOf(p)).join(' ') };
}

// ---------- Campfire „ping" ----------
// Истински Basecamp Pings (лични съобщения) не са в публичното API. Най-близкото:
// ред в Campfire на проекта с @mention — тагнатите получават нотификация.

let _campfireCache = { at: 0, project: null, id: null };
async function getCampfireId(auth, projectId) {
  if (_campfireCache.id && _campfireCache.project === projectId && Date.now() - _campfireCache.at < 10 * 60_000) {
    return _campfireCache.id;
  }
  const project = await bc.getProject(auth.token, auth.account, projectId);
  const tool = (project.dock || []).find((t) => t.enabled && t.name === 'chat');
  let id = tool ? tool.id : null;
  if (tool && !id && tool.url) {
    try { id = (await bc.authedGet(tool.url, auth.token)).json.id; } catch { /* ignore */ }
  }
  _campfireCache = { at: Date.now(), project: projectId, id };
  return id;
}

async function campfirePing(cfg, auth, html) {
  if (!cfg.ping) return;
  try {
    const chatId = await getCampfireId(auth, cfg.project);
    if (!chatId) return;
    await bc.createCampfireLine(auth.token, auth.account, cfg.project, chatId, html);
  } catch (err) {
    console.warn('[gcal-alerts] campfire ping failed:', err.message);
  }
}

function messageUrl(auth, projectId, messageId) {
  return `https://3.basecamp.com/${auth.account}/buckets/${projectId}/messages/${messageId}`;
}

// ---------- свързана Basecamp задача (по подобно заглавие) ----------

function normTokens(s) {
  // Единичните цифри остават — „Видео 3" срещу „Видео 2" се различават точно по тях.
  return String(s || '').toLowerCase().replace(/[^a-zа-я0-9\s]/gi, ' ').split(/\s+/)
    .filter((w) => w.length >= 2 || /^\d$/.test(w));
}

// Чисто съвпадение по заглавие: дял на общите думи спрямо по-късото заглавие.
// Консервативно: праг 0.6 + поне 2 общи думи; при равен резултат на две карти
// (двусмислено, напр. „Видео 2" срещу „Видео 3") — без линк. Активна карта бие Done.
function bestCardMatch(eventTitle, cards) {
  const evTokens = normTokens(eventTitle);
  if (!evTokens.length) return null;
  const evSet = new Set(evTokens);
  let best = null;
  let ties = 0;
  for (const card of cards) {
    const ct = normTokens(card.title);
    if (!ct.length) continue;
    const hits = ct.filter((t) => evSet.has(t)).length;
    const score = hits / Math.min(ct.length, evTokens.length);
    if (hits < 2 || score < 0.6) continue;
    const rank = score + (card.active ? 0.15 : 0);
    if (!best || rank > best.rank) { best = { rank, title: card.title, url: card.url }; ties = 1; }
    else if (rank === best.rank) ties += 1;
  }
  return best && ties === 1 ? { title: best.title, url: best.url } : null;
}

// Обхожда бордовете на Video Production (топлите кешове на bc-aggregate) и търси
// карта със заглавие, подобно на това на събитието. Грешка → просто няма линк.
async function findRelatedCard(auth, eventTitle) {
  try {
    const struct = await agg.loadStructure(auth.token, auth.account);
    const all = [];
    for (const b of struct.boards || []) {
      let data;
      try { data = await agg.loadBoardCards(auth.token, auth.account, b.id); } catch { continue; }
      const doneCols = new Set((b.columns || []).filter((c) => c.isDone).map((c) => String(c.id)));
      for (const col of data.columns || []) {
        for (const card of [...(col.cards || []), ...(col.onHoldCards || [])]) {
          all.push({ title: card.title, url: card.url, active: !card.completed && !doneCols.has(String(col.id)) });
        }
      }
    }
    return bestCardMatch(eventTitle, all);
  } catch (err) {
    console.warn('[gcal-alerts] related card lookup failed:', err.message);
    return null;
  }
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
    await ensurePeopleFresh();

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
        await postChange(cfg, feed, ev, master,
          `❌ Отменена дата от „${escHtml(master.title || '')}"`,
          `❌ <strong>Отменена дата</strong> от „${escHtml(master.title || '')}"${when ? `: ${escHtml(when)}` : ''}.`);
        await insertLog(feed, ev, master, 'cancelled');
      }
      return;
    }
    if (logRow && logRow.status !== 'cancelled' && logRow.bc_message_id) {
      const oldTime = timeFromFingerprint(logRow.fingerprint);
      await postChange(cfg, feed, ev, logRow,
        `❌ Отменено: „${escHtml(logRow.title || '')}"`,
        `❌ <strong>Отменено:</strong> „${escHtml(logRow.title || '')}"${oldTime ? ` (${escHtml(oldTime)})` : ''} е изтрито от календара.`);
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
        await postChange(cfg, feed, ev, master,
          `⏰ Преместена дата от „${escHtml(master.title || '')}"`,
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
      await postChange(cfg, feed, ev, logRow,
        `↩️ Възстановено: „${escHtml(ev.summary || logRow.title || '')}"`,
        `↩️ <strong>Възстановено:</strong> „${escHtml(ev.summary || logRow.title || '')}" — ${escHtml(fmtEventTime(ev.start, ev.end))}`);
    }
    await execute("UPDATE gcal_event_log SET status = 'active', fingerprint = $2, title = $3, updated_at = NOW() WHERE id = $1", [logRow.id, fp, ev.summary || '']);
    return;
  }

  if (fp !== logRow.fingerprint && logRow.bc_message_id) {
    const lines = buildChangeLines(logRow, ev);
    if (lines.length) {
      await postChange(cfg, feed, ev, logRow,
        `⏰ Промяна по „${escHtml(ev.summary || logRow.title || '')}"`,
        lines.join('<br>'));
    }
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
    `INSERT INTO gcal_event_log (feed_id, google_event_id, bc_message_id, bc_project_id, title, fingerprint, status, creator_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (feed_id, google_event_id) DO UPDATE SET status = $7, fingerprint = $6, updated_at = NOW()`,
    [feed.id, ev.id, master ? master.bc_message_id : null, master ? master.bc_project_id : null,
     ev.summary || (master && master.title) || '', fp || fingerprintOf(ev), status,
     (ev.creator && ev.creator.email) || (master && master.creator_email) || null]
  );
}

// ---------- Basecamp публикуване ----------

async function postNewEventMessage(feed, ev, cfg, fp) {
  const auth = await getServiceAuth();

  const creatorPerson = await resolvePersonByGoogleEmail(ev.creator && ev.creator.email);
  const creatorName = (creatorPerson && creatorPerson.name)
    || (ev.creator && (ev.creator.displayName || ev.creator.email)) || 'неизвестен';
  let responsibles = await feedResponsibles(feed.id);
  // Създателят не се тагва втори път като отговорник.
  if (creatorPerson) responsibles = responsibles.filter((p) => String(p.person_id) !== String(creatorPerson.person_id));

  // Basecamp задача с подобно заглавие → линк в известието.
  const related = await findRelatedCard(auth, ev.summary || '');

  const calName = feed.name || feed.google_calendar_id;
  const isNew = !ev.created || (Date.now() - new Date(ev.created).getTime()) < 24 * 3600_000;
  const isRecurring = Array.isArray(ev.recurrence) && ev.recurrence.length > 0;

  const lines = [];
  lines.push(`🗓 <strong>${escHtml(fmtEventTime(ev.start, ev.end))}</strong>`);
  lines.push(`📆 Календар: <strong>${escHtml(calName)}</strong>`);
  if (ev.location) lines.push(`📍 ${escHtml(ev.location)}`);
  if (isRecurring) lines.push('🔁 Повтарящо се събитие');
  if (related) lines.push(`🔗 Свързана задача: <a href="${escHtml(related.url)}">${escHtml(related.title)}</a>`);
  lines.push('');
  lines.push(`✍️ Създадено от: ${mentionOf(creatorPerson, creatorName)}`);
  if (responsibles.length) {
    const tags = responsibles.map((p) => mentionOf(p, p.name)).join(' ');
    lines.push(`👥 Отговорни за календара: ${tags}`);
  }
  lines.push('');
  // Ботът изисква потвърждение от създателя, че информацията е пълна.
  if (creatorPerson) {
    lines.push(`❓ ${mentionOf(creatorPerson)}, предостави ли цялата нужна информация за събитието (час, място, детайли)? Ако нещо липсва — добави го в коментар тук${related ? ' или в свързаната задача' : ''}.`);
  } else {
    lines.push(`❓ Създателят (${escHtml((ev.creator && ev.creator.email) || 'неизвестен')}) не е разпознат в екипа — проверете дали информацията за събитието е пълна.`);
  }
  const desc = plainDescription(ev.description);
  if (desc) { lines.push(''); lines.push(`<em>${desc}</em>`); }
  if (ev.htmlLink) { lines.push(''); lines.push(`<a href="${escHtml(ev.htmlLink)}">Отвори в Google Calendar</a>`); }

  // Абонати = точно тагнатите (създател + отговорници) → само те получават
  // известието и Фаза 2 коментарите; никой друг от проекта не се пингва.
  let subscriberIds = [...new Set(
    [creatorPerson, ...responsibles].filter((p) => p && p.person_id).map((p) => Number(p.person_id))
  )];
  if (!subscriberIds.length) {
    const botId = await getBotPersonId(auth);
    if (botId) subscriberIds = [botId];
  }

  const subject = `📅 ${isNew ? 'Ново събитие' : 'Събитие'}: ${ev.summary || 'Без заглавие'} — ${shortDate(ev.start || {})}`;
  const message = await bc.createMessage(auth.token, auth.account, cfg.project, cfg.board, {
    subject,
    content: `<div>${lines.join('<br>')}</div>`,
    subscriptions: subscriberIds,
  });

  await execute(
    `INSERT INTO gcal_event_log (feed_id, google_event_id, bc_message_id, bc_project_id, title, fingerprint, status, creator_email)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
     ON CONFLICT (feed_id, google_event_id) DO UPDATE SET bc_message_id = $3, bc_project_id = $4, title = $5, fingerprint = $6, status = 'active', creator_email = $7, updated_at = NOW()`,
    [feed.id, ev.id, message.id, cfg.project, ev.summary || '', fp, (ev.creator && ev.creator.email) || null]
  );

  // Campfire „ping" към същите хора (mention в чата = нотификация).
  const pingPeople = [creatorPerson, ...responsibles].filter((p) => p && p.person_id);
  if (pingPeople.length) {
    const tags = pingPeople.map((p) => mentionOf(p)).join(' ');
    await campfirePing(cfg, auth,
      `<div>📅 Ново събитие: „${escHtml(ev.summary || 'Без заглавие')}" — ${escHtml(fmtEventTime(ev.start, ev.end))} · ${tags} · <a href="${escHtml(bc.normalizeAppUrl(message.app_url) || messageUrl(auth, cfg.project, message.id))}">Виж известието</a></div>`);
  }

  console.log(`[gcal-alerts] posted: "${subject}" (message ${message.id}, notified ${subscriberIds.length})`);
}

// Промяна/отмяна: коментар под оригиналното съобщение С тагове на създателя +
// отговорниците (mention в коментар = нотификация, независимо от абонамента) +
// Campfire ping към същите хора.
async function postChange(cfg, feed, ev, anchorRow, pingLabel, contentHtml) {
  const auth = await getServiceAuth();
  const { mentionsHtml, people } = await changeAudience(feed, ev, anchorRow);
  const projectId = anchorRow.bc_project_id || cfg.project;
  const content = (mentionsHtml ? mentionsHtml + '<br>' : '') + contentHtml;
  await bc.createComment(auth.token, auth.account, projectId, anchorRow.bc_message_id, `<div>${content}</div>`);
  console.log(`[gcal-alerts] comment on message ${anchorRow.bc_message_id} (тагнати: ${people.length})`);
  if (people.length) {
    await campfirePing(cfg, auth,
      `<div>${pingLabel} · ${mentionsHtml} · <a href="${escHtml(messageUrl(auth, projectId, anchorRow.bc_message_id))}">Виж</a></div>`);
  }
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
// Абонат е само ботът → никой от екипа не получава известие от теста.
async function postTestMessage() {
  const cfg = await loadConfig();
  if (!cfg.project || !cfg.board) throw new Error('Не е зададен Message Board.');
  const auth = await getServiceAuth();
  const botId = await getBotPersonId(auth);
  const now = fmtDate(new Date(), { dateStyle: 'medium', timeStyle: 'short' });
  return bc.createMessage(auth.token, auth.account, cfg.project, cfg.board, {
    subject: '🔧 Тест: Календар известия',
    content: `<div>Връзката Google Calendar → Basecamp работи. Изпратено от платформата на ${escHtml(now)}. Това съобщение може да се изтрие.</div>`,
    subscriptions: botId ? [botId] : [],
  });
}

module.exports = {
  initGcalAlerts,
  syncAllFeeds,
  checkCalendarAccess,
  postTestMessage,
  refreshBcPeople,
  mentionOf,
  bestCardMatch,
};
