// ==================== DASHBOARD — Basecamp-backed ====================
// Landing page after login. Pulls Video Production tasks from Basecamp and groups them by
// board (card table) -> column. Drag a card to another column to move it in Basecamp
// (recorded as the logged-in user). Two-stage load keeps the 300+ card board responsive.

// --- per-browser visibility settings (which boards / columns are shown) ---
function getDashHiddenBoards() { try { return new Set(JSON.parse(localStorage.getItem('thepact-dash-hidden-boards') || '[]')); } catch { return new Set(); } }
function saveDashHiddenBoards(set) { localStorage.setItem('thepact-dash-hidden-boards', JSON.stringify([...set])); }
function getDashHiddenCols() { try { return new Set(JSON.parse(localStorage.getItem('thepact-dash-hidden-cols') || '[]')); } catch { return new Set(); } }
function saveDashHiddenCols(set) { localStorage.setItem('thepact-dash-hidden-cols', JSON.stringify([...set])); }

function initDashDefaults(boards) {
  if (localStorage.getItem('thepact-dash-defaults-bc')) return;
  const hidden = getDashHiddenBoards();
  // Hide the noisier internal boards by default; the team can re-enable them in ⚙ Настройки.
  boards.forEach((b) => { if (/задачи|ops\/admin|услуги извън/i.test(b.title)) hidden.add(String(b.id)); });
  saveDashHiddenBoards(hidden);
  localStorage.setItem('thepact-dash-defaults-bc', '1');
}

let _dashStruct = null;     // { boards: [{ id, title, columns: [{ id, title, cardsCount, isDone }] }] }
let _dashLayout = {};       // global { boardOrder: [ids], colOrder: { boardId: [ids] } } — set by an admin
const _dashCards = {};      // boardId -> { colId -> [cards] }
const _dashLoading = {};    // boardId -> bool
const _dashTimers = {};     // boardId -> { since, paused } — "time since no overdue" timer
let _dashAutoRefreshId = null;
let expandedDashCol = null;   // board id expanded to full width (others collapse)
let _dashDragCardId = null, _dashDragBoardId = null, _dashDragFromCol = null;

function dashBoardTotal(b) { return (b.columns || []).reduce((s, c) => s + (c.cardsCount || 0), 0); }

// Order `items` by a saved array of ids; unlisted items keep their original order at the end.
function applyOrder(items, order) {
  if (!order || !order.length) return items;
  const idx = {}; order.forEach((id, i) => { idx[String(id)] = i; });
  return items.map((it, i) => ({ it, i })).sort((a, b) => {
    const ia = idx[String(a.it.id)], ib = idx[String(b.it.id)];
    const va = ia === undefined ? 1000 + a.i : ia;
    const vb = ib === undefined ? 1000 + b.i : ib;
    return va - vb;
  }).map((x) => x.it);
}

async function renderDashboard(el) {
  setBreadcrumb(null);
  el.className = 'full-width';
  el.innerHTML = '<div class="dash-wrap">' +
    '<div class="dash-stats-bar" id="dashStats"></div>' +
    '<div class="dash-board" id="dashBoard"><div style="padding:40px;color:var(--text-dim)">Зареждам от Basecamp…</div></div>' +
  '</div>';
  await dashLoadStructure();
  dashStartAutoRefresh();
}

async function dashLoadStructure() {
  const host = document.getElementById('dashBoard');
  try {
    const res = await fetch('/api/bc-board');
    if (res.status === 401) { if (host) host.innerHTML = '<div style="padding:40px;color:var(--text-dim)">Сесията изтече. <a href="/login.html">Влез отново</a>.</div>'; return; }
    if (!res.ok) { const e = await res.json().catch(() => ({})); if (host) host.innerHTML = '<div style="padding:40px;color:var(--text-dim)">Грешка: ' + esc(e.error || res.status) + '</div>'; return; }
    _dashStruct = await res.json();
    _dashLayout = _dashStruct.layout || {};
    initDashDefaults(_dashStruct.boards || []);
    dashRenderStats();
    dashRenderBoards();
    dashLoadTimers();
    const hidden = getDashHiddenBoards();
    const visible = (_dashStruct.boards || []).filter((b) => !hidden.has(String(b.id)));
    visible.sort((a, b) => dashBoardTotal(a) - dashBoardTotal(b)); // light boards fill in first
    dashLoadBoardsLimited(visible.map((b) => b.id), 1);
  } catch { if (host) host.innerHTML = '<div style="padding:40px;color:var(--text-dim)">Няма връзка със сървъра.</div>'; }
}

