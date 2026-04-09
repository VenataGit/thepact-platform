// ==================== DASHBOARD (PRODUCTION BOARD) ====================
// ==================== DASHBOARD (PRODUCTION BOARD) ====================
let expandedDashCol = null;
let collapsedSubCols = JSON.parse(localStorage.getItem('thepact-collapsed-subcols') || '{}');

// Dashboard visibility — board-level + column-level
function getDashHiddenBoards() {
  try { return new Set(JSON.parse(localStorage.getItem('thepact-dash-hidden-boards') || '[]')); } catch { return new Set(); }
}
function saveDashHiddenBoards(set) { localStorage.setItem('thepact-dash-hidden-boards', JSON.stringify([...set])); }
function getDashHiddenCols() {
  try { return new Set(JSON.parse(localStorage.getItem('thepact-dash-hidden-cols') || '[]')); } catch { return new Set(); }
}
function saveDashHiddenCols(set) { localStorage.setItem('thepact-dash-hidden-cols', JSON.stringify([...set])); }
function initDashDefaults(boards) {
  if (localStorage.getItem('thepact-dash-defaults-set')) return;
  // Hide boards named "Задачи" by default
  const hiddenBoards = getDashHiddenBoards();
  boards.forEach(b => { if (b.title.toLowerCase() === 'задачи') hiddenBoards.add(b.id); });
  saveDashHiddenBoards(hiddenBoards);
  localStorage.setItem('thepact-dash-defaults-set', '1');
}

let _dashBoards = [], _dashCards = [], _dashTimers = {};
const _dashStageColors = { 0: 'var(--blue)', 1: 'var(--orange)', 2: '#a78bfa', 3: 'var(--green)' };

async function renderDashboard(el) {
  setBreadcrumb(null);
  el.className = 'full-width';
  try {
    const [boards, cards] = await Promise.all([
      (await fetch('/api/boards')).json(),
      (await fetch('/api/cards')).json()
    ]);
    allBoards = boards;
    // Filter out docs boards from dashboard — they have no cards/columns
    var kanbanBoards = boards.filter(function(b) { return b.type !== 'docs'; });
    _dashBoards = kanbanBoards;
    _dashCards = cards;

    initDashDefaults(kanbanBoards);

    const _nowMidnight = new Date(); _nowMidnight.setHours(0,0,0,0);
    const totalActive = cards.filter(c => !c.completed_at && !c.archived_at).length;
    const totalOnHold = cards.filter(c => c.is_on_hold).length;
    const totalOverdue = cards.filter(c => isCardOverdue(c, _nowMidnight)).length;

    el.innerHTML = '<div class="dash-wrap">' +
      '<div class="dash-stats-bar">' +
        '<div class="dash-stat"><span class="dash-stat__num">' + totalActive + '</span><span class="dash-stat__label">Активни</span></div>' +
        '<div class="dash-stat dash-stat--warn' + (totalOverdue > 0 ? ' dash-stat--clickable' : '') + '" id="dashOverdueStat" onclick="toggleDashOverdueFilter()" title="\u0424\u0438\u043b\u0442\u0440\u0438\u0440\u0430\u0439 \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u0438"><span class="dash-stat__num">' + totalOverdue + '</span><span class="dash-stat__label">\u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u0438</span></div>' +
        '<div class="dash-stat"><span class="dash-stat__num">' + totalOnHold + '</span><span class="dash-stat__label">Изчакване</span></div>' +
        '<div class="dash-stat"><span class="dash-stat__num">' + kanbanBoards.length + '</span><span class="dash-stat__label">Борда</span></div>' +
        '<button class="dash-settings-btn" onclick="showDashSettings()" title="Настройки на Dashboard">⚙ Настройки</button>' +
      '</div>' +
      '<div class="dash-board" id="dashBoard"></div>' +
    '</div>';

    // Load + sync board timers
    try {
      var now = new Date(); now.setHours(0,0,0,0);
      var syncPayload = kanbanBoards.map(function(board) {
        var boardCards = cards.filter(function(c) { return c.board_id === board.id && !c.completed_at && !c.archived_at; });
        var hasOverdue = boardCards.some(function(c) { return isCardOverdueForTimer(c, now); });
        return { board_id: board.id, has_overdue: hasOverdue };
      });
      var timerRes = await fetch('/api/timers/boards/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(syncPayload)
      });
      var timerRows = await timerRes.json();
      _dashTimers = {};
      timerRows.forEach(function(t) { _dashTimers[t.board_id] = t; });
    } catch (e) { console.warn('Timer sync failed', e); }

    renderDashboardBoard(kanbanBoards, cards, _dashStageColors);

    // Start auto-refresh for live dashboard (studio screen mode)
    _dashStartAutoRefresh();
  } catch (err) {
    console.error('Dashboard error:', err);
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка при зареждане</div>';
  }
}

