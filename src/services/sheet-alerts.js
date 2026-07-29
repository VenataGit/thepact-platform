// Google Sheets → Basecamp „Известия от таблица".
//
// Клиентът Re/Shape не работи в Basecamp — постинг планът им е Google Sheets.
// Apps Script в самата таблица (инсталируем onEdit/onChange тригер) вика
// POST /webhooks/sheet/:secret при всяка редакция. Скриптът е нарочно „тъп" —
// праща заглавния ред + променените клетки и нищо не решава. Цялата логика
// (кои колони са важни, кое е заглавието на видеото) е тук, за да се променя
// от Настройки, без никой да пипа скрипта в чуждата таблица.
//
// Една нишка = едно видео (ред). Първата важна промяна отваря съобщение в
// Message Board-а, всяка следваща коментира под него — както при Календар
// известията. Абонати са само избраните отговорници, никой друг от проекта.
//
// Известията се трупат за няколко секунди преди публикуване (sheet_alerts_delay):
// докато човек попълва реда клетка по клетка, тригерът гърми на всяка от тях, а
// в Basecamp трябва да излезе ЕДНО обобщено известие. Буферът е в паметта —
// рестарт на сървъра губи най-много последните секунди непубликувани промени.
const crypto = require('crypto');
const { query, queryOne, execute } = require('../db/pool');
const bc = require('./basecamp');
const team = require('./bc-team');
const { getServiceAuth } = require('./basecamp-token');

const TZ = 'Europe/Sofia';
const escHtml = team.escHtml;
const mentionOf = team.mentionOf;

const MAX_CHANGES = 60;     // на едно повикване — защита от масов paste
const MAX_TEXT = 300;       // подрязване на стойностите в известието
const KEEP_EVENTS = 500;    // колко последни събития пазим за админ панела

// ---------- настройки ----------

function splitList(v) {
  return String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

async function loadConfig() {
  const rows = await query("SELECT key, value FROM settings WHERE key LIKE 'sheet_alerts_%'");
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    enabled: s.sheet_alerts_enabled === 'true',
    secret: s.sheet_alerts_secret || '',
    project: parseInt(s.sheet_alerts_bc_project) || null,
    board: parseInt(s.sheet_alerts_bc_board) || null,
    boardUrl: s.sheet_alerts_bc_board_url || '',
    important: splitList(s.sheet_alerts_important),
    titleCols: splitList(s.sheet_alerts_title_cols),
    allChanges: s.sheet_alerts_all_changes === 'true',
    delay: Math.min(600, Math.max(0, parseInt(s.sheet_alerts_delay, 10) || 0)),
  };
}

const saveSetting = (key, value) => execute(
  `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
   ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
  [key, String(value)]
);

// Тайната живее в базата (не в .env), за да може да се вижда и върти от панела.
async function ensureSecret() {
  const row = await queryOne("SELECT value FROM settings WHERE key = 'sheet_alerts_secret'");
  if (row && row.value) return row.value;
  const secret = crypto.randomBytes(24).toString('hex');
  await saveSetting('sheet_alerts_secret', secret);
  return secret;
}

async function rotateSecret() {
  const secret = crypto.randomBytes(24).toString('hex');
  await saveSetting('sheet_alerts_secret', secret);
  return secret;
}

// ---------- нормализация ----------

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

function trunc(s) {
  const v = String(s == null ? '' : s).trim();
  return v.length > MAX_TEXT ? v.slice(0, MAX_TEXT) + '…' : v;
}

// Чекбоксите в Sheets идват като "TRUE"/"FALSE" — в известието искаме човешки текст.
function pretty(v) {
  const s = trunc(v);
  if (/^true$/i.test(s)) return 'ДА ✅';
  if (/^false$/i.test(s)) return 'не';
  return s;
}

function matchesAny(header, needles) {
  const h = norm(header);
  if (!h) return false;
  return needles.some((n) => h.includes(n));
}

// Заглавие на видеото: първата колона, чието име съвпада с sheet_alerts_title_cols;
// ако е празна — първата непразна клетка от реда; иначе просто номерът на реда.
function rowTitle(headers, values, row, titleCols) {
  for (let i = 0; i < headers.length; i++) {
    if (matchesAny(headers[i], titleCols)) {
      const v = trunc(values[i]);
      if (v) return v;
    }
  }
  const first = (values || []).map(trunc).find(Boolean);
  return first || `Ред ${row}`;
}

// Ключът е по ИМЕ, не по номер на ред: вмъкването на ред размества номерата.
function threadKeyOf(title, row) {
  const n = norm(title);
  return n || `row:${row}`;
}

function rowUrl(p) {
  if (!p.spreadsheetId) return '';
  const base = `https://docs.google.com/spreadsheets/d/${p.spreadsheetId}/edit`;
  const gid = (p.gid || p.gid === 0) ? `#gid=${p.gid}` : '';
  if (!p.row) return base + gid;
  return base + (gid ? `${gid}&range=A${p.row}` : `#range=A${p.row}`);
}