// Load boards' cards with limited concurrency so Basecamp calls stay under the rate limit.
async function dashLoadBoardsLimited(ids, limit) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, ids.length || 1) }, async () => {
    while (i < ids.length) { await dashLoadBoardCards(ids[i++]); }
  });
  await Promise.all(workers);
}

async function dashLoadBoardCards(boardId) {
  _dashLoading[boardId] = true; dashRenderBoardSection(boardId);
  try {
    const res = await fetch('/api/bc-board/cards?board=' + encodeURIComponent(boardId));
    if (!res.ok) throw new Error('cards');
    const data = await res.json();
    const byCol = {}; (data.columns || []).forEach((c) => { byCol[c.id] = c.cards || []; });
    _dashCards[boardId] = byCol;
  } catch { /* leave unloaded — user can press ⚙ / reload */ }
  _dashLoading[boardId] = false;
  await dashSyncBoardTimer(boardId);
  dashRenderBoardSection(boardId);
  dashRenderStats();
}

// --- per-board "time since no overdue task" timer ------------------------------
// Backend: board_overdue_timers via /api/timers/boards (GET) + /sync (POST).
// The 1s ticker in sos.js updates any .dash-timer-bar--clean[data-since] live.
async function dashLoadTimers() {
  try {
    const res = await fetch('/api/timers/boards');
    if (!res.ok) return;
    const rows = await res.json();
    (rows || []).forEach((r) => { _dashTimers[String(r.board_id)] = { since: r.started_at, paused: r.is_paused }; });
    dashRenderBoards();
  } catch { /* table may not exist yet — degrade silently (no bars) */ }
}

// After a board's cards load, tell the server whether it currently has an overdue
// card; the server pauses/resumes the timer and returns the fresh state.
async function dashSyncBoardTimer(boardId) {
  if (!_dashCards[boardId]) return;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let hasOverdue = false;
  Object.values(_dashCards[boardId]).forEach((cards) => cards.forEach((c) => {
    const d = c.dueOn ? _parseDateMidnight(c.dueOn) : null;
    if (d && d < now && !c.completed) hasOverdue = true;
  }));
  try {
    const res = await fetch('/api/timers/boards/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ board_id: boardId, has_overdue: hasOverdue }]),
    });
    if (!res.ok) return;
    const rows = await res.json();
    (rows || []).forEach((r) => { _dashTimers[String(r.board_id)] = { since: r.started_at, paused: r.is_paused }; });
  } catch { /* degrade silently */ }
}

function _dashFmtElapsed(since) {
  let diff = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
  if (!isFinite(diff) || diff < 0) diff = 0;
  const days = Math.floor(diff / 86400), hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60), secs = diff % 60;
  return days + 'д, ' + hours + 'ч, ' + mins + 'м, ' + secs + 'с';
}

function dashBoardTimerHtml(b) {
  const t = _dashTimers[String(b.id)];
  if (!t) return '';
  if (t.paused) {
    return '<div class="dash-timer-bar dash-timer-bar--overdue"><span class="dash-timer-label">⚠ Има просрочена задача</span></div>';
  }
  return '<div class="dash-timer-bar dash-timer-bar--clean" data-since="' + esc(String(t.since)) + '">' +
    '<span class="dash-timer-label">Без просрочена: </span>' +
    '<span class="dash-timer-value">' + _dashFmtElapsed(t.since) + '</span>' +
  '</div>';
}