// Live dashboard refresh — re-syncs data, timers, stats, and re-renders board
let _dashAutoRefreshId = null;
async function _dashRefresh() {
  if (dragCardId) return; // never refresh during drag
  try {
    const [boards, cards] = await Promise.all([
      fetch('/api/boards').then(r => r.json()),
      fetch('/api/cards').then(r => r.json())
    ]);
    // Filter out docs boards — they have no cards/columns
    var kanbanBoards = boards.filter(function(b) { return b.type !== 'docs'; });
    _dashBoards = kanbanBoards; _dashCards = cards; allBoards = boards;

    // Re-sync timers with correct overdue status
    var now = new Date(); now.setHours(0,0,0,0);
    var syncPayload = kanbanBoards.map(function(board) {
      var boardCards = cards.filter(function(c) { return c.board_id === board.id && !c.completed_at && !c.archived_at; });
      var hasOverdue = boardCards.some(function(c) { return isCardOverdueForTimer(c, now); });
      return { board_id: board.id, has_overdue: hasOverdue };
    });
    var timerRes = await fetch('/api/timers/boards/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(syncPayload)
    });
    var timerRows = await timerRes.json();
    _dashTimers = {};
    timerRows.forEach(function(t) { _dashTimers[t.board_id] = t; });

    // Update stats bar numbers
    var totalActive = cards.filter(c => !c.completed_at && !c.archived_at).length;
    var totalOverdue = cards.filter(c => isCardOverdue(c, now)).length;
    var totalOnHold = cards.filter(c => c.is_on_hold).length;
    var nums = document.querySelectorAll('.dash-stats-bar .dash-stat__num');
    if (nums[0]) nums[0].textContent = totalActive;
    if (nums[1]) nums[1].textContent = totalOverdue;
    if (nums[2]) nums[2].textContent = totalOnHold;
    if (nums[3]) nums[3].textContent = kanbanBoards.length;
    // Update overdue stat styling
    var overdueEl = document.getElementById('dashOverdueStat');
    if (overdueEl) {
      if (totalOverdue > 0) overdueEl.classList.add('dash-stat--clickable');
      else overdueEl.classList.remove('dash-stat--clickable');
    }

    // Re-render board (cards, colors, timers)
    renderDashboardBoard(kanbanBoards, cards, _dashStageColors);
  } catch (e) { console.warn('Dashboard refresh failed', e); }
}

function _dashStartAutoRefresh() {
  if (_dashAutoRefreshId) clearInterval(_dashAutoRefreshId);
  _dashAutoRefreshId = setInterval(function() {
    // Stop if navigated away from dashboard
    var page = (location.hash.split('/')[1] || '').split('?')[0];
    if (page !== 'dashboard') { clearInterval(_dashAutoRefreshId); _dashAutoRefreshId = null; return; }
    _dashRefresh();
  }, (parseInt(_platformConfig.auto_refresh_seconds || '30')) * 1000);
}

function showDashSettings() {
  document.querySelectorAll('.dash-settings-panel').forEach(p => p.remove());
  const hiddenBoards = getDashHiddenBoards();
  const hiddenCols = getDashHiddenCols();
  const btn = document.querySelector('.dash-settings-btn');
  if (!btn) return;

  const panel = document.createElement('div');
  panel.className = 'dash-settings-panel';

  let html = '<div class="dash-settings-panel__header"><strong>Колони в Dashboard</strong><button onclick="this.closest(\'.dash-settings-panel\').remove()">✕</button></div>';
  html += '<div class="dash-settings-panel__body">';
  _dashBoards.forEach(board => {
    const cols = (board.columns || []).filter(c => !c.is_done_column);
    const boardHidden = hiddenBoards.has(board.id);
    const boardChecked = !boardHidden ? 'checked' : '';
    html += `<label class="dash-settings-board-row">
      <input type="checkbox" ${boardChecked} onchange="toggleDashBoard(${board.id}, this.checked)">
      <span>${esc(board.title)}</span>
    </label>`;
    if (!boardHidden && cols.length) {
      cols.forEach(col => {
        const colChecked = !hiddenCols.has(col.id) ? 'checked' : '';
        html += `<label class="dash-settings-col">
          <input type="checkbox" ${colChecked} onchange="toggleDashColVisibility(${col.id}, this.checked)">
          <span>${esc(col.title)}</span>
        </label>`;
      });
    }
  });
  html += '</div>';
  panel.innerHTML = html;

  const rect = btn.getBoundingClientRect();
  panel.style.cssText = `position:fixed;top:${rect.bottom + 6}px;right:${window.innerWidth - rect.right}px;z-index:1000`;
  document.body.appendChild(panel);
  setTimeout(() => document.addEventListener('click', function h(e) {
    if (!panel.contains(e.target) && e.target !== btn) { panel.remove(); document.removeEventListener('click', h); }
  }), 10);
}