// ---------- вход от Apps Script ----------

// Привежда суровия payload към нещо, на което може да се вярва (типове + тавани).
function sanitize(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    kind: String(p.kind || 'edit'),
    spreadsheetId: String(p.spreadsheetId || '').slice(0, 120),
    spreadsheetName: trunc(p.spreadsheetName),
    spreadsheetUrl: String(p.spreadsheetUrl || '').slice(0, 500),
    sheetName: trunc(p.sheetName) || 'Без име',
    gid: Number.isFinite(Number(p.gid)) ? Number(p.gid) : null,
    row: parseInt(p.row, 10) || 0,
    headers: arr(p.headers).slice(0, 100).map((h) => trunc(h)),
    rowValues: arr(p.rowValues).slice(0, 100).map((v) => trunc(v)),
    editor: trunc(p.editor),
    changes: arr(p.changes).slice(0, MAX_CHANGES).map((c) => ({
      col: parseInt(c && c.col, 10) || 0,
      old: trunc(c && c.old),
      new: trunc(c && c.new),
    })).filter((c) => c.col > 0),
  };
}

// Главният вход: викa се от /webhooks/sheet/:secret.
// Винаги логва (за да се вижда в панела, че връзката работи), публикува само
// ако известията са включени и има какво да се каже.
async function handleHit(raw) {
  const cfg = await loadConfig();
  const p = sanitize(raw);

  if (p.kind === 'setup') {
    await logEvent(p, { header: '— връзката е инсталирана —', old: '', new: '', important: false }, false);
    return { ok: true, kind: 'setup' };
  }

  if (p.kind === 'new_sheet') {
    await logEvent(p, { header: '— нов шийт —', old: '', new: p.sheetName, important: true }, cfg.enabled);
    if (cfg.enabled) await postNewSheet(cfg, p).catch((e) => console.error('[sheet-alerts] new sheet:', e.message));
    return { ok: true, kind: 'new_sheet' };
  }

  if (!p.changes.length || p.row <= 1) return { ok: true, skipped: true };

  const title = rowTitle(p.headers, p.rowValues, p.row, cfg.titleCols);
  const changes = [];
  for (const c of p.changes) {
    const header = p.headers[c.col - 1] || `Колона ${c.col}`;
    // Празно → празно (Sheets праща и такива при клик) не е промяна.
    if (norm(c.old) === norm(c.new)) continue;
    changes.push({ header, old: c.old, new: c.new, important: matchesAny(header, cfg.important) });
  }
  if (!changes.length) return { ok: true, skipped: true };

  const notable = cfg.allChanges ? changes : changes.filter((c) => c.important);
  const willPost = cfg.enabled && notable.length > 0;
  for (const c of changes) await logEvent({ ...p, title }, c, willPost && notable.includes(c));

  if (!willPost) return { ok: true, logged: changes.length, posted: false };

  buffer(cfg, { ...p, title }, notable);
  return { ok: true, logged: changes.length, posted: true };
}