function dashRenderStats() {
  const stats = document.getElementById('dashStats');
  if (!stats || !_dashStruct) return;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let overdue = 0;
  Object.keys(_dashCards).forEach((bid) => {
    Object.values(_dashCards[bid]).forEach((cards) => cards.forEach((c) => {
      const d = c.dueOn ? _parseDateMidnight(c.dueOn) : null;
      if (d && d < now && !c.completed) overdue++;
    }));
  });
  const total = (_dashStruct.boards || []).reduce((s, b) => s + dashBoardTotal(b), 0);
  const hidden = getDashHiddenBoards();
  const visibleBoards = (_dashStruct.boards || []).filter((b) => !hidden.has(String(b.id))).length;
  stats.innerHTML =
    '<div class="dash-stat"><span class="dash-stat__num">' + total + '</span><span class="dash-stat__label">Задачи</span></div>' +
    '<div class="dash-stat dash-stat--warn"><span class="dash-stat__num">' + overdue + '</span><span class="dash-stat__label">Просрочени</span></div>' +
    '<div class="dash-stat"><span class="dash-stat__num">' + visibleBoards + '</span><span class="dash-stat__label">Дъски</span></div>' +
    '<button class="dash-settings-btn" onclick="showDashSettings()" title="Настройки на Dashboard">⚙ Настройки</button>';
}

function dashRenderBoards() {
  const container = document.getElementById('dashBoard');
  if (!container || !_dashStruct) return;
  const hidden = getDashHiddenBoards();
  let boards = (_dashStruct.boards || []).filter((b) => !hidden.has(String(b.id)));
  boards = applyOrder(boards, _dashLayout.boardOrder);
  if (!boards.length) { container.innerHTML = '<div style="padding:40px;color:var(--text-dim)">Няма видими дъски. Виж ⚙ Настройки.</div>'; return; }
  container.innerHTML = boards.map(dashBoardSectionHtml).join('');
}

function dashRenderBoardSection(boardId) {
  const sec = document.querySelector('.dash-col[data-board-id="' + boardId + '"]');
  if (!sec || !_dashStruct) { dashRenderBoards(); return; }
  const b = (_dashStruct.boards || []).find((x) => String(x.id) === String(boardId));
  if (b) sec.outerHTML = dashBoardSectionHtml(b);
}

function dashBoardSectionHtml(b) {
  const hiddenCols = getDashHiddenCols();
  let cols = (b.columns || []).filter((c) => !hiddenCols.has(String(c.id)));
  cols = applyOrder(cols, (_dashLayout.colOrder || {})[String(b.id)]);
  const loaded = !!_dashCards[b.id];
  const tag = loaded ? '' : (_dashLoading[b.id] ? ' <span class="bc-mini">зареждам…</span>' : '');
  const isExpanded = expandedDashCol === String(b.id);
  const isCollapsed = expandedDashCol && expandedDashCol !== String(b.id);
  const colClass = isExpanded ? 'dash-col expanded' : isCollapsed ? 'dash-col collapsed' : 'dash-col';
  const body = isCollapsed ? '' : ('<div class="dash-col-body">' + cols.map((c) => dashSubColHtml(b, c, loaded)).join('') + '</div>');
  return '<div class="' + colClass + '" data-board-id="' + b.id + '">' +
    '<div class="dash-col-header" onclick="toggleDashCol(\'' + b.id + '\')" title="Цъкни за цял екран"><span class="dash-col-title">' + esc(b.title) + tag + '</span><span class="dash-col-count">' + dashBoardTotal(b) + '</span></div>' +
    dashBoardTimerHtml(b) +
    body +
  '</div>';
}

