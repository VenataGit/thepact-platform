// Shared КП (content plan) card creation — used by BOTH the manual route
// (routes/kp.js) and the daily scheduler (services/kp-scheduler.js), so the two
// paths can never drift apart (before this file the scheduler built a simplified
// content instead of the admin templates).
//
// Destination is configurable from Админ → КП-Автоматизация:
//   kp_bc_enabled = true  -> a card in Basecamp (Pre-Production → Измисляне by default)
//   kp_bc_enabled = false -> the old local platform card (column kp_izmislyane_column_id)
// Board/column ids, title template, due-date offset, notify flag etc. all come from
// the settings table; empty board/column = auto-detect by name so it works out of the box.
const config = require('../config');
const { query, queryOne, execute } = require('../db/pool');
const bc = require('./basecamp');
const agg = require('./bc-aggregate');
const workdays = require('./workdays');

// ---------- default templates (same text as before the settings existed) ----------

const KP_VIDEO_SECTION_TEMPLATE = `Видео {N} - ХХХ
/Участници - ХХХ/
/Локация - ХХХ/
/Необходими ресурси - ХХХ/

Описание:
ХХХ


Копи: ХХХ
Дата за публикуване: ХХХ
Контент криейтър: ХХХ`;

const KP_DEFAULT_TEMPLATE = `Дата за публикуване на първо видео: {first_publish_date}

Допълнителна информация от акаунт – ХХХ

{video_sections}`;

const KP_DEFAULT_TITLE_TEMPLATE = '{клиент} КП-{номер}';

// ---------- config ----------

// All КП settings in one object (single query + template lookup).
async function loadKpConfig() {
  const rows = await query(
    `SELECT key, value FROM settings WHERE key IN (
      'kp_bc_enabled','kp_bc_board_id','kp_bc_column_id','kp_bc_title_template',
      'kp_bc_due_days','kp_bc_notify','kp_bc_actor','kp_bc_check_scope',
      'kp_auto_create_enabled','kp_auto_create_time','kp_auto_create_weekends',
      'kp_default_videos','kp_calendar_window','kp_days_before_next_kp',
      'kp_izmislyane_column_id','kp_days_brainstorm'
    )`
  );
  const s = {};
  for (const r of rows) s[r.key] = r.value;

  const tpl = await query("SELECT key, value FROM app_settings WHERE key IN ('kp_template','kp_video_section_template')");
  const t = {};
  for (const r of tpl) t[r.key] = r.value;

  const intOr = (v, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : n; };
  return {
    bcEnabled: s.kp_bc_enabled !== 'false', // default ON — КП картите отиват в Basecamp
    boardId: s.kp_bc_board_id || null,      // null = auto-detect Pre-Production
    columnId: s.kp_bc_column_id || null,    // null = auto-detect Измисляне
    titleTemplate: s.kp_bc_title_template || KP_DEFAULT_TITLE_TEMPLATE,
    // '' = без Due date; '0' = самият ден на първото видео; N = N работни дни по-рано
    dueDays: s.kp_bc_due_days === '' ? null : intOr(s.kp_bc_due_days, 10),
    notify: s.kp_bc_notify === 'true',
    actor: s.kp_bc_actor === 'bot' ? 'bot' : 'user', // кой създава при ръчно пускане
    checkScope: s.kp_bc_check_scope === 'board' ? 'board' : 'column',
    autoEnabled: s.kp_auto_create_enabled !== 'false',
    autoTime: /^\d{1,2}:\d{2}$/.test(s.kp_auto_create_time || '') ? s.kp_auto_create_time : '08:00',
    autoWeekends: s.kp_auto_create_weekends === 'true',
    defaultVideos: intOr(s.kp_default_videos, 10),
    calendarWindow: intOr(s.kp_calendar_window, 30),
    daysBeforeNextKp: intOr(s.kp_days_before_next_kp, 15),
    localColumnId: s.kp_izmislyane_column_id ? parseInt(s.kp_izmislyane_column_id, 10) : null,
    brainstormDays: intOr(s.kp_days_brainstorm, 10),
    mainTemplate: t.kp_template || KP_DEFAULT_TEMPLATE,
    videoSectionTemplate: t.kp_video_section_template || KP_VIDEO_SECTION_TEMPLATE,
  };
}

// ---------- date helpers (moved from routes/kp.js so both callers share them) ----------