function toggleDashBoard(boardId, visible) {
  const hidden = getDashHiddenBoards();
  if (visible) hidden.delete(boardId); else hidden.add(boardId);
  saveDashHiddenBoards(hidden);
  renderDashboardBoard(_dashBoards, _dashCards, _dashStageColors);
  // Refresh settings panel to show/hide sub-columns
  showDashSettings();
}
function toggleDashColVisibility(colId, visible) {
  const hidden = getDashHiddenCols();
  if (visible) hidden.delete(colId); else hidden.add(colId);
  saveDashHiddenCols(hidden);
  renderDashboardBoard(_dashBoards, _dashCards, _dashStageColors);
}
// Keep old alias for compatibility
function toggleDashCol2(colId, visible) { toggleDashColVisibility(colId, visible); }

function toggleDashOverdueFilter() {
  var stat = document.getElementById('dashOverdueStat');
  if (!stat) return;
  var active = stat.dataset.active === '1';
  active = !active;
  stat.dataset.active = active ? '1' : '';
  stat.style.cssText = active ? 'cursor:pointer;background:rgba(239,68,68,0.18);border-radius:8px;padding:4px 8px;outline:2px solid var(--red)' : 'cursor:pointer';
  document.querySelectorAll('#dashBoard .dash-card').forEach(function(card) {
    var isOver = card.classList.contains('dash-card--overdue') || card.classList.contains('dash-card--today');
    card.style.display = active ? (isOver ? '' : 'none') : '';
  });
  document.querySelectorAll('#dashBoard .dash-subcol').forEach(function(sc) {
    var countEl = sc.querySelector('.dash-subcol-count');
    if (!countEl) return;
    if (active) {
      if (!countEl.dataset.origCount) countEl.dataset.origCount = countEl.textContent;
      var vis = sc.querySelectorAll('.dash-card:not([style*="display: none"]):not([style*="display:none"])').length;
      countEl.textContent = vis + '/' + countEl.dataset.origCount;
    } else if (countEl.dataset.origCount) {
      countEl.textContent = countEl.dataset.origCount;
      delete countEl.dataset.origCount;
    }
  });
}