function dashSubColHtml(board, col, loaded) {
  const cards = ((_dashCards[board.id] || {})[col.id] || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  const count = loaded ? cards.length : (col.cardsCount || 0);
  const body = loaded
    ? (cards.map(renderDashCard).join('') || '<div class="dash-subcol-empty"></div>')
    : '<div class="bc-col-skel">' + Array(Math.min(col.cardsCount || 0, 4)).fill('<div class="bc-skel"></div>').join('') + '</div>';
  return '<div class="dash-subcol">' +
    '<div class="dash-subcol-header"><span>' + esc(col.title) + '</span><span class="dash-subcol-count">' + count + '</span></div>' +
    '<div class="dash-subcol-cards" data-column-id="' + col.id + '" data-board-id="' + board.id + '" ondragover="dashBcDragOver(event)" ondragleave="dashBcDragLeave(event)" ondrop="dashBcDrop(event)">' + body + '</div>' +
  '</div>';
}

// Inline icons (stroke=currentColor → inherit the date's deadline color / button color).
var DASH_CAL_SVG   = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>';
var DASH_CLOCK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3 2"/></svg>';

function renderDashCard(card) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = card.dueOn ? _parseDateMidnight(card.dueOn) : null;
  let colorClass = 'dash-card--none'; // no due date (or completed) → neutral grey
  if (d && !card.completed) {
    const diff = Math.ceil((d - now) / 86400000);
    colorClass = diff < 0 ? 'dash-card--overdue' : diff === 0 ? 'dash-card--today' : diff <= 3 ? 'dash-card--soon' : 'dash-card--ok';
  }
  const assignee = card.assignees && card.assignees[0] ? esc(card.assignees[0].name.split(' ')[0]) : '';
  const due = card.dueOn ? '<div class="dash-card__date">' + DASH_CAL_SVG + '<span>' + formatDate(card.dueOn) + '</span></div>' : '';
  return '<div class="dash-card ' + colorClass + (card.completed ? ' dash-card--done' : '') + '" draggable="true" data-card-id="' + card.id + '" data-url="' + esc(card.url || '') + '"' +
      ' ondragstart="dashBcDragStart(event)" ondragend="dashBcDragEnd(event)" onclick="dashOpenCard(event, this)" title="' + esc(card.title) + ' — отвори в Basecamp">' +
    '<div class="dash-card__title">' + esc(card.title) + '</div>' +
    due +
    '<div class="dash-card__actions">' +
      '<button class="dash-card__timer" onclick="dashCardTimer(event, \'' + card.id + '\')" title="Следене на времето">' + DASH_CLOCK_SVG + '</button>' +
      (assignee ? '<span class="dash-card__assignee">' + assignee + '</span>' : '') +
    '</div>' +
  '</div>';
}

// Time-tracking button — placeholder for now; the tracking mechanics come later.
function dashCardTimer(e, cardId) {
  e.stopPropagation(); // don't open the card in Basecamp
  e.preventDefault();
  if (typeof showToast === 'function') showToast('Следене на времето — скоро 🕐', 'info');
}