// Weekend-only working days (местната платформа исторически смята така —
// Basecamp датите ползват services/workdays.js, който вади и БГ празниците).
function subtractWorkingDaysSimple(date, days) {
  const result = new Date(date);
  let subtracted = 0;
  while (subtracted < days) {
    result.setDate(result.getDate() - 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) subtracted++;
  }
  return result;
}

function toDateStr(d) {
  return d instanceof Date ? d.toISOString().split('T')[0] : String(d).split('T')[0];
}
function toBgDate(d) {
  return d.toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Distribute N videos evenly across a calendar window.
function distributePublishDates(firstDateStr, videoCount, calendarWindow) {
  const first = new Date(firstDateStr + 'T12:00:00');
  if (videoCount <= 1) {
    return {
      dates: [first],
      interval: calendarWindow,
      lastVideoDate: first,
      nextKpFirstDate: new Date(first.getTime() + calendarWindow * 86400000),
    };
  }
  const gap = calendarWindow / (videoCount - 1);
  const dates = [];
  for (let i = 0; i < videoCount; i++) {
    const d = new Date(first);
    d.setDate(d.getDate() + Math.round(i * gap));
    dates.push(d);
  }
  const lastVideoDate = dates[dates.length - 1];
  const nextKpFirst = new Date(lastVideoDate);
  nextKpFirst.setDate(nextKpFirst.getDate() + Math.round(gap));
  return { dates, interval: Math.round(gap * 10) / 10, lastVideoDate, nextKpFirstDate: nextKpFirst };
}

// ---------- title + content ----------

function renderKpTitle(cfg, clientName, kpNumber) {
  return cfg.titleTemplate
    .replace(/\{клиент\}|\{client\}/gi, clientName)
    .replace(/\{номер\}|\{n\}|\{number\}/gi, String(kpNumber))
    .trim();
}

// The title with everything from {номер} onward cut off — used to detect an
// existing КП card for the client regardless of its number ("Cineland КП-").
function kpTitlePrefix(cfg, clientName) {
  const numToken = cfg.titleTemplate.match(/\{номер\}|\{n\}|\{number\}/i);
  const tpl = numToken ? cfg.titleTemplate.slice(0, numToken.index) : cfg.titleTemplate;
  return tpl.replace(/\{клиент\}|\{client\}/gi, clientName).trim();
}

// Plain text of the КП card from the admin templates.
function buildKpContentText(cfg, client, kpNumber, publishDatesBg) {
  const videoCount = publishDatesBg.length;
  const videoSections = [];
  for (let i = 1; i <= videoCount; i++) {
    videoSections.push(cfg.videoSectionTemplate.replace(/\{N\}/g, i));
  }
  let content = cfg.mainTemplate
    .replace(/\{клиент\}|\{client\}/gi, client.name)
    .replace(/\{номер\}|\{number\}/gi, String(kpNumber))
    .replace('{first_publish_date}', publishDatesBg[0] || '')
    .replace('{video_sections}', videoSections.join('\n\n\n'));

  const scheduleLines = publishDatesBg.join('\n');
  if (content.includes('{publish_dates}')) {
    content = content.replace('{publish_dates}', scheduleLines);
  } else {
    // Legacy templates without the {publish_dates} placeholder: inject the full
    // schedule right after the "първо видео" line (historic behaviour).
    content = content.replace(
      /Дата за публикуване на първо видео:.*$/m,
      `Дата за публикуване на първо видео: ${publishDatesBg[0] || ''}\n\nДати за публикуване на видеа:\n${scheduleLines}`
    );
  }
  return content;
}

// Plain text -> Trix-compatible HTML for LOCAL cards ("Видео N" lines get the gold mark).
function textToHtml(text) {
  if (!text) return '';
  return text.split('\n').map(line => {
    const esc = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (esc === '') return '<div><br></div>';
    if (/^Видео\s+\d+\s*[-–—]/.test(line)) {
      return `<div><strong><span style="background-color:#9B7D44;color:#fff">` + esc + `</span></strong></div>`;
    }
    return `<div>${esc}</div>`;
  }).join('');
}

// Plain text -> Basecamp rich HTML in Trix's OWN canonical format.
//
// Trix (Basecamp's editor) stores plain paragraphs as ONE block with <br> between
// lines; a blank line is simply an extra <br>. Emitting a separate <div> per line
// (with <div><br></div> for blanks) looks right in read mode, but the moment you
// open the card for edit, Basecamp's Trix re-parses it and collapses the empty
// blocks → the spacing is lost. So we emit exactly what Trix itself produces
// (verified as a stable round-trip fixed point), which keeps the blank separator
// lines intact through the edit round-trip.
//
// "Видео N - …" headings are wrapped in <mark> (Basecamp's highlight → yellow, the
// first colour) AND <strong>: the <mark> gives the colour, and <strong> keeps the
// heading emphasised even if an older Trix drops the highlight attribute.
function textToBcHtml(text) {
  if (!text) return '';
  const lines = text.split('\n').map((line) => {
    const t = line.trim();
    if (t === '') return ''; // празен ред → допълнителен <br> при join-а
    const e = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (/^Видео\s+\d+\s*[-–—]/.test(t)) return `<strong><mark>${e}</mark></strong>`;
    return e;
  });
  return `<div>${lines.join('<br>')}</div>`;
}

// ---------- Basecamp destination ----------

// Resolve the target board + column. Explicit ids from the settings win; empty
// settings auto-detect by name (board /pre.?produc/, column „Измисляне") so the
// feature works before anyone opens the admin panel.
async function resolveKpDestination(auth, cfg) {
  const struct = await agg.loadStructure(auth.token, auth.account);
  const boards = struct.boards || [];

  let board = null;
  if (cfg.boardId) {
    board = boards.find((b) => String(b.id) === String(cfg.boardId));
    if (!board) throw new Error('Зададената Basecamp дъска вече не съществува — провери Админ → КП-Автоматизация.');
  } else {
    board = boards.find((b) => /pre[\s-]*produc|предпрод/i.test(b.title || '') && !/post|пост/i.test(b.title || ''));
    if (!board) throw new Error('Не намерих дъска „Pre-Production" в Basecamp — задай я ръчно в Админ → КП-Автоматизация.');
  }

  let column = null;
  if (cfg.columnId) {
    column = (board.columns || []).find((c) => String(c.id) === String(cfg.columnId));
    if (!column) throw new Error(`Зададената колона липсва в дъската „${board.title}" — провери Админ → КП-Автоматизация.`);
  } else {
    column = (board.columns || []).find((c) => /измисляне/i.test(c.title || ''))
      || (board.columns || []).find((c) => !c.isDone);
    if (!column) throw new Error(`Дъската „${board.title}" няма подходяща колона за КП картите.`);
  }

  return {
    projectId: struct.projectId,
    boardId: board.id,
    boardTitle: board.title,
    columnId: column.id,
    columnTitle: column.title,
    doneColumnIds: (board.columns || []).filter((c) => c.isDone).map((c) => String(c.id)),
  };
}

// Existing КП cards in the destination, one Basecamp fetch for ALL clients.
// Returns Map(lowercased client name -> { id, title, url }) for clients that
// already have an active КП card (matched by the title prefix from the template).
async function findExistingKpCards(auth, cfg, dest, clients) {
  const data = await agg.loadBoardCards(auth.token, auth.account, dest.boardId);
  const cards = [];
  for (const col of data.columns || []) {
    const inScope = cfg.checkScope === 'board'
      ? !dest.doneColumnIds.includes(String(col.id))
      : String(col.id) === String(dest.columnId);
    if (!inScope) continue;
    for (const c of [...(col.cards || []), ...(col.onHoldCards || [])]) {
      if (!c.completed) cards.push(c);
    }
  }
  const found = new Map();
  for (const client of clients) {
    const prefix = kpTitlePrefix(cfg, client.name).toLowerCase();
    if (!prefix) continue;
    const hit = cards.find((c) => (c.title || '').trim().toLowerCase().startsWith(prefix));
    if (hit) found.set(client.name.toLowerCase(), { id: hit.id, title: hit.title, url: hit.url });
  }
  return found;
}

// ---------- the shared create flow ----------

/**
 * Create the next КП card for a client (Basecamp or local, per cfg), then advance
 * the client's dates/number. The caller writes its own kp_audit_log entry.
 *
 * @param {object} p
 * @param {object} p.client            kp_clients row
 * @param {string} p.firstPublishDate  'YYYY-MM-DD'
 * @param {object} p.cfg               loadKpConfig() result
 * @param {object} [p.auth]            { token, account } — required when cfg.bcEnabled
 * @param {object} [p.dest]            pre-resolved destination (scheduler batch); else resolved here
 * @param {number} [p.creatorId]       local card creator (user id)
 * @returns {{ title, url?, cardId?, basecamp: boolean, board?, column? }}
 */
async function createKpForClient({ client, firstPublishDate, cfg, auth, dest, creatorId }) {
  const videoCount = client.videos_per_month || cfg.defaultVideos;
  const kpNumber = client.current_kp_number || 1;

  const dist = distributePublishDates(firstPublishDate, videoCount, cfg.calendarWindow);
  const publishDatesBg = dist.dates.map((d) => toBgDate(d));
  const title = renderKpTitle(cfg, client.name, kpNumber);
  const contentText = buildKpContentText(cfg, client, kpNumber, publishDatesBg);

  let result;
  if (cfg.bcEnabled) {
    if (!auth) throw new Error('Няма Basecamp достъп за създаване на КП картата.');
    const d = dest || await resolveKpDestination(auth, cfg);
    // Due date = срокът планът да е готов (X работни дни преди първото видео, с БГ празници).
    const dueOn = cfg.dueDays == null ? undefined : workdays.subtractWorkingDays(firstPublishDate, cfg.dueDays);
    const card = await bc.createCard(auth.token, auth.account, d.projectId, d.columnId, {
      title,
      content: textToBcHtml(contentText),
      due_on: dueOn,
      notify: cfg.notify,
    });
    agg.invalidateBoard(d.boardId); // дашбордът/КП списъкът да видят новата карта веднага
    result = { title: card.title || title, url: bc.normalizeAppUrl(card.app_url), basecamp: true, board: d.boardTitle, column: d.columnTitle };
  } else {
    result = await createLocalKpCard({ client, kpNumber, contentText, firstPublishDate, cfg, creatorId, title });
  }

  // Advance the client to the next КП (same update both paths always did).
  await execute(
    `UPDATE kp_clients SET current_kp_number = $1, first_publish_date = $2, last_video_date = $3, next_kp_date = $4, publish_interval_days = $5, updated_at = NOW() WHERE id = $6`,
    [kpNumber + 1, toDateStr(dist.nextKpFirstDate), toDateStr(dist.lastVideoDate), toDateStr(dist.nextKpFirstDate), Math.round(dist.interval), client.id]
  );

  return result;
}

// The old local-platform card (kept behind kp_bc_enabled = false).
async function createLocalKpCard({ client, kpNumber, contentText, firstPublishDate, cfg, creatorId, title }) {
  let col = null;
  if (cfg.localColumnId) {
    col = await queryOne('SELECT id, board_id FROM columns WHERE id = $1', [cfg.localColumnId]);
  }
  if (!col) {
    col = await queryOne(`SELECT col.id, col.board_id FROM columns col WHERE col.title ILIKE 'Измисляне' LIMIT 1`);
  }
  if (!col) throw new Error('Не е намерена целева колона. Настройте я в Администрация → Настройки → КП Автоматизация.');

  const brainstormDate = toDateStr(subtractWorkingDaysSimple(new Date(firstPublishDate + 'T12:00:00'), cfg.brainstormDays));
  const maxPos = await queryOne('SELECT COALESCE(MAX(position), -1) + 1 as pos FROM cards WHERE column_id = $1', [col.id]);
  const card = await queryOne(
    `INSERT INTO cards (board_id, column_id, title, content, creator_id, client_name, kp_number, position, brainstorm_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [col.board_id, col.id, title, textToHtml(contentText), creatorId, client.name, kpNumber, maxPos.pos, brainstormDate]
  );
  try {
    const { broadcast } = require('../ws/broadcast');
    broadcast({ type: 'card:created', card });
  } catch { /* ws not критично */ }
  return { title, cardId: card.id, basecamp: false };
}

module.exports = {
  KP_DEFAULT_TEMPLATE,
  KP_VIDEO_SECTION_TEMPLATE,
  KP_DEFAULT_TITLE_TEMPLATE,
  loadKpConfig,
  subtractWorkingDaysSimple,
  toDateStr,
  toBgDate,
  distributePublishDates,
  renderKpTitle,
  kpTitlePrefix,
  buildKpContentText,
  textToHtml,
  textToBcHtml,
  resolveKpDestination,
  findExistingKpCards,
  createKpForClient,
};