function renderDashboardBoard(boards, cards, stageColors) {
  const container = document.getElementById('dashBoard');
  if (!container) return;

  var hiddenBoards = getDashHiddenBoards();
  var visibleBoards = boards.filter(function(b) { return !hiddenBoards.has(b.id); });
  container.innerHTML = visibleBoards.map(function(board, bi) {
    var boardCards = cards.filter(function(c) { return c.board_id === board.id && !c.completed_at && !c.archived_at; });
    var totalCards = boardCards.length;
    var isExpanded = expandedDashCol === board.id;
    var isCollapsed = expandedDashCol && expandedDashCol !== board.id;
    var colClass = isExpanded ? 'dash-col expanded' : isCollapsed ? 'dash-col collapsed' : 'dash-col';
    var stageColor = stageColors[bi] || 'var(--accent)';
    var hiddenCols = getDashHiddenCols();
    var visibleCols = (board.columns || []).filter(function(c) { return !c.is_done_column && !hiddenCols.has(c.id); });
    var doneCol = (board.columns || []).find(function(c) { return c.is_done_column; });
    var doneCount = doneCol ? boardCards.filter(function(c) { return c.column_id === doneCol.id; }).length : 0;

    var subColsHtml = '';
    if (!isCollapsed) {
      subColsHtml = visibleCols.map(function(col) {
        var colCards = boardCards.filter(function(c) { return c.column_id === col.id; });
        var regularCards = colCards.filter(function(c) { return !c.is_on_hold; });
        var holdCards = colCards.filter(function(c) { return c.is_on_hold; });
        var subKey = board.id + '::' + col.id;
        var isSubCollapsed = !!collapsedSubCols[subKey];

        if (isSubCollapsed) {
          return '<div class="dash-subcol subcol-collapsed" onclick="toggleDashSubCol(' + board.id + ',' + col.id + ')">' +
            '<div class="dash-subcol-header">' +
              '<span>' + esc(col.title) + '</span>' +
              '<span class="dash-subcol-count">' + colCards.length + '</span>' +
            '</div>' +
          '</div>';
        }

        var _dashDlSort = function(a, b) { var da=getCardDeadlineDate(a),db=getCardDeadlineDate(b); if(!da&&!db)return 0; if(!da)return 1; if(!db)return -1; return da<db?-1:da>db?1:0; };
        regularCards = regularCards.sort(_dashDlSort);
        holdCards = holdCards.sort(_dashDlSort);
        var cardsHtml = regularCards.map(function(c) { return renderDashCard(c); }).join('');

        var holdHtml = '';
        if (holdCards.length > 0) {
          holdHtml = '<div class="dash-on-hold-sep"><span>\u23f8 \u041d\u0430 \u0438\u0437\u0447\u0430\u043a\u0432\u0430\u043d\u0435 (' + holdCards.length + ')</span></div>' +
            holdCards.map(function(c) { return renderDashCard(c); }).join('');
        }

        return '<div class="dash-subcol">' +
          '<div class="dash-subcol-header" onclick="event.stopPropagation();toggleDashSubCol(' + board.id + ',' + col.id + ')" style="cursor:pointer">' +
            '<span>' + esc(col.title) + '</span>' +
            '<span class="dash-subcol-count">' + colCards.length + '</span>' +
          '</div>' +
          '<div class="dash-subcol-cards" data-column-id="' + col.id + '" data-board-id="' + board.id + '" ondragover="handleDashDragOver(event)" ondragleave="handleDashDragLeave(event)" ondrop="handleDashDrop(event)">' + cardsHtml + holdHtml + '</div>' +
        '</div>';
      }).join('');
    }

    // Board-level timer bar
    var boardTimer = _dashTimers[board.id];
    var boardTimerHtml = '';
    if (!isCollapsed) {
      if (boardTimer && boardTimer.is_paused) {
        boardTimerHtml = '<div class="dash-timer-bar dash-timer-bar--overdue">' +
          '<span class="dash-timer-label">\u23f8 \u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u0430 \u0437\u0430\u0434\u0430\u0447\u0430</span>' +
        '</div>';
      } else {
        var sinceVal = boardTimer ? boardTimer.started_at : '';
        boardTimerHtml = '<div class="dash-timer-bar dash-timer-bar--clean" id="dash-timer-' + board.id + '" data-since="' + sinceVal + '">' +
          '<span class="dash-timer-label">\u2705 \u0411\u0435\u0437 \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u0438: </span>' +
          '<span class="dash-timer-value">0\u0434, 0\u0447, 0\u043c, 0\u0441</span>' +
        '</div>';
      }
    }

    return '<div class="' + colClass + '">' +
      '<div class="dash-col-header" onclick="toggleDashCol(' + board.id + ')">' +
        '<span class="dash-col-title">' + esc(board.title) + '</span>' +
        '<span class="dash-col-count">' + totalCards + '</span>' +
      '</div>' +
      boardTimerHtml +
      '<div class="dash-col-body">' + subColsHtml + '</div>' +
    '</div>';
  }).join('');
}

