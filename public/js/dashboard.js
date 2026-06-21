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
const _dashCards = {};      // boardId -> { colId -> [cards] }
const _dashLoading = {};    // boardId -> bool
let _dashAutoRefreshId = null;
let _dashDragCardId = null, _dashDragBoardId = null, _dashDragFromCol = null;

function dashBoardTotal(b) { return (b.columns || []).reduce((s, c) => s + (c.cardsCount || 0), 0); }

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
    initDashDefaults(_dashStruct.boards || []);
    dashRenderStats();
    dashRenderBoards();
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
  _dashLoading[boardId] = false; dashRenderBoardSection(boardId);
  dashRenderStats();
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
  const boards = (_dashStruct.boards || []).filter((b) => !hidden.has(String(b.id)));
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
  const cols = (b.columns || []).filter((c) => !hiddenCols.has(String(c.id)));
  const loaded = !!_dashCards[b.id];
  const tag = loaded ? '' : (_dashLoading[b.id] ? ' <span class="bc-mini">зареждам…</span>' : '');
  return '<div class="dash-col" data-board-id="' + b.id + '">' +
    '<div class="dash-col-header"><span class="dash-col-title">' + esc(b.title) + tag + '</span><span class="dash-col-count">' + dashBoardTotal(b) + '</span></div>' +
    '<div class="dash-col-body">' + cols.map((c) => dashSubColHtml(b, c, loaded)).join('') + '</div>' +
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

function renderDashCard(card) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = card.dueOn ? _parseDateMidnight(card.dueOn) : null;
  let colorClass = 'dash-card--ok';
  if (d && !card.completed) {
    const diff = Math.ceil((d - now) / 86400000);
    colorClass = diff < 0 ? 'dash-card--overdue' : diff === 0 ? 'dash-card--today' : diff <= 3 ? 'dash-card--soon' : 'dash-card--ok';
  }
  const assignee = card.assignees && card.assignees[0] ? esc(card.assignees[0].name.split(' ')[0]) : '';
  const steps = card.stepsCount ? '<span class="dash-card__steps">☑ ' + card.stepsCount + '</span>' : '';
  const due = card.dueOn ? '<span class="dash-card__date">' + formatDate(card.dueOn) + '</span>' : '<span></span>';
  return '<div class="dash-card ' + colorClass + (card.completed ? ' dash-card--done' : '') + '" draggable="true" data-card-id="' + card.id + '"' +
      ' ondragstart="dashBcDragStart(event)" ondragend="dashBcDragEnd(event)" title="' + esc(card.title) + '">' +
    '<div class="dash-card__title">' + esc(card.title) + '</div>' +
    '<div class="dash-card__footer">' + due +
      '<div class="dash-card__right">' + steps + (assignee ? '<span class="dash-card__assignee">' + assignee + '</span>' : '') + '</div>' +
    '</div>' +
  '</div>';
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
  let html = '<div class="dash-settings-panel__header"><strong>Какво да се вижда</strong><button onclick="this.closest(\'.dash-settings-panel\').remove()">✕</button></div><div class="dash-settings-panel__body">';
  (_dashStruct.boards || []).forEach((board) => {
    const boardHidden = hiddenBoards.has(String(board.id));
    html += '<label class="dash-settings-board-row"><input type="checkbox" ' + (!boardHidden ? 'checked' : '') + ' onchange="toggleDashBoard(\'' + board.id + '\', this.checked)"><span><b>' + esc(board.title) + '</b></span></label>';
    if (!boardHidden) (board.columns || []).forEach((col) => {
      html += '<label class="dash-settings-col"><input type="checkbox" ' + (!hiddenCols.has(String(col.id)) ? 'checked' : '') + ' onchange="toggleDashColVisibility(\'' + col.id + '\', this.checked)"><span>' + esc(col.title) + ' <span class="bc-mini">(' + (col.cardsCount || 0) + ')</span></span></label>';
    });
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