// --- drag & drop: move a card to another column of the SAME board, in Basecamp ---
function dashBcDragStart(e) {
  const card = e.target.closest('.dash-card');
  _dashDragCardId = card.dataset.cardId;
  const zone = card.closest('.dash-subcol-cards');
  _dashDragBoardId = zone && zone.dataset.boardId;
  _dashDragFromCol = zone && zone.dataset.columnId;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function dashBcDragEnd(e) {
  const c = e.target.closest('.dash-card'); if (c) c.classList.remove('dragging');
  document.querySelectorAll('.dash-subcol-cards.drag-over').forEach((n) => n.classList.remove('drag-over'));
  _dashDragCardId = null;
}
function dashBcDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function dashBcDragLeave(e) { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over'); }
async function dashBcDrop(e) {
  e.preventDefault();
  const zone = e.currentTarget; zone.classList.remove('drag-over');
  if (!_dashDragCardId) return;
  const targetCol = zone.dataset.columnId, targetBoard = zone.dataset.boardId;
  const cardId = _dashDragCardId, fromCol = _dashDragFromCol;
  _dashDragCardId = null;
  if (targetBoard !== _dashDragBoardId) { if (window.showToast) showToast('Местене между различни дъски още не се поддържа.', 'warn'); return; }
  if (targetCol === fromCol) return;
  const cardEl = document.querySelector('.dash-card[data-card-id="' + cardId + '"]');
  if (cardEl) zone.appendChild(cardEl); // optimistic
  try {
    const res = await fetch('/api/bc-board/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardTableId: Number(targetBoard), cardId: Number(cardId), targetColumnId: Number(targetCol), position: 0 }),
    });
    if (!res.ok) throw new Error('move');
    if (window.showToast) showToast('Преместено в Basecamp ✓', 'success');
    setTimeout(() => dashLoadBoardCards(targetBoard), 900); // reconcile just this board
  } catch {
    if (window.showToast) showToast('Грешка при местене — връщам.', 'error');
    dashLoadBoardCards(targetBoard);
  }
}

// --- settings panel: choose which boards/columns are visible ---
function showDashSettings() {
  document.querySelectorAll('.dash-settings-panel').forEach((p) => p.remove());
  if (!_dashStruct) return;
  const hiddenBoards = getDashHiddenBoards(), hiddenCols = getDashHiddenCols();
  const btn = document.querySelector('.dash-settings-btn'); if (!btn) return;
  const panel = document.createElement('div'); panel.className = 'dash-settings-panel';
  const isAdmin = !!(window.currentUser && currentUser.role === 'admin');
  let html = '<div class="dash-settings-panel__header"><strong>Какво да се вижда</strong><button onclick="this.closest(\'.dash-settings-panel\').remove()">✕</button></div>';
  if (isAdmin) html += '<div class="dash-set-note">Стрелките ↑↓ подреждат за <b>всички</b> (ти си админ).</div>';
  html += '<div class="dash-settings-panel__body">';
  const sBoards = applyOrder((_dashStruct.boards || []).slice(), _dashLayout.boardOrder);
  sBoards.forEach((board) => {
    const boardHidden = hiddenBoards.has(String(board.id));
    const bArrows = isAdmin ? '<span class="dash-arrows"><button title="Нагоре" onclick="dashMoveBoard(\'' + board.id + '\',-1)">↑</button><button title="Надолу" onclick="dashMoveBoard(\'' + board.id + '\',1)">↓</button></span>' : '';
    html += '<div class="dash-set-row"><label class="dash-settings-board-row"><input type="checkbox" ' + (!boardHidden ? 'checked' : '') + ' onchange="toggleDashBoard(\'' + board.id + '\', this.checked)"><span><b>' + esc(board.title) + '</b></span></label>' + bArrows + '</div>';
    if (!boardHidden) {
      const sCols = applyOrder((board.columns || []).slice(), (_dashLayout.colOrder || {})[String(board.id)]);
      sCols.forEach((col) => {
        const cArrows = isAdmin ? '<span class="dash-arrows"><button title="Нагоре" onclick="dashMoveCol(\'' + board.id + '\',\'' + col.id + '\',-1)">↑</button><button title="Надолу" onclick="dashMoveCol(\'' + board.id + '\',\'' + col.id + '\',1)">↓</button></span>' : '';
        html += '<div class="dash-set-row dash-set-row--col"><label class="dash-settings-col"><input type="checkbox" ' + (!hiddenCols.has(String(col.id)) ? 'checked' : '') + ' onchange="toggleDashColVisibility(\'' + col.id + '\', this.checked)"><span>' + esc(col.title) + ' <span class="bc-mini">(' + (col.cardsCount || 0) + ')</span></span></label>' + cArrows + '</div>';
      });
    }
  });
  html += '</div>'; panel.innerHTML = html;
  const rect = btn.getBoundingClientRect();
  panel.style.cssText = 'position:fixed;top:' + (rect.bottom + 6) + 'px;right:' + (window.innerWidth - rect.right) + 'px;z-index:1000';
  document.body.appendChild(panel);
  setTimeout(() => document.addEventListener('click', function h(ev) {
    if (!panel.contains(ev.target) && ev.target !== btn) { panel.remove(); document.removeEventListener('click', h); }
  }), 10);
}
function toggleDashBoard(boardId, visible) {
  const hidden = getDashHiddenBoards(); if (visible) hidden.delete(String(boardId)); else hidden.add(String(boardId)); saveDashHiddenBoards(hidden);
  dashRenderStats(); dashRenderBoards();
  if (visible && !_dashCards[boardId]) dashLoadBoardCards(boardId);
  showDashSettings();
}
function toggleDashColVisibility(colId, visible) {
  const hidden = getDashHiddenCols(); if (visible) hidden.delete(String(colId)); else hidden.add(String(colId)); saveDashHiddenCols(hidden);
  dashRenderBoards();
}

// Expand a board to full width (the rest collapse); click its header to toggle.
function toggleDashCol(boardId) {
  expandedDashCol = (expandedDashCol === String(boardId)) ? null : String(boardId);
  dashRenderBoards();
}

// Open a card on its own page in Basecamp, in a new tab.
function dashOpenCard(e, el) {
  const url = el.getAttribute('data-url');
  if (url) window.open(url, '_blank', 'noopener');
}

// --- admin-only GLOBAL ordering (saved on the server, applies to everyone) ---
function dashMoveBoard(boardId, dir) {
  const all = (_dashStruct.boards || []).map((b) => String(b.id));
  let order = (_dashLayout.boardOrder && _dashLayout.boardOrder.length) ? _dashLayout.boardOrder.map(String) : all.slice();
  all.forEach((id) => { if (!order.includes(id)) order.push(id); });
  order = order.filter((id) => all.includes(id));
  const i = order.indexOf(String(boardId)), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  const t = order[i]; order[i] = order[j]; order[j] = t;
  _dashLayout.boardOrder = order;
  dashSaveLayout(); dashRenderBoards(); showDashSettings();
}
function dashMoveCol(boardId, colId, dir) {
  const board = (_dashStruct.boards || []).find((b) => String(b.id) === String(boardId));
  if (!board) return;
  const all = (board.columns || []).map((c) => String(c.id));
  _dashLayout.colOrder = _dashLayout.colOrder || {};
  let order = (_dashLayout.colOrder[String(boardId)] && _dashLayout.colOrder[String(boardId)].length) ? _dashLayout.colOrder[String(boardId)].map(String) : all.slice();
  all.forEach((id) => { if (!order.includes(id)) order.push(id); });
  order = order.filter((id) => all.includes(id));
  const i = order.indexOf(String(colId)), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  const t = order[i]; order[i] = order[j]; order[j] = t;
  _dashLayout.colOrder[String(boardId)] = order;
  dashSaveLayout(); dashRenderBoardSection(boardId); showDashSettings();
}
async function dashSaveLayout() {
  try {
    await fetch('/api/bc-board/layout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layout: _dashLayout }) });
  } catch { /* non-admins get 403 — ignore */ }
}

function dashStartAutoRefresh() {
  if (_dashAutoRefreshId) clearInterval(_dashAutoRefreshId);
  _dashAutoRefreshId = setInterval(function () {
    const page = (location.hash.split('/')[1] || '').split('?')[0];
    if (page !== 'dashboard') { clearInterval(_dashAutoRefreshId); _dashAutoRefreshId = null; return; }
    if (_dashDragCardId) return; // never refresh mid-drag
    const hidden = getDashHiddenBoards();
    const visible = (_dashStruct ? _dashStruct.boards : []).filter((b) => !hidden.has(String(b.id)));
    dashLoadBoardsLimited(visible.map((b) => b.id), 1);
  }, 60000);
}

// Kept for compatibility — kanban.js calls this after a local-board move.
async function _dashRefresh() {
  if (location.hash.indexOf('#/dashboard') !== 0) return;
  await dashLoadStructure();
}