function renderDashCard(card) {
  var colorClass = getDashCardColor(card);
  var dlClass = getDeadlineClass(card);
  var dlDate = getCardDeadlineDate(card);
  var dlDateStr = dlDate ? formatDate(dlDate) : '';
  var assignee = card.assignees && card.assignees[0] ? card.assignees[0].name.split(' ')[0] : '';
  var stepsStr = card.steps_total > 0 ? card.steps_done + '/' + card.steps_total : '';
  var holdClass = card.is_on_hold ? ' dash-card--hold' : '';

  var nowDC = new Date(); nowDC.setHours(0,0,0,0);
  var tomorrowDC = new Date(nowDC); tomorrowDC.setDate(tomorrowDC.getDate() + 1);
  var dueDateDC = _parseDateMidnight(card.due_on);
  var isDCOverdue = dueDateDC && dueDateDC < nowDC && !card.completed_at;
  var isDCToday = dueDateDC && dueDateDC >= nowDC && dueDateDC < tomorrowDC;
  var dueStyle = isDCOverdue ? ' style="color:var(--red);font-weight:600"' : isDCToday ? ' style="color:var(--yellow);font-weight:600"' : '';
  var dueIcon = isDCOverdue ? '\u26a0 ' : isDCToday ? '\u23f0 ' : '\ud83d\udcc5 ';
  var dueStr = card.due_on ? formatDate(card.due_on) : '';

  var priIcon = card.priority === 'urgent' ? '\ud83d\udd34 ' : card.priority === 'high' ? '\u2191 ' : '';
  var dateHtml = dlDateStr
    ? '<span class="dash-card__dl-badge ' + dlClass + '">' + dlDateStr + '</span>'
    : (dueStr ? '<span class="dash-card__date"' + dueStyle + '>' + dueIcon + dueStr + '</span>' : '<span></span>');
  return '<a class="dash-card ' + colorClass + ' ' + dlClass + holdClass + '" href="#/card/' + card.id + '" draggable="true" data-card-id="' + card.id + '" ondragstart="handleDragStart(event)" ondragend="handleDashDragEnd(event)">' +
    '<div class="dash-card__title">' + (card.is_on_hold ? '\u23f8 ' : priIcon) + esc(card.title) + '</div>' +
    '<div class="dash-card__footer">' +
      dateHtml +
      '<div class="dash-card__right">' +
        (stepsStr ? '<span class="dash-card__steps">\u2713 ' + stepsStr + '</span>' : '') +
        (assignee ? '<span class="dash-card__assignee">' + esc(assignee) + '</span>' : '') +
      '</div>' +
    '</div>' +
  '</a>';
}

function getDashCardColor(card) {
  if (card.is_on_hold) return 'dash-card--on-hold';
  if (card.priority === 'urgent') return 'dash-card--priority';
  var ed = getCardEarliestDeadline(card);
  if (!ed) return '';
  var now = new Date(); now.setHours(0,0,0,0);
  var diff = Math.ceil((ed - now) / 86400000);
  if (diff < 0) return 'dash-card--overdue';
  if (diff === 0) return 'dash-card--today';
  if (diff <= parseInt(_platformConfig.deadline_soon_days || '3')) return 'dash-card--soon';
  return 'dash-card--ok';
}

function toggleDashCol(boardId) {
  expandedDashCol = expandedDashCol === boardId ? null : boardId;
  if (_dashBoards.length) { renderDashboardBoard(_dashBoards, _dashCards, _dashStageColors); return; }
  Promise.all([fetch('/api/boards').then(r=>r.json()), fetch('/api/cards').then(r=>r.json())])
    .then(res => {
      var kb = res[0].filter(function(b) { return b.type !== 'docs'; });
      _dashBoards = kb; _dashCards = res[1];
      renderDashboardBoard(kb, res[1], _dashStageColors);
    });
}

function toggleDashSubCol(boardId, colId) {
  var key = boardId + '::' + colId;
  collapsedSubCols[key] = !collapsedSubCols[key];
  if (!collapsedSubCols[key]) delete collapsedSubCols[key];
  localStorage.setItem('thepact-collapsed-subcols', JSON.stringify(collapsedSubCols));
  if (_dashBoards.length) { renderDashboardBoard(_dashBoards, _dashCards, _dashStageColors); return; }
  Promise.all([fetch('/api/boards').then(r=>r.json()), fetch('/api/cards').then(r=>r.json())])
    .then(res => {
      var kb = res[0].filter(function(b) { return b.type !== 'docs'; });
      _dashBoards = kb; _dashCards = res[1];
      renderDashboardBoard(kb, res[1], _dashStageColors);
    });
}

function toggleDashDone(boardId, doneColId) {
  // Could show done cards in a popup, for now just navigate to the board
  location.hash = '#/board/' + boardId;
}

function renderBoardPreview(board, cards) {
  return `
    <div class="board-box-header">
      <div class="board-box-title">${esc(board.title)}</div>
      <div class="board-box-count">${cards.length} карти</div>
    </div>
    <div class="board-box-preview">
      ${board.columns.filter(c => !c.is_done_column).map(col => {
        const cc = cards.filter(c => c.column_id === col.id);
        const h = Math.max(20, Math.min(100, cc.length * 18));
        return `<div class="preview-col" title="${esc(col.title)} (${cc.length})"><div class="preview-bar" style="height:${h}%"></div><span class="preview-count">(${cc.length})</span><span class="preview-label">${esc(col.title)}</span></div>`;
      }).join('')}
    </div>`;
}