async function logEvent(p, c, posted) {
  await execute(
    `INSERT INTO sheet_alert_events
       (spreadsheet_id, sheet_name, row_num, title, column_name, old_value, new_value, editor_email, important, posted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [p.spreadsheetId, p.sheetName, p.row || null, p.title || '', c.header,
     c.old, c.new, p.editor, !!c.important, !!posted]
  );
  await execute(
    `DELETE FROM sheet_alert_events
     WHERE id <= (SELECT MAX(id) FROM sheet_alert_events) - $1`,
    [KEEP_EVENTS]
  ).catch(() => { /* без значение е, ако не успее */ });
}

// ---------- буфер (обобщаване) ----------

const pending = new Map();

function bufferKey(p) {
  return `${p.spreadsheetId}|${p.sheetName}|${threadKeyOf(p.title, p.row)}`;
}

// Прозорецът се задава при ПЪРВАТА промяна и не се удължава — иначе човек,
// който пипа реда непрекъснато, би отложил известието безкрайно.
function buffer(cfg, p, changes) {
  const key = bufferKey(p);
  const entry = pending.get(key);
  if (entry) {
    for (const c of changes) {
      const prev = entry.changes.find((x) => x.header === c.header);
      if (prev) prev.new = c.new;            // пази се първоначалното „беше"
      else entry.changes.push(c);
    }
    entry.p = { ...p, rowValues: p.rowValues };
    return;
  }
  const fresh = { p, changes: changes.slice(), timer: null };
  pending.set(key, fresh);
  const ms = Math.max(0, cfg.delay) * 1000;
  fresh.timer = setTimeout(() => { flush(key); }, ms);
  if (fresh.timer.unref) fresh.timer.unref();
}

async function flush(key) {
  const entry = pending.get(key);
  pending.delete(key);
  if (!entry) return;
  try {
    await postChanges(entry.p, entry.changes);
  } catch (err) {
    console.error('[sheet-alerts] post failed:', err.message);
  }
}

// ---------- Basecamp ----------

let _botPersonId = null;
async function getBotPersonId(auth) {
  if (_botPersonId) return _botPersonId;
  try {
    const me = await bc.getMyProfile(auth.token, auth.account);
    if (me && me.id) _botPersonId = Number(me.id);
  } catch (err) {
    console.warn('[sheet-alerts] bot profile failed:', err.message);
  }
  return _botPersonId;
}

async function responsiblePeople() {
  return query(
    `SELECT p.* FROM sheet_alert_responsibles r JOIN bc_people p ON p.person_id = r.bc_person_id
     WHERE p.active = TRUE ORDER BY p.name`
  );
}

function changeLines(changes) {
  return changes.map((c) => {
    const was = c.old ? ` <em>(беше: ${escHtml(pretty(c.old))})</em>` : '';
    return `${c.important ? '⭐' : '•'} <strong>${escHtml(c.header)}:</strong> ${escHtml(pretty(c.new) || '—')}${was}`;
  });
}

function contextLines(p) {
  const lines = [];
  const name = p.spreadsheetName || 'Google Sheets';
  const link = p.spreadsheetUrl || rowUrl(p);
  lines.push(`📄 Таблица: ${link ? `<a href="${escHtml(link)}">${escHtml(name)}</a>` : `<strong>${escHtml(name)}</strong>`}`);
  lines.push(`🗂 Шийт: <strong>${escHtml(p.sheetName)}</strong>${p.row ? ` · ред ${p.row}` : ''}`);
  return lines;
}

async function postChanges(p, changes) {
  const cfg = await loadConfig();
  if (!cfg.enabled || !cfg.project || !cfg.board) return;
  await team.ensureFresh().catch(() => { /* кешът може да е стар, не е фатално */ });

  const auth = await getServiceAuth();
  const people = await responsiblePeople();
  const mentions = people.map((x) => mentionOf(x)).join(' ');
  const key = threadKeyOf(p.title, p.row);

  const thread = await queryOne(
    'SELECT * FROM sheet_alert_threads WHERE spreadsheet_id = $1 AND sheet_name = $2 AND row_key = $3',
    [p.spreadsheetId, p.sheetName, key]
  );

  const rowLink = rowUrl(p);
  const body = changeLines(changes);

  if (thread && thread.bc_message_id) {
    const lines = [];
    if (mentions) lines.push(mentions);
    lines.push(...body);
    if (p.editor) lines.push(`<em>Промяната е от: ${escHtml(p.editor)}</em>`);
    if (rowLink) lines.push(`<a href="${escHtml(rowLink)}">Отвори реда в таблицата</a>`);
    await bc.createComment(
      auth.token, auth.account, thread.bc_project_id || cfg.project, thread.bc_message_id,
      `<div>${lines.join('<br>')}</div>`
    );
    await execute(
      'UPDATE sheet_alert_threads SET title = $2, last_row = $3, updated_at = NOW() WHERE id = $1',
      [thread.id, p.title, p.row || null]
    );
    console.log(`[sheet-alerts] comment on ${thread.bc_message_id} — "${p.title}" (${changes.length} промени)`);
    return;
  }

  const lines = [...contextLines(p), ''];
  lines.push(...body);
  lines.push('');
  if (p.editor) lines.push(`✍️ Промяната е от: ${escHtml(p.editor)}`);
  if (mentions) lines.push(`👥 ${mentions}`);
  if (rowLink) { lines.push(''); lines.push(`<a href="${escHtml(rowLink)}">Отвори реда в таблицата</a>`); }

  let subs = [...new Set(people.filter((x) => x && x.person_id).map((x) => Number(x.person_id)))];
  if (!subs.length) {
    const botId = await getBotPersonId(auth);
    if (botId) subs = [botId];
  }

  const message = await bc.createMessage(auth.token, auth.account, cfg.project, cfg.board, {
    subject: `📊 ${p.title} — ${p.sheetName}`,
    content: `<div>${lines.join('<br>')}</div>`,
    subscriptions: subs,
  });

  await execute(
    `INSERT INTO sheet_alert_threads
       (spreadsheet_id, sheet_name, row_key, title, last_row, bc_message_id, bc_project_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (spreadsheet_id, sheet_name, row_key)
     DO UPDATE SET bc_message_id = $6, bc_project_id = $7, title = $4, last_row = $5, updated_at = NOW()`,
    [p.spreadsheetId, p.sheetName, key, p.title, p.row || null, message.id, cfg.project]
  );
  console.log(`[sheet-alerts] posted "${p.title}" (message ${message.id}, notified ${subs.length})`);
}

// Нов шийт в таблицата — само уведомяваме, че се е появил (без нишка по ред).
async function postNewSheet(cfg, p) {
  if (!cfg.project || !cfg.board) return;
  await team.ensureFresh().catch(() => {});
  const auth = await getServiceAuth();
  const people = await responsiblePeople();
  const mentions = people.map((x) => mentionOf(x)).join(' ');
  const link = p.spreadsheetUrl || rowUrl(p);

  const lines = [`🗂 Нов шийт: <strong>${escHtml(p.sheetName)}</strong>`];
  lines.push(`📄 Таблица: ${link ? `<a href="${escHtml(link)}">${escHtml(p.spreadsheetName || 'Google Sheets')}</a>` : escHtml(p.spreadsheetName || '')}`);
  if (p.editor) lines.push(`✍️ Създаден от: ${escHtml(p.editor)}`);
  if (mentions) lines.push(`👥 ${mentions}`);

  let subs = [...new Set(people.filter((x) => x && x.person_id).map((x) => Number(x.person_id)))];
  if (!subs.length) {
    const botId = await getBotPersonId(auth);
    if (botId) subs = [botId];
  }
  await bc.createMessage(auth.token, auth.account, cfg.project, cfg.board, {
    subject: `🗂 Нов шийт: ${p.sheetName}`,
    content: `<div>${lines.join('<br>')}</div>`,
    subscriptions: subs,
  });
}

// Тестово съобщение от панела. Абонат е само ботът → никой не получава известие.
async function postTestMessage() {
  const cfg = await loadConfig();
  if (!cfg.project || !cfg.board) throw new Error('Не е зададен Message Board.');
  const auth = await getServiceAuth();
  const botId = await getBotPersonId(auth);
  const now = new Intl.DateTimeFormat('bg-BG', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  return bc.createMessage(auth.token, auth.account, cfg.project, cfg.board, {
    subject: '🔧 Тест: Известия от таблица',
    content: `<div>Връзката Google Sheets → Basecamp работи. Изпратено от платформата на ${escHtml(now)}. Това съобщение може да се изтрие.</div>`,
    subscriptions: botId ? [botId] : [],
  });
}

// ---------- Apps Script за таблицата ----------

// Скриптът се показва в панела за копиране. Нарочно не съдържа никаква логика:
// праща заглавния ред + променените клетки, а сървърът решава останалото — така
// смяна на настройка не изисква пипане на скрипта в таблицата на клиента.
function appsScriptCode(secret, origin) {
  const url = `${origin || 'https://thepact.pro'}/webhooks/sheet/${secret || 'ТАЙНА'}`;
  return `/**
 * The Pact — известия от таблицата към Basecamp.
 *
 * Инсталиране (веднъж):
 *   1) Разширения → Apps Script
 *   2) Изтрий каквото е вътре и постави този код
 *   3) Избери функцията pactSetup и натисни Run — одобри достъпа
 *   4) Готово. За изключване: пусни функцията pactOff.
 */
var PACT_URL = '${url}';

function pactSetup() {
  var ss = SpreadsheetApp.getActive();
  pactOff();
  ScriptApp.newTrigger('pactOnEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('pactOnChange').forSpreadsheet(ss).onChange().create();
  pactPost({ kind: 'setup' });
  try { SpreadsheetApp.getUi().alert('Готово — известията към The Pact са включени.'); } catch (err) {}
}

function pactOff() {
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    var fn = all[i].getHandlerFunction();
    if (fn === 'pactOnEdit' || fn === 'pactOnChange') ScriptApp.deleteTrigger(all[i]);
  }
}

function pactOnEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    var rows = e.range.getNumRows();
    var cols = e.range.getNumColumns();
    if (rows * cols > 200) return;
    var headers = pactHeaders(sh);
    var single = (rows === 1 && cols === 1);
    var values = single ? null : e.range.getDisplayValues();
    var editor = pactEditor(e);

    for (var r = 0; r < rows; r++) {
      var row = e.range.getRow() + r;
      if (row <= 1) continue;
      var changes = [];
      for (var c = 0; c < cols; c++) {
        var col = e.range.getColumn() + c;
        var nv = single ? e.range.getDisplayValue() : values[r][c];
        var ov = (single && e.oldValue !== undefined && e.oldValue !== null) ? e.oldValue : '';
        changes.push({ col: col, old: String(ov), new: String(nv == null ? '' : nv) });
      }
      pactPost({
        kind: 'edit',
        sheetName: sh.getName(),
        gid: sh.getSheetId(),
        row: row,
        headers: headers,
        rowValues: pactRow(sh, row, headers.length),
        changes: changes,
        editor: editor
      });
    }
  } catch (err) {
    console.error('pactOnEdit: ' + err);
  }
}

function pactOnChange(e) {
  try {
    if (!e || e.changeType !== 'INSERT_GRID') return;
    var sh = SpreadsheetApp.getActive().getActiveSheet();
    pactPost({ kind: 'new_sheet', sheetName: sh.getName(), gid: sh.getSheetId(), editor: pactEditor(e) });
  } catch (err) {
    console.error('pactOnChange: ' + err);
  }
}

function pactHeaders(sh) {
  var last = sh.getLastColumn();
  if (last < 1) return [];
  return sh.getRange(1, 1, 1, last).getDisplayValues()[0];
}

function pactRow(sh, row, n) {
  var last = Math.max(n, sh.getLastColumn());
  if (last < 1 || row > sh.getMaxRows()) return [];
  return sh.getRange(row, 1, 1, last).getDisplayValues()[0];
}

function pactEditor(e) {
  try { return (e && e.user && e.user.getEmail()) || ''; } catch (err) { return ''; }
}

function pactPost(data) {
  var ss = SpreadsheetApp.getActive();
  data.v = 1;
  data.spreadsheetId = ss.getId();
  data.spreadsheetName = ss.getName();
  data.spreadsheetUrl = ss.getUrl();
  UrlFetchApp.fetch(PACT_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(data),
    muteHttpExceptions: true
  });
}
`;
}

module.exports = {
  loadConfig,
  ensureSecret,
  rotateSecret,
  handleHit,
  postTestMessage,
  appsScriptCode,
  // за тестове
  rowTitle,
  threadKeyOf,
  matchesAny,
  sanitize,
  pretty,
  rowUrl,
};
