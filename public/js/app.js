// ThePact Platform — Basecamp Clone (v3)
let currentUser = null, ws = null, wsReconnectDelay = 1000;
let allUsers = [], allBoards = [], allProjects = [];
let onlineUsers = new Set();
let pendingShortcut = null, typingTimeout = null;

// ==================== AUTH ====================
async function checkAuth() {
  try {
    const res = await fetch('/auth/status');
    if (!res.ok) throw new Error();
    currentUser = (await res.json()).user;
    document.getElementById('navAvatar').textContent = initials(currentUser.name);
    try { allUsers = await (await fetch('/api/users/team')).json(); } catch {}
    try { allBoards = await (await fetch('/api/boards')).json(); } catch {}
    updateHeyBadge();
    return true;
  } catch { window.location.href = '/login.html'; return false; }
}
function canManage() { return currentUser?.role === 'admin' || currentUser?.role === 'moderator'; }
async function logout() { await fetch('/auth/logout', { method: 'POST' }); window.location.href = '/login.html'; }
function initials(name) { return name?.split(' ').map(n => n[0]).join('').substring(0, 2) || '?'; }

async function updateHeyBadge() {
  try {
    const { count } = await (await fetch('/api/notifications/unread-count')).json();
    const b = document.getElementById('heyBadge');
    if (count > 0) { b.textContent = count; b.style.display = ''; } else b.style.display = 'none';
  } catch {}
}

// ==================== NAV DROPDOWNS ====================
let openDropdownId = null;
function toggleDropdown(id, btn) {
  closeAllDropdowns();
  const dd = document.getElementById(id);
  if (openDropdownId === id) { openDropdownId = null; return; }
  // Populate content
  if (id === 'heyDropdown') populateHey(dd);
  else if (id === 'myStuffDropdown') populateMyStuff(dd);
  else if (id === 'findDropdown') populateFind(dd);
  dd.classList.add('open');
  openDropdownId = id;
  setTimeout(() => document.addEventListener('click', closeAllDropdowns, { once: true }), 10);
}
function closeAllDropdowns() {
  document.querySelectorAll('.nav-dropdown.open').forEach(d => d.classList.remove('open'));
  openDropdownId = null;
}

async function populateHey(el) {
  try {
    const items = await (await fetch('/api/notifications')).json();
    fetch('/api/notifications/read-all', { method: 'PUT' }); updateHeyBadge();
    el.innerHTML = items.length === 0
      ? '<div class="nav-dropdown__empty">Няма нищо ново за теб.</div>'
      : `<div class="nav-dropdown__section"><div class="nav-dropdown__title">Известия</div></div>` +
        items.slice(0, 15).map(n => `
          <a class="hey-item ${n.is_read ? '' : 'unread'}" href="${n.reference_type === 'card' ? `#/card/${n.reference_id}` : '#'}" onclick="closeAllDropdowns()">
            <div class="hey-item__body">
              ${n.type === 'mentioned' ? '<span class="hey-item__type">@спомена те в:</span>' : n.type === 'assigned' ? '<span class="hey-item__type" style="background:var(--blue)">Възложено:</span>' : ''}
              <div class="hey-item__title">${esc(n.body || n.title)}</div>
              <div class="hey-item__meta">${timeAgo(n.created_at)}</div>
            </div>
          </a>
        `).join('') + '<a class="hey-item" href="#/notifications" onclick="closeAllDropdowns()"><div class="hey-item__body" style="text-align:center;color:var(--accent)">Виж всички известия...</div></a>';
  } catch { el.innerHTML = '<div class="nav-dropdown__empty">Грешка</div>'; }
}

function populateMyStuff(el) {
  el.innerHTML = `
    <div class="nav-dropdown__section">
      <a class="nav-dropdown__item" href="#/mystuff" onclick="closeAllDropdowns()"><div class="item-icon" style="background:var(--green-dim);color:var(--green)">✓</div> Моите задачи</a>
      <a class="nav-dropdown__item" href="#/bookmarks" onclick="closeAllDropdowns()"><div class="item-icon" style="background:var(--accent-dim);color:var(--accent)">⚑</div> Отметки</a>
      <a class="nav-dropdown__item" href="#/schedule" onclick="closeAllDropdowns()"><div class="item-icon" style="background:var(--blue-dim);color:var(--blue)">📅</div> Моят график</a>
      <a class="nav-dropdown__item" href="#/activity" onclick="closeAllDropdowns()"><div class="item-icon" style="background:var(--bg-hover);color:var(--text-dim)">◷</div> Последна активност</a>
      <a class="nav-dropdown__item" href="#/reports" onclick="closeAllDropdowns()"><div class="item-icon" style="background:var(--red-dim);color:var(--red)">📊</div> Отчети</a>
    </div>
    ${currentUser?.role === 'admin' ? `<div class="nav-dropdown__section" style="border-top:1px solid var(--border)">
      <a class="nav-dropdown__item" href="#/admin" onclick="closeAllDropdowns()"><div class="item-icon" style="background:var(--bg-hover);color:var(--text-dim)">⚙️</div> Админ панел</a>
    </div>` : ''}
  `;
}

function populateFind(el) {
  el.innerHTML = `
    <div class="search-overlay" onclick="event.stopPropagation()">
      <input type="search" id="globalSearchInput" placeholder="Търси..." autofocus oninput="doGlobalSearch()">
      <div class="search-filters">
        <select id="searchType"><option value="">Навсякъде</option><option value="card">Карти</option><option value="comment">Коментари</option><option value="message">Съобщения</option></select>
        <select id="searchPerson"><option value="">от Всеки</option>${allUsers.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
        <select id="searchProject"><option value="">Във всички проекти</option>${allBoards.map(b => `<option value="${b.id}">${esc(b.title)}</option>`).join('')}</select>
      </div>
      <div class="search-results" id="searchResults"></div>
    </div>
  `;
  setTimeout(() => document.getElementById('globalSearchInput')?.focus(), 50);
}

async function doGlobalSearch() {
  const q = document.getElementById('globalSearchInput')?.value?.trim();
  const container = document.getElementById('searchResults');
  if (!q || q.length < 2) { container.innerHTML = ''; return; }
  try {
    const boardFilter = document.getElementById('searchProject')?.value || '';
    const { cards, users } = await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
    let filteredCards = cards;
    if (boardFilter) filteredCards = cards.filter(c => c.board_id === parseInt(boardFilter));
    container.innerHTML =
      filteredCards.map(c => `<a class="nav-dropdown__item" href="#/card/${c.id}" onclick="closeAllDropdowns()">${esc(c.title)}<span style="margin-left:auto;font-size:11px;color:var(--text-dim)">${esc(c.board_title)}</span></a>`).join('') +
      users.map(u => `<div class="nav-dropdown__item">${esc(u.name)} <span style="margin-left:auto;font-size:11px;color:var(--text-dim)">${u.role}</span></div>`).join('') +
      (filteredCards.length === 0 && users.length === 0 ? '<div class="nav-dropdown__empty">Няма резултати</div>' : '');
  } catch {}
}

// ==================== ROUTER ====================
function router() {
  const hash = location.hash || '#/home';
  const parts = hash.split('?')[0].replace('#/', '').split('/');
  const page = parts[0] || 'home';
  const id = parts[1] ? parseInt(parts[1]) : null;
  const sub = parts[2] || null;

  // Highlight active nav
  document.querySelectorAll('.nav__link').forEach(el => el.classList.remove('active'));
  const activeNav = document.querySelector(`[data-nav="${page}"]`) || document.querySelector(`[data-nav="home"]`);
  if (activeNav) activeNav.classList.add('active');

  const el = document.getElementById('pageContent');
  closeAllDropdowns();

  // Reset card edit mode when navigating away from card page
  if (page !== 'card') _cardEditMode = false;

  switch (page) {
    case 'home': return renderHome(el);
    case 'project': return renderProject(el, id);
    case 'videoproduction': return renderProject(el, 1);
    case 'dashboard': return renderDashboard(el);
    case 'board': return id ? renderBoard(el, id) : renderHome(el);
    case 'card':
      if (sub === 'new') return renderCardCreate(el);
      return id ? renderCardPage(el, id) : renderHome(el);
    case 'activity': return renderActivity(el);
    case 'mystuff': return renderMyStuff(el);
    case 'chat': return id ? renderChatChannel(el, id) : renderChatList(el);
    case 'notifications': return renderNotifications(el);
    case 'messages': return renderMessageBoard(el);
    case 'vault': return renderVault(el, id);
    case 'campfire': return renderCampfire(el, id || 1);
    case 'schedule': return renderSchedule(el);
    case 'checkins': return renderCheckins(el);
    case 'admin': return renderAdmin(el);
    case 'reports': return renderReports(el);
    case 'bookmarks': return renderBookmarks(el);
    default: return renderHome(el);
  }
}
window.addEventListener('hashchange', router);

function setBreadcrumb(items) {
  const bar = document.getElementById('breadcrumbBar');
  const bc = document.getElementById('breadcrumb');
  const main = document.getElementById('mainArea');
  if (!items?.length) { bar.classList.add('hidden'); main.classList.remove('with-breadcrumb'); return; }
  bar.classList.remove('hidden'); main.classList.add('with-breadcrumb');
  bc.innerHTML = items.map((item, i) => {
    if (i === items.length - 1) return `<span class="current">${esc(item.label)}</span>`;
    return `<a href="${item.href}">${esc(item.label)}</a><span class="sep">›</span>`;
  }).join('');
}

// ==================== HOME ====================
async function renderHome(el) {
  setBreadcrumb(null);
  el.className = '';
  try {
    const [cards, boards] = await Promise.all([
      (await fetch('/api/cards')).json(),
      (await fetch('/api/boards')).json()
    ]);
    allBoards = boards;
    const myCards = cards.filter(c => c.assignees?.some(a => a.id === currentUser.id));

    // Team avatars with colors
    const avatarColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
    const teamAvatars = allUsers.slice(0, 10).map((u, i) => `<div style="width:36px;height:36px;border-radius:50%;background:${avatarColors[i % avatarColors.length]};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;border:2px solid var(--bg);margin-left:${i > 0 ? '-6px' : '0'};position:relative;z-index:${10-i}">${initials(u.name)}</div>`).join('');

    el.innerHTML = `
      <div style="max-width:600px;margin:0 auto">
        <div class="page-header" style="margin-bottom:16px">
          <img src="/img/logo-white.svg" alt="The Pact" style="height:48px;margin-bottom:12px">
        </div>

        <div class="projects-home-grid">
          <a href="#/videoproduction" class="project-card-home">
            <div class="project-card-home__above">ThePact Tasks</div>
            <div class="project-card-home__title">Video Production</div>
          </a>
          <a href="#/dashboard" class="project-card-home">
            <div class="project-card-home__above">ThePact Tasks</div>
            <div class="project-card-home__title">Dashboard</div>
          </a>
        </div>

      </div>
    `;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

function renderMiniCalendar() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = now.getDate();
  const monthName = now.toLocaleDateString('bg', { month: 'long' });
  const dayNames = ['НД','ПН','ВТ','СР','ЧТ','ПТ','СБ'];

  let cells = '';
  for (let i = 0; i < firstDay; i++) cells += '<td></td>';
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today;
    cells += `<td style="${isToday ? 'background:var(--accent);color:#000;border-radius:4px;font-weight:700' : 'color:var(--text-secondary)'}">${d}</td>`;
    if ((firstDay + d) % 7 === 0) cells += '</tr><tr>';
  }

  return `
    <div style="text-align:center;margin-bottom:8px;font-weight:600;color:var(--text)">${monthName}</div>
    <table style="width:100%;text-align:center;font-size:12px;border-collapse:collapse">
      <tr>${dayNames.map(d => `<th style="padding:4px;color:var(--text-dim);font-weight:500;font-size:10px">${d}</th>`).join('')}</tr>
      <tr>${cells}</tr>
    </table>
  `;
}

// ==================== DASHBOARD (PRODUCTION BOARD) ====================
let expandedDashCol = null;
let collapsedSubCols = JSON.parse(localStorage.getItem('thepact-collapsed-subcols') || '{}');

async function renderDashboard(el) {
  setBreadcrumb([{ label: 'Home', href: '#/home' }, { label: 'Dashboard', href: '#/dashboard' }]);
  el.className = 'full-width';
  try {
    const [boards, cards] = await Promise.all([
      (await fetch('/api/boards')).json(),
      (await fetch('/api/cards')).json()
    ]);
    allBoards = boards;

    const stageColors = {
      0: 'var(--blue)',
      1: 'var(--orange)',
      2: '#a78bfa',
      3: 'var(--green)'
    };

    // Quick stats
    const totalActive = cards.filter(c => !c.completed_at && !c.archived_at).length;
    const totalOnHold = cards.filter(c => c.is_on_hold).length;
    const totalOverdue = cards.filter(c => c.due_on && !c.is_on_hold && !c.completed_at && new Date(c.due_on) < new Date()).length;

    el.innerHTML = '<div class="dash-wrap">' +
      '<div class="dash-stats-bar">' +
        '<div class="dash-stat"><span class="dash-stat__num">' + totalActive + '</span><span class="dash-stat__label">Активни</span></div>' +
        '<div class="dash-stat dash-stat--warn"><span class="dash-stat__num">' + totalOverdue + '</span><span class="dash-stat__label">Просрочени</span></div>' +
        '<div class="dash-stat"><span class="dash-stat__num">' + totalOnHold + '</span><span class="dash-stat__label">Изчакване</span></div>' +
        '<div class="dash-stat"><span class="dash-stat__num">' + boards.length + '</span><span class="dash-stat__label">Борда</span></div>' +
      '</div>' +
      '<div class="dash-board" id="dashBoard"></div>' +
    '</div>';

    renderDashboardBoard(boards, cards, stageColors);
  } catch (err) {
    console.error('Dashboard error:', err);
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка при зареждане</div>';
  }
}

function renderDashboardBoard(boards, cards, stageColors) {
  const container = document.getElementById('dashBoard');
  if (!container) return;

  container.innerHTML = boards.map(function(board, bi) {
    var boardCards = cards.filter(function(c) { return c.board_id === board.id && !c.completed_at && !c.archived_at; });
    var totalCards = boardCards.length;
    var isExpanded = expandedDashCol === board.id;
    var isCollapsed = expandedDashCol && expandedDashCol !== board.id;
    var colClass = isExpanded ? 'dash-col expanded' : isCollapsed ? 'dash-col collapsed' : 'dash-col';
    var stageColor = stageColors[bi] || 'var(--accent)';
    var visibleCols = (board.columns || []).filter(function(c) { return !c.is_done_column; });
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

        var cardsHtml = regularCards.map(function(c) { return renderDashCard(c); }).join('');

        var holdHtml = '';
        if (holdCards.length > 0) {
          holdHtml = '<div class="dash-on-hold-sep"><span>\u23f8 On Hold (' + holdCards.length + ')</span></div>' +
            holdCards.map(function(c) { return renderDashCard(c); }).join('');
        }

        return '<div class="dash-subcol">' +
          '<div class="dash-subcol-header" onclick="event.stopPropagation();toggleDashSubCol(' + board.id + ',' + col.id + ')" style="cursor:pointer">' +
            '<span>' + esc(col.title) + '</span>' +
            '<span class="dash-subcol-count">' + colCards.length + '</span>' +
          '</div>' +
          '<div class="dash-subcol-cards">' + cardsHtml + holdHtml + '</div>' +
        '</div>';
      }).join('');
    }

    return '<div class="' + colClass + '" style="border-top-color:' + stageColor + '">' +
      '<div class="dash-col-header" onclick="toggleDashCol(' + board.id + ')">' +
        '<span class="dash-col-title">' + esc(board.title) + '</span>' +
        '<span class="dash-col-count">' + totalCards + '</span>' +
      '</div>' +
      '<div class="dash-col-body">' + subColsHtml + '</div>' +
      (doneCol && !isCollapsed ? '<div class="dash-done-footer" onclick="toggleDashDone(' + board.id + ',' + doneCol.id + ')">\u2705 Готово (' + doneCount + ')</div>' : '') +
    '</div>';
  }).join('');
}

function renderDashCard(card) {
  var colorClass = getDashCardColor(card);
  var dueStr = card.due_on ? formatDate(card.due_on) : '';
  var assignee = card.assignees && card.assignees[0] ? card.assignees[0].name.split(' ')[0] : '';
  var stepsStr = card.steps_total > 0 ? card.steps_done + '/' + card.steps_total : '';
  var holdClass = card.is_on_hold ? ' dash-card--hold' : '';

  return '<a class="dash-card ' + colorClass + holdClass + '" href="#/card/' + card.id + '">' +
    '<div class="dash-card__title">' + (card.is_on_hold ? '\u23f8 ' : '') + esc(card.title) + '</div>' +
    '<div class="dash-card__footer">' +
      (dueStr ? '<span class="dash-card__date">\ud83d\udcc5 ' + dueStr + '</span>' : '<span></span>') +
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
  if (!card.due_on) return '';
  var now = new Date(); now.setHours(0,0,0,0);
  var due = new Date(card.due_on); due.setHours(0,0,0,0);
  var diff = Math.ceil((due - now) / 86400000);
  if (diff < 0) return 'dash-card--overdue';
  if (diff === 0) return 'dash-card--today';
  if (diff <= 3) return 'dash-card--soon';
  return 'dash-card--ok';
}

function toggleDashCol(boardId) {
  expandedDashCol = expandedDashCol === boardId ? null : boardId;
  // Re-render
  var stageColors = { 0: 'var(--blue)', 1: 'var(--orange)', 2: '#a78bfa', 3: 'var(--green)' };
  Promise.all([
    fetch('/api/boards').then(function(r) { return r.json(); }),
    fetch('/api/cards').then(function(r) { return r.json(); })
  ]).then(function(res) { renderDashboardBoard(res[0], res[1], stageColors); });
}

function toggleDashSubCol(boardId, colId) {
  var key = boardId + '::' + colId;
  collapsedSubCols[key] = !collapsedSubCols[key];
  if (!collapsedSubCols[key]) delete collapsedSubCols[key];
  localStorage.setItem('thepact-collapsed-subcols', JSON.stringify(collapsedSubCols));
  var stageColors = { 0: 'var(--blue)', 1: 'var(--orange)', 2: '#a78bfa', 3: 'var(--green)' };
  Promise.all([
    fetch('/api/boards').then(function(r) { return r.json(); }),
    fetch('/api/cards').then(function(r) { return r.json(); })
  ]).then(function(res) { renderDashboardBoard(res[0], res[1], stageColors); });
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

// ==================== PROJECT PAGE ====================
async function renderProject(el, projectId) {
  setBreadcrumb(null);
  el.className = 'wide';
  try {
    const [boards, cards] = await Promise.all([
      (await fetch('/api/boards')).json(),
      (await fetch('/api/cards')).json()
    ]);
    allBoards = boards;

    el.innerHTML = `
      <div class="page-header" style="margin-bottom:16px">
        <img src="/img/logo-white.svg" alt="The Pact" style="height:40px;margin-bottom:8px">
        <div style="font-size:13px;color:var(--text-dim)">Video Production</div>
      </div>

      <div class="projects-home-grid" style="grid-template-columns:repeat(3, 1fr);max-width:900px">
        ${boards.map((board, bi) => {
          const bc = cards.filter(c => c.board_id === board.id);
          const activeCards = bc.filter(c => !c.is_on_hold);
          return '<a href="#/board/' + board.id + '" class="project-card-home">' +
            '<div class="project-card-home__above">' + esc(board.title) + '</div>' +
            '<div class="project-card-home__title" style="font-size:18px;margin-bottom:8px">' + activeCards.length + ' карти</div>' +
          '</a>';
        }).join('')}

        <a href="#/campfire/1" class="project-card-home">
          <div class="project-card-home__above">Campfire</div>
          <div class="project-card-home__title" style="font-size:18px">🔥 Чат</div>
        </a>

        <a href="#/schedule" class="project-card-home">
          <div class="project-card-home__above">График</div>
          <div class="project-card-home__title" style="font-size:18px">📅 Събития</div>
        </a>

        <a href="#/checkins" class="project-card-home">
          <div class="project-card-home__above">Check-ins</div>
          <div class="project-card-home__title" style="font-size:18px">✋ Въпроси</div>
        </a>

        <a href="#/chat" class="project-card-home">
          <div class="project-card-home__above">Pings</div>
          <div class="project-card-home__title" style="font-size:18px">💬 Съобщения</div>
        </a>

        <a href="#/messages" class="project-card-home">
          <div class="project-card-home__above">Известия</div>
          <div class="project-card-home__title" style="font-size:18px">📢 Борд</div>
        </a>

        <a href="#/vault" class="project-card-home">
          <div class="project-card-home__above">Документи</div>
          <div class="project-card-home__title" style="font-size:18px">📁 Файлове</div>
        </a>

        ${canManage() ? `
        <div class="project-card-home" style="cursor:pointer;border-style:dashed;opacity:0.5" onclick="promptCreateBoard()">
          <div class="project-card-home__title" style="font-size:18px">+ Добави</div>
        </div>` : ''}
      </div>

      <div style="margin-top:48px;max-width:700px;margin-left:auto;margin-right:auto">
        <h2 style="text-align:center;font-size:16px;font-weight:700;color:#fff;margin-bottom:20px">Активност по проекта</h2>
        <div id="projectActivity" style="color:var(--text-dim);text-align:center;padding:20px">Зареждане...</div>
      </div>
    `;
    // Load project activity
    loadProjectActivity();
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

async function loadProjectActivity() {
  try {
    const items = await (await fetch('/api/activity?limit=20')).json();
    const container = document.getElementById('projectActivity');
    if (!container) return;
    const avatarColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
    const getAC = (name) => avatarColors[(name||'').length % avatarColors.length];
    container.innerHTML = items.length === 0
      ? '<div style="color:var(--text-dim)">Няма активност все още</div>'
      : items.map(a => `
          <div class="activity-entry" style="text-align:left">
            <div class="activity-avatar" style="background:${getAC(a.user_name)};width:28px;height:28px;font-size:10px">${initials(a.user_name || '')}</div>
            <div class="activity-body">
              <div class="activity-text"><strong>${esc(a.user_name || '')}</strong> ${a.action === 'created' ? 'създаде' : a.action === 'commented' ? 'коментира' : a.action === 'moved' ? 'премести' : a.action === 'completed' ? 'завърши' : a.action === 'checked_off' ? 'отметна стъпка на' : a.action} ${a.target_type === 'card' ? `<a href="#/card/${a.target_id}">${esc(a.target_title || '')}</a>` : esc(a.target_title || '')}</div>
              <div class="activity-meta">${timeAgo(a.created_at)}</div>
            </div>
          </div>
        `).join('');
  } catch {}
}

async function promptCreateBoard() {
  const title = prompt('Име на нов борд:');
  if (!title?.trim()) return;
  try { await fetch('/api/boards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }) }); router(); } catch {}
}

// ==================== BOARD (CARD TABLE) ====================
async function renderBoard(el, boardId) {
  el.className = 'full-width';
  const COLUMN_COLORS = ['#f97316','#3b82f6','#14b8a6','#a855f7','#22c55e','#eab308','#ec4899','#06b6d4','#ef4444','#8b5cf6'];
  try {
    const [boards, cards] = await Promise.all([
      (await fetch('/api/boards')).json(),
      (await fetch(`/api/cards?board_id=${boardId}`)).json()
    ]);
    allBoards = boards;
    const board = boards.find(b => b.id === boardId);
    if (!board) { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Бордът не е намерен</div>'; return; }

    setBreadcrumb([
      { label: 'Video Production', href: '#/project/1' },
      { label: board.title, href: `#/board/${boardId}` }
    ]);

    const manage = canManage();
    const visibleCols = board.columns.filter(c => !c.is_done_column);
    const doneCol = board.columns.find(c => c.is_done_column);
    const doneCards = doneCol ? cards.filter(c => c.column_id === doneCol.id) : [];
    const wColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308'];

    el.innerHTML = `
      <div class="board-page-header">
        <h1 class="board-page-header__title">${esc(board.title)}</h1>
        <div class="board-page-header__actions">
          <div class="board-page-header__watchers">
            <div class="board-page-header__watcher-avatars">
              ${allUsers.slice(0,6).map((u,i) => `<div class="board-page-header__watcher-av" style="background:${wColors[i%wColors.length]}" title="${esc(u.name)}">${initials(u.name)}</div>`).join('')}
            </div>
          </div>
          ${manage ? `<a class="btn btn-sm" href="#/card/0/new?board=${boardId}">+ Нова карта</a>` : ''}
          ${manage ? `<button class="btn btn-sm btn-ghost" onclick="promptAddColumn(${boardId})">+ Колона</button>` : ''}
          <button class="btn btn-sm btn-ghost" onclick="toggleBoardMenu(event, ${boardId})">⋯</button>
        </div>
      </div>

      <div class="board-kanban">
        ${visibleCols.map((col, i) => {
          const colColor = COLUMN_COLORS[i % COLUMN_COLORS.length];
          const colCards = cards.filter(c => c.column_id === col.id && !c.is_on_hold);
          const holdCards = cards.filter(c => c.column_id === col.id && c.is_on_hold);
          return `
            <div class="kanban-column" data-col-id="${col.id}" style="--col-color:${colColor}">
              <div class="kanban-column__inner">
                <div class="column-header">
                  <div class="column-title-wrap">
                    <span class="column-title-dot"></span>
                    <h2 class="column-title-link">
                      <span ${manage ? `ondblclick="editColumnTitle(${boardId}, ${col.id}, this)"` : ''}>${esc(col.title)}</span>
                      <span class="col-count">${colCards.length + holdCards.length}</span>
                    </h2>
                  </div>
                  <div class="column-header-right">
                    ${manage ? `<button class="col-menu-btn" onclick="showColMenu(event, ${boardId}, ${col.id})">⋮</button>` : ''}
                  </div>
                </div>
                <div class="column-cards" data-column-id="${col.id}" data-board-id="${boardId}"
                     ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
                  ${colCards.map(c => renderKanbanCard(c, colColor)).join('')}
                </div>
                ${holdCards.length > 0 ? `
                  <div class="on-hold-section">
                    <div class="on-hold-label">ИЗЧАКВАНЕ (${holdCards.length})</div>
                    <div class="column-cards" data-column-id="${col.id}" data-board-id="${boardId}"
                         ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
                      ${holdCards.map(c => renderKanbanCard(c, colColor)).join('')}
                    </div>
                  </div>` : ''}
                ${manage ? `<a class="add-card-btn" href="#/card/0/new?board=${boardId}&column=${col.id}">+ Добави карта</a>` : ''}
              </div>
            </div>`;
        }).join('')}

        ${doneCol ? `
        <div class="kanban-sidebar">
          <div class="kanban-sidebar-tab done-tab" onclick='showDoneCards(${JSON.stringify(doneCards.map(c=>({id:c.id,title:c.title,completed_at:c.completed_at})))}, ${boardId})'>
            <span class="sidebar-count">(${doneCards.length})</span>
            <span class="sidebar-label">ГОТОВО</span>
          </div>
        </div>` : ''}
      </div>
    `;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

function renderKanbanCard(card, colColor) {
  const color = getCardColorClass(card);
  const dueStr = card.due_on ? formatDate(card.due_on) : '';
  const stepsStr = card.steps_total > 0 ? `${card.steps_done}/${card.steps_total}` : '';
  const avColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
  const getAC = n => avColors[(n||'').length % avColors.length];

  const assignees = card.assignees || [];
  const shown = assignees.slice(0, 4);
  const extra = assignees.length - shown.length;
  const avatarsHtml = assignees.length
    ? shown.map(a => `<div class="kanban-card__av" style="background:${getAC(a.name)}" title="${esc(a.name)}">${initials(a.name)}</div>`).join('')
      + (extra > 0 ? `<div class="kanban-card__av kanban-card__av--more">+${extra}</div>` : '')
    : `<div class="kanban-card__av kanban-card__av--empty">–</div>`;

  return `
    <a class="kanban-card ${color}" href="#/card/${card.id}" draggable="true" data-card-id="${card.id}"
       ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)"
       onauxclick="if(event.button===1){event.preventDefault();window.open('#/card/${card.id}','_blank')}">
      <div class="kanban-card__content">
        <h3 class="kanban-card__title">${esc(card.title)}</h3>
        <div class="kanban-card__footer">
          <div class="kanban-card__avatars">${avatarsHtml}</div>
          <div class="kanban-card__badges">
            ${card.client_name ? `<span class="kanban-card__client">${esc(card.client_name)}</span>` : ''}
            ${stepsStr ? `<span class="kanban-card__steps">✓ ${stepsStr}</span>` : ''}
            ${dueStr ? `<span class="kanban-card__due">${dueStr}</span>` : ''}
            ${card.comment_count ? `<span class="kanban-card__comments">💬 ${card.comment_count}</span>` : ''}
          </div>
        </div>
      </div>
    </a>`;
}

// ==================== CARD PAGE ====================
var _cardPinnedComment = null;

var _cardEditMode = false;

async function renderCardPage(el, cardId) {
  el.className = '';
  try {
    const card = await (await fetch('/api/cards/' + cardId)).json();
    var comments = [];
    try { comments = await (await fetch('/api/cards/' + cardId + '/comments')).json(); } catch(e) {}

    // Load pinned comment from API
    _cardPinnedComment = card.pinned_comment || null;

    var board = allBoards.find(function(b) { return b.id === card.board_id; });
    var col = board && board.columns ? board.columns.find(function(c) { return c.id === card.column_id; }) : null;

    setBreadcrumb([
      { label: 'Video Production', href: '#/project/1' },
      { label: board ? board.title : '\u2014', href: '#/board/' + card.board_id },
      { label: col ? col.title : '\u2014', href: '#/board/' + card.board_id }
    ]);

    var manage = canManage();
    var editing = _cardEditMode && manage;
    var creatorName = card.creator_name || (allUsers.find(function(u) { return u.id === card.creator_id; }) || {}).name || '';
    var createdAgo = card.created_at ? timeAgo(card.created_at) : '';
    var avatarColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
    var getAC = function(name) { return avatarColors[(name||'').length % avatarColors.length]; };

    // Envelope SVG icon
    var envelopeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg>';

    // ===== ASSIGNED TO =====
    var assigneesHtml = '';
    if (manage) {
      if (card.assignees && card.assignees.length > 0) {
        assigneesHtml = card.assignees.map(function(a) {
          return '<span class="bc-assignee">' + esc(a.name) + '<button class="bc-assignee__remove" onclick="event.stopPropagation();removeAssignee(' + cardId + ',' + a.id + ')" title="Remove">\u2715</button></span>';
        }).join(' ');
      }
      var availableUsers = allUsers.filter(function(u) { return !(card.assignees || []).some(function(a) { return a.id === u.id; }); });
      var assignPlaceholder = card.assignees && card.assignees.length ? '+ Add...' : 'Type names to assign\u2026';
      var assignClass = card.assignees && card.assignees.length ? 'bc-select-inline' : 'bc-select-inline bc-select-inline--ghost';
      assigneesHtml += '<select class="' + assignClass + '" onchange="addAssignee(' + cardId + ', this.value)">' +
        '<option value="">' + assignPlaceholder + '</option>' +
        availableUsers.map(function(u) { return '<option value="' + u.id + '">' + esc(u.name) + '</option>'; }).join('') +
        '</select>';
    } else {
      if (card.assignees && card.assignees.length > 0) {
        assigneesHtml = card.assignees.map(function(a) { return '<span>' + esc(a.name) + '</span>'; }).join(', ');
      } else {
        assigneesHtml = '<span class="bc-field__placeholder">Type names to assign\u2026</span>';
      }
    }

    // ===== DUE DATE =====
    var dueHtml = '';
    if (manage) {
      var noDueChecked = !card.due_on ? ' checked' : '';
      var specificChecked = card.due_on ? ' checked' : '';
      var dateHidden = !card.due_on ? ' bc-date-input--hidden' : '';
      dueHtml = '<label class="bc-radio"><input type="radio" name="due_' + cardId + '"' + noDueChecked + ' onchange="handleNoDueDate(' + cardId + ')"> No due date</label>' +
        '<label class="bc-radio"><input type="radio" name="due_' + cardId + '"' + specificChecked + ' onchange="handleSpecificDate(' + cardId + ')"> A specific day ' +
        '<input type="date" id="dueDateInput_' + cardId + '" class="bc-date-input' + dateHidden + '" value="' + (card.due_on || '') + '" onchange="updateField(' + cardId + ',\'due_on\',this.value||null)">' +
        '</label>';
    } else {
      dueHtml = '<span>' + (card.due_on ? formatDate(card.due_on) : '<span class="bc-field__placeholder">Select a due date</span>') + '</span>';
    }

    // ===== NOTES =====
    var notesHtml = '';
    if (editing) {
      notesHtml = '<div class="bc-editor">' +
        '<input id="cardNotesInput" type="hidden" value="' + esc(card.content || '') + '">' +
        '<trix-editor input="cardNotesInput" class="trix-dark" placeholder="Add notes\u2026"></trix-editor>' +
        '</div>' +
        '<div class="bc-attach-row">' +
        '<button class="bc-attach-btn" onclick="document.getElementById(\'notesFileInput_' + cardId + '\').click()">&#128206; Прикачи файл</button>' +
        '<input type="file" id="notesFileInput_' + cardId + '" style="display:none" onchange="attachNotesFile(' + cardId + ',this)" accept="*/*">' +
        '</div>';
    } else {
      if (card.content && card.content.replace(/<[^>]*>/g, '').trim()) {
        notesHtml = '<div class="rich-content">' + card.content + '</div>';
      } else {
        notesHtml = '<span class="bc-field__placeholder">Add notes\u2026</span>';
      }
    }

    // ===== STEPS =====
    var stepsHtml = '';
    if (card.steps && card.steps.length) {
      stepsHtml += '<ul class="bc-checklist">';
      stepsHtml += card.steps.map(function(s) {
        var doneClass = s.completed ? ' bc-checklist__item--done' : '';
        var assigneeName = s.assignee_id ? (allUsers.find(function(u) { return u.id === s.assignee_id; }) || {}).name || '' : '';
        var stepClick = manage ? ' onclick="expandStep(' + cardId + ',' + s.id + ',this.closest(\'li\'))"' : '';
        return '<li class="bc-checklist__item' + doneClass + '" data-step-id="' + s.id + '">' +
          '<input type="checkbox" ' + (s.completed ? 'checked' : '') + ' onclick="event.stopPropagation();toggleStep(' + cardId + ',' + s.id + ',this.checked)">' +
          '<span' + stepClick + '>' + esc(s.title) + '</span>' +
          (assigneeName ? '<span class="bc-step-meta">' + esc(assigneeName) + '</span>' : '') +
          (s.due_on ? '<span class="bc-step-meta">' + formatDate(s.due_on) + '</span>' : '') +
          '</li>';
      }).join('');
      stepsHtml += '</ul>';
    }
    if (manage) {
      stepsHtml += '<button class="bc-add-step-link" onclick="showAddStepForm(' + cardId + ')">Add a new step</button>';
      stepsHtml += '<div class="bc-add-step" id="addStepForm_' + cardId + '">' +
        '<div class="bc-add-step__row"><label>Step</label><input id="newStepInput" type="text" placeholder="Describe this step\u2026" onkeydown="if(event.key===\'Enter\')addStepFromPage(' + cardId + ')"></div>' +
        '<div class="bc-add-step__row"><label>Assign to</label><select id="newStepAssignee"><option value="">Nobody</option>' + allUsers.map(function(u) { return '<option value="' + u.id + '">' + esc(u.name) + '</option>'; }).join('') + '</select></div>' +
        '<div class="bc-add-step__row"><label>Due on</label>' +
        '<label class="bc-radio" style="flex:0"><input type="radio" name="newStepDueRadio" checked onchange="document.getElementById(\'newStepDue\').classList.add(\'bc-date-input--hidden\')"> No date</label>' +
        '<label class="bc-radio" style="flex:0"><input type="radio" name="newStepDueRadio" onchange="var d=document.getElementById(\'newStepDue\');d.classList.remove(\'bc-date-input--hidden\');d.focus()"> Date</label>' +
        '<input type="date" id="newStepDue" class="bc-date-input bc-date-input--hidden">' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:8px"><button class="bc-btn-save" onclick="addStepFromPage(' + cardId + ')">Add this step</button><button class="bc-btn-discard" onclick="hideAddStepForm(' + cardId + ')">Cancel</button></div>' +
        '</div>';
    }


    // ===== COLUMN (always show Move along to dropdown) =====
    var colOptionsHtml = '';
    if (manage && board && board.columns) {
      var otherCols = board.columns.filter(function(c) { return c.id !== card.column_id; });
      colOptionsHtml = '<select class="bc-select-inline" onchange="moveCard(' + cardId + ', this.value)">' +
        '<option value="">Move along to\u2026</option>' +
        otherCols.map(function(c) { return '<option value="' + c.id + '">' + esc(c.title) + '</option>'; }).join('') +
        '</select>';
    }

    // ===== COMMENTS =====
    var commentAddHtml = '<div class="bc-comment-add">' +
      '<div class="bc-comment-avatar" style="background:' + getAC(currentUser ? currentUser.name : '') + '">' + initials(currentUser ? currentUser.name : '') + '</div>' +
      '<div class="bc-comment-input-wrap">' +
      '<div class="bc-comment-placeholder" onclick="expandCommentInput()">Написвай коментар\u2026</div>' +
      '<div class="bc-comment-editor-wrap" id="commentEditorWrap">' +
      '<div class="bc-editor"><input id="newCommentInput" type="hidden" value=""><trix-editor input="newCommentInput" class="trix-dark" placeholder="Type your comment here\u2026" style="min-height:80px"></trix-editor></div>' +
      '<div style="display:flex;gap:8px;margin-top:8px"><button class="bc-btn-save bc-btn-add-comment" onclick="addComment(' + cardId + ')">Добави коментар</button><button class="bc-btn-discard" onclick="collapseCommentInput()">Отказ</button></div>' +
      '</div>' +
      '</div></div>';

    var commentsListHtml = '';
    if (comments.length) {
      commentsListHtml = '<div class="bc-comments-list">';
      for (var i = 0; i < comments.length; i++) {
        var c = comments[i];
        var cc = getAC(c.user_name);
        var isOwn = currentUser && (c.user_id === currentUser.id || currentUser.role === 'admin' || currentUser.role === 'moderator');
        var isPinned = _cardPinnedComment && _cardPinnedComment.id === c.id;
        commentsListHtml += '<div class="bc-comment" data-comment-id="' + c.id + '">' +
          '<div class="bc-comment-avatar" style="background:' + cc + '">' + initials(c.user_name) + '</div>' +
          '<div class="bc-comment-body">' +
          '<div class="bc-comment-meta"><strong>' + esc(c.user_name) + '</strong> <span>' + timeAgo(c.created_at) + '</span></div>' +
          '<div class="bc-comment-text">' + (c.content || '').replace(/\n/g, '<br>') + '</div>' +
          '<div class="bc-comment-actions">' +
          (isOwn ? '<button class="bc-comment-action" onclick="editComment(' + cardId + ',' + c.id + ',this)">Edit</button>' : '') +
          (isOwn ? '<button class="bc-comment-action bc-comment-action--danger" onclick="deleteComment(' + cardId + ',' + c.id + ')">Delete</button>' : '') +
          '<button class="bc-comment-action bc-comment-action--pin" onclick="pinComment(' + cardId + ',' + c.id + ')">' + (isPinned ? 'Unpin' : '\ud83d\udccc Pin') + '</button>' +
          '</div></div></div>';
      }
      commentsListHtml += '</div>';
    }

    // ===== PINNED SIDEBAR =====
    var pinnedSidebarHtml = '';
    if (_cardPinnedComment) {
      var pc = _cardPinnedComment;
      pinnedSidebarHtml = '<div class="bc-pinned-sidebar">' +
        '<div class="bc-pinned-sidebar__title">\ud83d\udccc Pinned</div>' +
        '<div class="bc-pinned-sidebar__content">' + (pc.content || '').replace(/\n/g, '<br>') + '</div>' +
        '<div class="bc-pinned-sidebar__meta">\u2014 ' + esc(pc.user_name) + ', ' + timeAgo(pc.created_at) + '</div>' +
        '<button class="bc-pinned-sidebar__unpin" onclick="unpinComment(' + cardId + ')">Unpin</button>' +
        '</div>';
    }

    // Register Trix foreground color attribute (idempotent)
    if (window.Trix && !Trix.config.textAttributes.foregroundColor) {
      Trix.config.textAttributes.foregroundColor = { styleProperty: 'color', inheritable: true };
    }

    // ===== BUILD PAGE =====
    var wrapperStart = pinnedSidebarHtml ? '<div class="card-page-wrapper">' : '';
    var wrapperEnd = pinnedSidebarHtml ? pinnedSidebarHtml + '</div>' : '';

    var titleEsc = esc(card.title).replace(/'/g, "\\'");
    var editBtnHtml = manage && !editing ? '<button class="bc-card__edit-btn" onclick="enterCardEditMode(' + cardId + ')" title="Edit">Edit card</button>' : '';

    el.innerHTML = wrapperStart +
      '<div class="' + (pinnedSidebarHtml ? 'card-page-main' : 'card-page') + '">' +
        '<article class="bc-card">' +
          '<div class="bc-card-options">' +
            editBtnHtml +
            '<button class="btn btn-sm btn-ghost bc-card-options__dots" onclick="toggleCardOptionsMenu(event,' + cardId + ',\'' + titleEsc + '\')" title="Options">\u22ef</button>' +
          '</div>' +
          '<header class="bc-card__header">' +
            '<span class="bc-card__icon">' + envelopeIcon + '</span>' +
            '<h1 class="bc-card__title" onclick="' + (editing ? 'editCardTitle(this,' + cardId + ')' : 'enterCardEditMode(' + cardId + ')') + '">' + esc(card.title) + '</h1>' +
          '</header>' +
          '<div class="bc-card__fields">' +
            '<div class="bc-field"><span class="bc-field__label">Колона</span><div class="bc-field__value"><span>' + esc(col ? col.title : '\u2014') + '</span>' + colOptionsHtml + '</div></div>' +
            '<div class="bc-field"><span class="bc-field__label">Assigned to</span><div class="bc-field__value">' + assigneesHtml + '</div></div>' +
            '<div class="bc-field"><span class="bc-field__label">Due on</span><div class="bc-field__value bc-field__value--vertical">' + dueHtml + '</div></div>' +
            '<div class="bc-field"><span class="bc-field__label">Notes</span><div class="bc-field__value bc-field__value--full">' + notesHtml + '</div></div>' +
            '<div class="bc-field"><span class="bc-field__label">Steps</span><div class="bc-field__value bc-field__value--full">' + stepsHtml + '</div></div>' +
            '<div class="bc-field bc-field--light"><span class="bc-field__label">Added by</span><div class="bc-field__value"><span>' + esc(creatorName) + '</span><span class="bc-field__hint">' + createdAgo + '</span></div></div>' +
          '</div>' +
          (editing ? '<div class="bc-card__actions"><button class="bc-btn-save" onclick="saveCardEdits(' + cardId + ')">Save changes</button><button class="bc-btn-discard" onclick="exitCardEditMode(' + cardId + ')">Discard changes</button></div>' : '') +
        '</article>' +
        '<div class="bc-comments">' + commentAddHtml + commentsListHtml + '</div>' +
      '</div>' + wrapperEnd;

    // Setup image lightbox + process video/file attachments in view mode
    setTimeout(function() { processRichContent(); setupImageLightbox(); }, 100);

    // Setup Trix attachment handlers and color picker
    if (editing) {
      setTimeout(function() {
        var notesEditor = document.querySelector('trix-editor[input="cardNotesInput"]');
        if (notesEditor) {
          notesEditor.addEventListener('trix-attachment-add', function(e) {
            if (e.attachment.file) uploadTrixAttachment(cardId, e.attachment);
          });
          injectTrixColorButton(notesEditor);
        }
      }, 300);
    }
    // Comment trix is always present (hidden until expanded)
    setTimeout(function() {
      var commentEditor = document.querySelector('trix-editor[input="newCommentInput"]');
      if (commentEditor) {
        commentEditor.addEventListener('trix-attachment-add', function(e) {
          if (e.attachment.file) uploadTrixAttachment(cardId, e.attachment);
        });
        injectTrixColorButton(commentEditor);
      }
    }, 300);

  } catch(e) { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">\u041a\u0430\u0440\u0442\u0430\u0442\u0430 \u043d\u0435 \u0435 \u043d\u0430\u043c\u0435\u0440\u0435\u043d\u0430</div>'; }
}

// Enter/exit edit mode
function enterCardEditMode(cardId) {
  _cardEditMode = true;
  router();
}
function exitCardEditMode(cardId) {
  _cardEditMode = false;
  router();
}
async function saveCardEdits(cardId) {
  var notesInput = document.getElementById('cardNotesInput');
  if (notesInput) {
    var content = notesInput.value;
    var textContent = content ? content.replace(/<[^>]*>/g, '').trim() : '';
    await fetch('/api/cards/' + cardId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: textContent ? content : '' }) });
  }
  _cardEditMode = false;
  router();
}

// ==================== CARD PAGE HELPERS ====================

// Upload file via Trix attachment
async function uploadTrixAttachment(cardId, attachment) {
  var fd = new FormData();
  fd.append('file', attachment.file);
  try {
    var res = await fetch('/api/cards/' + cardId + '/attachments', { method: 'POST', body: fd });
    var data = await res.json();
    if (data.storage_path) {
      attachment.setAttributes({ url: data.storage_path, href: data.storage_path });
    }
  } catch(e) {}
}

// ==================== COMMENT COLLAPSE ====================
function expandCommentInput() {
  var placeholder = document.querySelector('.bc-comment-placeholder');
  var wrap = document.getElementById('commentEditorWrap');
  if (placeholder) placeholder.style.display = 'none';
  if (wrap) {
    wrap.classList.add('expanded');
    setTimeout(function() {
      var editor = wrap.querySelector('trix-editor');
      if (editor) editor.focus();
    }, 50);
  }
}
function collapseCommentInput() {
  var placeholder = document.querySelector('.bc-comment-placeholder');
  var wrap = document.getElementById('commentEditorWrap');
  if (placeholder) placeholder.style.display = '';
  if (wrap) wrap.classList.remove('expanded');
}

// ==================== IMAGE LIGHTBOX ====================
function setupImageLightbox() {
  document.querySelectorAll('.rich-content img, .bc-comment-text img').forEach(function(img) {
    img.style.cursor = 'pointer';
    img.addEventListener('click', function() { showLightbox(img.src); });
  });
}
function showLightbox(src) {
  var existing = document.querySelector('.bc-lightbox');
  if (existing) existing.remove();
  var lb = document.createElement('div');
  lb.className = 'bc-lightbox';
  lb.innerHTML = '<div class="bc-lightbox__backdrop"></div>' +
    '<button class="bc-lightbox__close" title="Затвори">&times;</button>' +
    '<img class="bc-lightbox__img" src="' + src + '">';
  document.body.appendChild(lb);
  lb.querySelector('.bc-lightbox__backdrop').addEventListener('click', function() { lb.remove(); });
  lb.querySelector('.bc-lightbox__close').addEventListener('click', function() { lb.remove(); });
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') { lb.remove(); document.removeEventListener('keydown', handler); }
  });
}

// ==================== TRIX COLOR PICKER ====================
function injectTrixColorButton(trixEl) {
  var toolbar = trixEl.previousElementSibling;
  if (!toolbar || toolbar.tagName !== 'TRIX-TOOLBAR') return;
  if (toolbar.querySelector('.bc-trix-color-btn')) return; // already injected
  var group = toolbar.querySelector('.trix-button-group--text-tools');
  if (!group) return;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'trix-button bc-trix-color-btn';
  btn.title = 'Цвят на текст';
  btn.innerHTML = '<span style="background:#ef4444;border-radius:50%;width:12px;height:12px;display:inline-block;border:1px solid rgba(255,255,255,0.35)"></span>';
  btn.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    showTrixColorPicker(e, trixEl);
  });
  group.appendChild(btn);
}
function showTrixColorPicker(e, trixEl) {
  var existing = document.querySelector('.bc-color-picker');
  if (existing) { existing.remove(); return; }
  var COLORS = [
    { name: 'Червено', value: '#ef4444' },
    { name: 'Оранжево', value: '#f97316' },
    { name: 'Жълто', value: '#fbbf24' },
    { name: 'Зелено', value: '#22c55e' },
    { name: 'Тюркоаз', value: '#14b8a6' },
    { name: 'Синьо', value: '#3b82f6' },
    { name: 'Индиго', value: '#6366f1' },
    { name: 'Лилаво', value: '#a855f7' },
    { name: 'Розово', value: '#ec4899' }
  ];
  var picker = document.createElement('div');
  picker.className = 'bc-color-picker';
  COLORS.forEach(function(c) {
    var swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'bc-color-swatch';
    swatch.style.background = c.value;
    swatch.title = c.name;
    swatch.addEventListener('click', function(ev) {
      ev.stopPropagation();
      if (window.Trix && Trix.config.textAttributes.foregroundColor) {
        trixEl.editor.activateAttribute('foregroundColor', c.value);
      }
      picker.remove();
      trixEl.focus();
    });
    picker.appendChild(swatch);
  });
  var resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'bc-color-swatch bc-color-swatch--reset';
  resetBtn.title = 'Без цвят';
  resetBtn.textContent = 'A';
  resetBtn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    if (window.Trix && Trix.config.textAttributes.foregroundColor) {
      trixEl.editor.deactivateAttribute('foregroundColor');
    }
    picker.remove();
    trixEl.focus();
  });
  picker.appendChild(resetBtn);
  var rect = e.currentTarget.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.top = (rect.bottom + 4) + 'px';
  picker.style.left = rect.left + 'px';
  document.body.appendChild(picker);
  setTimeout(function() {
    document.addEventListener('click', function handler() {
      picker.remove();
      document.removeEventListener('click', handler);
    });
  }, 10);
}

// ==================== RICH CONTENT POST-PROCESSING ====================
// Convert Trix attachment figures to proper video/file elements in view mode
function processRichContent() {
  document.querySelectorAll('.rich-content figure[data-trix-attachment]').forEach(function(fig) {
    try {
      var att = JSON.parse(fig.getAttribute('data-trix-attachment'));
      var url = att.url || att.href;
      if (!url) return;
      var ct = (att.contentType || '').toLowerCase();
      var name = att.filename || url.split('/').pop();
      if (ct.startsWith('video/') || /\.(mp4|webm|ogg|mov|mkv|avi)$/i.test(name)) {
        var video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.style.cssText = 'max-width:100%;border-radius:6px;margin:8px 0;display:block';
        fig.replaceWith(video);
      } else if (!ct.startsWith('image/')) {
        var link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.target = '_blank';
        link.className = 'bc-att-file';
        link.innerHTML = '&#128196; ' + esc(name);
        fig.replaceWith(link);
      }
    } catch(e) {}
  });
}

// Click-to-edit title
function editCardTitle(el, cardId) {
  var current = el.textContent;
  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'bc-card__title-input';
  input.value = current;
  el.replaceWith(input);
  input.focus();
  input.select();
  var saving = false;
  var save = function() {
    if (saving) return;
    saving = true;
    var val = input.value.trim();
    if (val && val !== current) {
      updateField(cardId, 'title', val);
    }
    var h1 = document.createElement('h1');
    h1.className = 'bc-card__title';
    h1.textContent = val || current;
    h1.onclick = function() { editCardTitle(h1, cardId); };
    input.replaceWith(h1);
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
}

// Options "..." dropdown menu
function toggleCardOptionsMenu(e, cardId, cardTitle) {
  e.stopPropagation();
  var existing = document.querySelector('.bc-options-menu');
  if (existing) { existing.remove(); return; }

  var menu = document.createElement('div');
  menu.className = 'bc-options-menu';
  menu.innerHTML =
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();document.querySelector(\'.bc-card__title\').click()">\u270f\ufe0f Edit</button>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();showMoveCardPicker(' + cardId + ')">\u2197\ufe0f Move</button>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();copyCardLink(' + cardId + ')">\ud83d\udccb Copy link</button>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();archiveCard(' + cardId + ')">\ud83d\udce6 Archive</button>' +
    '<button class="bc-options-menu__item bc-options-menu__item--danger" onclick="document.querySelector(\'.bc-options-menu\').remove();trashCard(' + cardId + ')">\ud83d\uddd1\ufe0f Put in the trash</button>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();toggleBookmark(\'card\',' + cardId + ',\'' + cardTitle.replace(/'/g, "\\'") + '\')">\ud83d\udd16 Bookmark</button>' +
    '<div class="bc-options-menu__sep"></div>' +
    '<div class="bc-options-menu__heading">History</div>' +
    '<button class="bc-options-menu__item" style="opacity:0.5;cursor:default">\ud83d\udd50 View change log</button>' +
    '<button class="bc-options-menu__item" style="opacity:0.5;cursor:default">\ud83d\udc65 Notified people</button>';

  var optionsDiv = document.querySelector('.bc-card-options');
  if (optionsDiv) { optionsDiv.appendChild(menu); }

  setTimeout(function() {
    document.addEventListener('click', function handler() {
      var m = document.querySelector('.bc-options-menu');
      if (m) m.remove();
      document.removeEventListener('click', handler);
    });
  }, 10);
}

// Move card picker (simple prompt for now)
function showMoveCardPicker(cardId) {
  var boardNames = allBoards.map(function(b, i) { return (i + 1) + '. ' + b.title; }).join('\n');
  var choice = prompt('Move to which board?\n' + boardNames);
  if (!choice) return;
  var idx = parseInt(choice) - 1;
  var board = allBoards[idx];
  if (!board) return;
  var colNames = (board.columns || []).map(function(c, i) { return (i + 1) + '. ' + c.title; }).join('\n');
  var colChoice = prompt('Which column?\n' + colNames);
  if (!colChoice) return;
  var colIdx = parseInt(colChoice) - 1;
  var col = (board.columns || [])[colIdx];
  if (!col) return;
  moveCard(cardId, col.id);
}

// Copy card link
function copyCardLink(cardId) {
  var url = location.origin + '/#/card/' + cardId;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url);
  }
}

// Archive card (DELETE)
async function archiveCard(cardId) {
  if (!confirm('Archive this card?')) return;
  try {
    await fetch('/api/cards/' + cardId, { method: 'DELETE' });
    history.back();
  } catch(e) {}
}

// Trash card (same as archive for now)
async function trashCard(cardId) {
  if (!confirm('Put this card in the trash?')) return;
  try {
    await fetch('/api/cards/' + cardId, { method: 'DELETE' });
    history.back();
  } catch(e) {}
}

// Remove assignee
async function removeAssignee(cardId, userId) {
  try {
    var card = await (await fetch('/api/cards/' + cardId)).json();
    var ids = (card.assignees || []).map(function(a) { return a.id; }).filter(function(id) { return id !== parseInt(userId); });
    await fetch('/api/cards/' + cardId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignee_ids: ids }) });
    router();
  } catch(e) {}
}

// Due date radio handlers
function handleNoDueDate(cardId) {
  var dateInput = document.getElementById('dueDateInput_' + cardId);
  if (dateInput) {
    dateInput.value = '';
    dateInput.classList.add('bc-date-input--hidden');
  }
  updateField(cardId, 'due_on', null);
}

function handleSpecificDate(cardId) {
  var dateInput = document.getElementById('dueDateInput_' + cardId);
  if (dateInput) {
    dateInput.classList.remove('bc-date-input--hidden');
    dateInput.focus();
  }
}

// Steps: expand on click
function expandStep(cardId, stepId, li) {
  // If already expanded, collapse
  var existingForm = li.querySelector('.bc-step-expand');
  if (existingForm) { existingForm.remove(); return; }
  // Collapse any other expanded step
  document.querySelectorAll('.bc-step-expand').forEach(function(f) { f.remove(); });

  var stepText = li.querySelector('span').textContent;
  var form = document.createElement('div');
  form.className = 'bc-step-expand';
  form.onclick = function(e) { e.stopPropagation(); };
  form.innerHTML =
    '<div class="bc-step-expand__row"><label>Title</label><input type="text" id="editStepTitle_' + stepId + '" value="' + esc(stepText) + '"></div>' +
    '<div class="bc-step-expand__row"><label>Assign to</label><select id="editStepAssignee_' + stepId + '"><option value="">Nobody</option>' +
    allUsers.map(function(u) { return '<option value="' + u.id + '">' + esc(u.name) + '</option>'; }).join('') + '</select></div>' +
    '<div class="bc-step-expand__row"><label>Due on</label><input type="date" id="editStepDue_' + stepId + '" class="bc-date-input"></div>' +
    '<div class="bc-step-expand__actions">' +
    '<div style="display:flex;gap:8px"><button class="bc-btn-save" onclick="saveStepEdit(' + cardId + ',' + stepId + ')">Save</button>' +
    '<button class="bc-btn-discard" onclick="this.closest(\'.bc-step-expand\').remove()">Cancel</button></div>' +
    '<button class="bc-step-expand__delete" onclick="deleteStep(' + cardId + ',' + stepId + ')">Delete step</button>' +
    '</div>';
  li.appendChild(form);
}

async function saveStepEdit(cardId, stepId) {
  var title = document.getElementById('editStepTitle_' + stepId);
  var assignee = document.getElementById('editStepAssignee_' + stepId);
  var due = document.getElementById('editStepDue_' + stepId);
  var data = {};
  if (title) data.title = title.value.trim();
  if (assignee && assignee.value) data.assignee_id = parseInt(assignee.value);
  if (due && due.value) data.due_on = due.value;
  try {
    await fetch('/api/cards/' + cardId + '/steps/' + stepId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    router();
  } catch(e) {}
}

async function deleteStep(cardId, stepId) {
  if (!confirm('Delete this step?')) return;
  try {
    await fetch('/api/cards/' + cardId + '/steps/' + stepId, { method: 'DELETE' });
    router();
  } catch(e) {}
}

// Show/hide add step form
function showAddStepForm(cardId) {
  var form = document.getElementById('addStepForm_' + cardId);
  if (form) {
    form.classList.add('bc-add-step--visible');
    var input = document.getElementById('newStepInput');
    if (input) input.focus();
  }
}
function hideAddStepForm(cardId) {
  var form = document.getElementById('addStepForm_' + cardId);
  if (form) form.classList.remove('bc-add-step--visible');
}

// Comment: edit
function editComment(cardId, commentId, btn) {
  var commentDiv = btn.closest('.bc-comment');
  var textDiv = commentDiv.querySelector('.bc-comment-text');
  var currentHtml = textDiv.innerHTML;
  var currentText = textDiv.textContent;

  textDiv.innerHTML = '<div class="bc-editor"><input id="editCommentInput_' + commentId + '" type="hidden" value="' + esc(currentHtml) + '"><trix-editor input="editCommentInput_' + commentId + '" class="trix-dark" style="min-height:60px"></trix-editor></div>' +
    '<div style="display:flex;gap:8px;margin-top:8px"><button class="bc-btn-save" onclick="saveCommentEdit(' + cardId + ',' + commentId + ')">Save</button><button class="bc-btn-discard" onclick="router()">Cancel</button></div>';
}

async function saveCommentEdit(cardId, commentId) {
  var input = document.getElementById('editCommentInput_' + commentId);
  if (!input) return;
  var content = input.value;
  try {
    await fetch('/api/cards/' + cardId + '/comments/' + commentId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content }) });
    router();
  } catch(e) {}
}

// Comment: delete
async function deleteComment(cardId, commentId) {
  if (!confirm('Delete this comment?')) return;
  try {
    await fetch('/api/cards/' + cardId + '/comments/' + commentId, { method: 'DELETE' });
    router();
  } catch(e) {}
}

// Comment: pin/unpin (persisted via API)
async function pinComment(cardId, commentId) {
  var newId = (_cardPinnedComment && _cardPinnedComment.id === commentId) ? null : commentId;
  try {
    await fetch('/api/cards/' + cardId + '/pin-comment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentId: newId })
    });
  } catch(e) {}
  router();
}
async function unpinComment(cardId) {
  try {
    await fetch('/api/cards/' + cardId + '/pin-comment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commentId: null })
    });
  } catch(e) {}
  router();
}
async function loadCardAttachments(cardId) {
  try {
    const files = await (await fetch(`/api/cards/${cardId}/attachments`)).json();
    const container = document.getElementById('cardAttachments');
    if (!container) return;
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-weight:600;color:var(--text)">📎 Файлове (${files.length})</span>
        ${canManage() ? `<label class="btn btn-sm" style="cursor:pointer">+ Качи файл<input type="file" style="display:none" onchange="uploadCardFile(this,${cardId})"></label>` : ''}
      </div>
      ${files.map(f => `
        <div class="attachment-item">
          <span class="attachment-icon">${getFileIcon(f.mime_type)}</span>
          <div class="attachment-info">
            <a href="${f.storage_path}" target="_blank" class="attachment-name">${esc(f.original_name || f.filename)}</a>
            <div class="attachment-meta">${formatFileSize(f.size_bytes)} · ${timeAgo(f.created_at)}</div>
          </div>
          ${canManage() ? `<button class="btn btn-sm" onclick="deleteAttachment(${cardId},${f.id})" style="color:var(--red)">✕</button>` : ''}
        </div>
      `).join('')}
    `;
  } catch {}
}
async function uploadCardFile(input, cardId) {
  if (!input.files[0]) return;
  const f = new FormData(); f.append('file', input.files[0]);
  try { await fetch(`/api/cards/${cardId}/attachments`, {method:'POST',body:f}); loadCardAttachments(cardId); } catch {}
}
async function deleteAttachment(cardId, attachId) {
  if (!confirm('Изтрий файла?')) return;
  try { await fetch(`/api/cards/${cardId}/attachments/${attachId}`, {method:'DELETE'}); loadCardAttachments(cardId); } catch {}
}

// ==================== CARD CREATE ====================
async function renderCardCreate(el) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const boardId = parseInt(params.get('board')) || allBoards[0]?.id;
  const columnId = parseInt(params.get('column')) || null;
  const board = allBoards.find(b => b.id === boardId);

  setBreadcrumb([
    { label: 'Video Production', href: '#/project/1' },
    { label: board?.title || '—', href: `#/board/${boardId}` },
    { label: 'Нова карта', href: '#' }
  ]);
  el.className = '';

  el.innerHTML = `
    <div class="card-page">
      <div class="page-header" style="text-align:left"><h1 style="font-size:22px">Нова карта</h1></div>
      <div class="card-create-form">
        <div class="edit-row"><label>Заглавие *</label><input id="createTitle" placeholder="Заглавие на картата" autofocus></div>
        <div class="edit-row"><label>Борд</label><select id="createBoard" onchange="updateCreateColumns()">${allBoards.map(b=>`<option value="${b.id}" ${b.id===boardId?'selected':''}>${esc(b.title)}</option>`).join('')}</select></div>
        <div class="edit-row"><label>Колона</label><select id="createColumn">${(board?.columns||[]).filter(c=>!c.is_done_column).map(c=>`<option value="${c.id}" ${c.id===columnId?'selected':''}>${esc(c.title)}</option>`).join('')}</select></div>
        <div class="edit-row"><label>Бележки</label><input id="createContent" type="hidden"><trix-editor input="createContent" class="trix-dark" placeholder="Добави бележки..."></trix-editor></div>
        <div class="edit-row"><label>Краен срок</label><input type="date" id="createDue" lang="bg" title="дд.мм.гггг"></div>
        <div class="edit-row"><label>Клиент</label><input id="createClient" placeholder="Име на клиент"></div>
        <div class="edit-row"><label>Възложи на</label><select id="createAssignees" multiple style="min-height:80px">${allUsers.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>
        <div class="edit-row"><label>Приоритет</label><select id="createPriority"><option value="normal">Нормален</option><option value="high">Висок</option><option value="urgent">Спешен</option></select></div>
        <div class="edit-actions">
          <button class="btn btn-primary" onclick="submitCreateCard()">Създай картата</button>
          <button class="btn" onclick="history.back()">Отказ</button>
        </div>
      </div>
    </div>`;
}
function updateCreateColumns() {
  const b = allBoards.find(b => b.id === parseInt(document.getElementById('createBoard').value));
  document.getElementById('createColumn').innerHTML = (b?.columns||[]).filter(c=>!c.is_done_column).map(c=>`<option value="${c.id}">${esc(c.title)}</option>`).join('');
}
async function submitCreateCard() {
  const title = document.getElementById('createTitle').value.trim();
  if (!title) return alert('Заглавието е задължително');
  const data = {
    title, board_id: parseInt(document.getElementById('createBoard').value),
    column_id: parseInt(document.getElementById('createColumn').value),
    content: document.getElementById('createContent').value || null,
    due_on: document.getElementById('createDue').value || null,
    client_name: document.getElementById('createClient').value || null,
    priority: document.getElementById('createPriority').value,
    assignee_ids: Array.from(document.getElementById('createAssignees').selectedOptions).map(o=>parseInt(o.value))
  };
  try {
    const card = await (await fetch('/api/cards', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) })).json();
    location.hash = `#/card/${card.id}`;
  } catch {}
}

// ==================== CARD ACTIONS ====================
async function updateField(cardId, field, value) {
  try { await fetch(`/api/cards/${cardId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({[field]:value}) }); } catch {}
}
async function saveCardNotes(cardId) {
  const editor = document.querySelector('trix-editor');
  if (!editor) return;
  const content = editor.editor.getDocument().toString().trim() ? document.getElementById('cardNotesInput').value : null;
  try {
    await fetch(`/api/cards/${cardId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content}) });
    const btn = document.querySelector('.card-field--notes .btn');
    if (btn) { btn.textContent = '\u2713 Запазено'; setTimeout(() => btn.textContent = 'Запази бележки', 1500); }
  } catch {}
}
async function moveCard(cardId, columnId) {
  if (!columnId) return;
  try { await fetch(`/api/cards/${cardId}/move`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({column_id:parseInt(columnId)}) }); router(); } catch {}
}
async function addAssignee(cardId, userId) {
  if (!userId) return;
  try {
    const card = await (await fetch(`/api/cards/${cardId}`)).json();
    const ids = (card.assignees||[]).map(a=>a.id).concat(parseInt(userId));
    await fetch(`/api/cards/${cardId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({assignee_ids:ids}) });
    router();
  } catch {}
}
async function toggleStep(cid, sid, done) {
  try { await fetch(`/api/cards/${cid}/steps/${sid}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({completed:done}) }); router(); } catch {}
}
async function addStepFromPage(cardId) {
  const t = document.getElementById('newStepInput')?.value?.trim(); if (!t) return;
  const a = document.getElementById('newStepAssignee')?.value || null;
  const d = document.getElementById('newStepDue')?.value || null;
  try { await fetch(`/api/cards/${cardId}/steps`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({title:t, assignee_id:a?parseInt(a):null, due_on:d}) }); document.getElementById('newStepInput').value=''; router(); } catch {}
}
async function addComment(cardId) {
  var input = document.getElementById('newCommentInput');
  var c = input ? input.value.trim() : '';
  if (!c || c === '<div><br></div>') return;
  var textContent = c.replace(/<[^>]*>/g, '');
  var mentions = [];
  var mentionMatches = textContent.match(/@(\S+)/g);
  if (mentionMatches) {
    mentions = mentionMatches.map(function(m) { return m.substring(1).toLowerCase(); });
  }
  var mIds = allUsers.filter(function(u) { return mentions.some(function(n) { return u.name.toLowerCase().includes(n); }); }).map(function(u) { return u.id; });
  try { await fetch('/api/cards/' + cardId + '/comments', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content:c,mentions:mIds}) }); router(); } catch(e) {}
}

// ==================== ACTIVITY ====================
async function renderActivity(el) {
  setBreadcrumb(null); el.className = '';
  try {
    const _actRes = await fetch('/api/activity?limit=50');
    const _actData = await _actRes.json();
    const items = Array.isArray(_actData) ? _actData : [];
    const avatarColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
    const getAvatarColor = (name) => avatarColors[(name||'').length % avatarColors.length];

    // Group by date
    const grouped = {};
    items.forEach(a => {
      const d = new Date(a.created_at);
      const today = new Date(); today.setHours(0,0,0,0);
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
      const dateKey = d >= today ? 'ДНЕС' : d >= yesterday ? 'ВЧЕРА' : d.toLocaleDateString('bg', { month: 'long', day: 'numeric', year: 'numeric' });
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(a);
    });

    const actionText = (a) => {
      if (a.action === 'created') return 'създаде';
      if (a.action === 'commented') return 'коментира';
      if (a.action === 'moved') return 'премести';
      if (a.action === 'completed') return 'завърши';
      if (a.action === 'checked_off') return 'отметна стъпка на';
      return a.action;
    };

    el.innerHTML = `
      <div class="page-header"><h1>Последна активност</h1></div>
      <div style="display:flex;justify-content:center;gap:8px;margin-bottom:24px">
        <button class="btn btn-sm" style="background:var(--accent-dim);color:var(--accent);border-color:var(--accent)">Всичко</button>
        <button class="btn btn-sm">Филтрирай по проекти</button>
        <button class="btn btn-sm">Филтрирай по хора</button>
      </div>
      <div style="max-width:700px;margin:0 auto">
        ${items.length===0?'<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма активност все още</div>':
          Object.entries(grouped).map(([date, entries]) => `
            <div style="margin-bottom:24px">
              <div style="font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;padding:8px 0;border-bottom:1px solid var(--border);margin-bottom:8px">${date}</div>
              ${entries.map(a=>`
                <div class="activity-entry">
                  <div class="activity-avatar" style="background:${getAvatarColor(a.user_name)}">${initials(a.user_name||'')}</div>
                  <div class="activity-body">
                    <div class="activity-text"><strong>${esc(a.user_name||'')}</strong> ${actionText(a)} ${a.target_type==='card'?`<a href="#/card/${a.target_id}">${esc(a.target_title||'')}</a>`:esc(a.target_title||'')}</div>
                    ${a.excerpt ? `<div class="activity-excerpt">${esc(a.excerpt).substring(0,150)}</div>` : ''}
                    <div class="activity-meta">${a.board_title ? esc(a.board_title) + ' · ' : ''}${timeAgo(a.created_at)}</div>
                  </div>
                </div>`).join('')}
            </div>`).join('')}
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

// ==================== MY STUFF ====================
async function renderMyStuff(el) {
  setBreadcrumb(null); el.className = '';
  try {
    const cards = await (await fetch(`/api/cards?assignee_id=${currentUser.id}`)).json();
    el.innerHTML = `
      <div class="page-header"><h1>Моите задачи</h1></div>
      <div class="task-list" style="max-width:700px;margin:0 auto">
        ${cards.length===0?'<div style="text-align:center;padding:40px;color:var(--text-dim)"><div style="font-size:48px;opacity:0.3;margin-bottom:8px">✓</div>Нямаш задачи в момента</div>':
          cards.map(c=>`<a class="task-row ${getCardColorClass(c)}" href="#/card/${c.id}"><span class="task-title">${esc(c.title)}</span><span class="task-meta">${c.due_on?`<span class="task-due">${formatDate(c.due_on)}</span>`:''} ${c.board_title?`<span class="task-board">${esc(c.board_title)}</span>`:''}</span></a>`).join('')}
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

// ==================== NOTIFICATIONS ====================
async function renderNotifications(el) {
  setBreadcrumb(null); el.className = '';
  try {
    const items = await (await fetch('/api/notifications')).json();
    fetch('/api/notifications/read-all', { method:'PUT' }); updateHeyBadge();
    el.innerHTML = `
      <div class="page-header"><h1>Hey!</h1></div>
      <div style="max-width:700px;margin:0 auto">
        ${items.length===0?'<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма нищо ново за теб.</div>':
          items.map(n=>`<a class="hey-item ${n.is_read?'':'unread'}" href="${n.reference_type==='card'?`#/card/${n.reference_id}`:'#'}"><div class="hey-item__body">${n.type==='mentioned'?'<span class="hey-item__type">@спомена те в:</span>':n.type==='assigned'?'<span class="hey-item__type" style="background:var(--blue)">Възложено:</span>':''}<div class="hey-item__title">${esc(n.body||n.title)}</div><div class="hey-item__meta">${timeAgo(n.created_at)}</div></div></a>`).join('')}
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

// ==================== CHAT (PINGS) ====================
async function renderChatList(el) {
  setBreadcrumb(null); el.className = '';
  try {
    const channels = await (await fetch('/api/chat/channels')).json();
    const colors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
    el.innerHTML = `
      <div class="pings-page">
        <div class="pings-search-bar">
          <input id="pingSearchInput" placeholder="Започни личен чат с..." autocomplete="off" oninput="filterPingUsers()" onfocus="document.getElementById('pingSuggestions').style.display='block'">
          <div class="ping-suggestions" id="pingSuggestions" style="display:none">
            ${allUsers.filter(u=>u.id!==currentUser.id).map(u=>`<div class="ping-suggestion" onclick="startDirectChat(${u.id})"><div class="ping-avatar" style="background:${colors[u.id%colors.length]}">${initials(u.name)}</div><span>${esc(u.name)}</span></div>`).join('')}
          </div>
        </div>
        <div class="pings-grid">
          ${channels.map(ch=>{
            const others = ch.members?.filter(m=>m.id!==currentUser.id)||[];
            const name = ch.name||others.map(m=>m.name?.split(' ')[0]).join(', ')||'Чат';
            const other = others[0];
            const c = colors[(other?.id||0)%colors.length];
            return `<a class="ping-card" href="#/chat/${ch.id}"><div class="ping-avatar" style="background:${c}">${initials(other?.name||name)}</div><div class="ping-name">${esc(name)}</div></a>`;
          }).join('')}
          ${channels.length===0?'<div class="pings-empty"><p>Няма активни чатове</p><p class="hint">Напиши име горе за да започнеш</p></div>':''}
        </div>
      </div>`;
    document.addEventListener('click', e => { if (!e.target.closest('.pings-search-bar')) { const s=document.getElementById('pingSuggestions'); if(s)s.style.display='none'; } }, { once: true });
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
function filterPingUsers() {
  const q = document.getElementById('pingSearchInput')?.value?.toLowerCase().trim();
  document.querySelectorAll('.ping-suggestion').forEach(el => {
    el.style.display = (!q || el.querySelector('span')?.textContent?.toLowerCase().includes(q)) ? 'flex' : 'none';
  });
}
async function startDirectChat(userId) {
  try { const ch = await (await fetch('/api/chat/channels', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({type:'dm',member_ids:[userId]}) })).json(); location.hash=`#/chat/${ch.id}`; } catch {}
}
async function renderChatChannel(el, channelId) {
  setBreadcrumb([{label:'Пингове',href:'#/chat'},{label:'Чат',href:`#/chat/${channelId}`}]); el.className='';
  try {
    const [msgs, channels] = await Promise.all([(await fetch(`/api/chat/channels/${channelId}/messages`)).json(), (await fetch('/api/chat/channels')).json()]);
    const ch = channels.find(c=>c.id===channelId);
    const name = ch?.name || ch?.members?.filter(m=>m.id!==currentUser.id).map(m=>m.name).join(', ') || 'Чат';
    const chatColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
    el.innerHTML = `
      <div class="chat-page"><div class="chat-header"><a href="#/chat" class="btn btn-sm">\u2190 Назад</a><h2>${esc(name)}</h2></div>
        <div class="chat-messages" id="chatMessages">${msgs.map(m=>{const mc=chatColors[(m.user_name||'').length%chatColors.length];return`<div class="chat-msg"><div class="chat-msg-avatar" style="background:${mc};color:#fff">${initials(m.user_name)}</div><div class="chat-msg-body"><div class="chat-msg-name">${esc(m.user_name)} <span class="hint">${new Date(m.created_at).toLocaleTimeString('bg',{hour:'2-digit',minute:'2-digit'})}</span></div><div class="chat-msg-text">${esc(m.content).replace(/\n/g,'<br>')}</div></div></div>`;}).join('')}</div>
        <div class="chat-input-row"><textarea id="chatInput" placeholder="Напиши съобщение..." rows="2" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMsg(${channelId})}"></textarea><button class="btn btn-primary" onclick="sendChatMsg(${channelId})">Изпрати</button></div>
      </div>`;
    const m=document.getElementById('chatMessages'); if(m)m.scrollTop=m.scrollHeight;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
async function sendChatMsg(chId) {
  const i=document.getElementById('chatInput'),c=i?.value?.trim(); if(!c)return;
  try { await fetch(`/api/chat/channels/${chId}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:c})}); i.value=''; router(); } catch {}
}

// ==================== MESSAGE BOARD ====================
async function renderMessageBoard(el) {
  setBreadcrumb([{label:'Video Production',href:'#/project/1'},{label:'Съобщения',href:'#/messages'}]); el.className='';
  try {
    const msgs = await (await fetch('/api/messageboard')).json();
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <button class="btn btn-primary btn-sm" onclick="createMessage()">+ Ново съобщение</button>
        <h1 style="font-size:22px;font-weight:800;color:#fff;text-align:center;flex:1">Съобщения</h1>
        ${canManage()?'<button class="btn btn-sm" onclick="generateDailyReport()">\ud83d\udcca Дневен отчет</button>':'<div></div>'}
      </div>
      <div style="max-width:700px;margin:0 auto">
        ${msgs.map(m=>`<div class="message-item ${m.pinned?'pinned':''}"><div class="message-header"><strong>${esc(m.user_name||'Система')}</strong><span class="badge">${esc(m.category)}</span>${m.pinned?'<span class="badge badge-accent">📌</span>':''}<span class="hint">${timeAgo(m.created_at)}</span></div><h3>${esc(m.title)}</h3><div class="message-content">${esc(m.content||'').replace(/\n/g,'<br>')}</div></div>`).join('')}
        ${msgs.length===0?'<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма съобщения все още</div>':''}
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
async function createMessage() {
  const t=prompt('Заглавие:'); if(!t?.trim())return;
  const c=prompt('Съдържание:');
  try { await fetch('/api/messageboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t,content:c})}); router(); } catch {}
}
async function generateDailyReport() {
  try { await fetch('/api/messageboard/daily-report',{method:'POST'}); router(); } catch {}
}

// ==================== VAULT ====================
async function renderVault(el, folderId) {
  setBreadcrumb([{label:'Video Production',href:'#/project/1'},{label:'Документи',href:'#/vault'}]); el.className='';
  try {
    const url = folderId ? `/api/vault/folders?parent_id=${folderId}` : '/api/vault/folders';
    const { folders, files } = await (await fetch(url)).json();
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <button class="btn btn-primary btn-sm" onclick="createVaultFolder(${folderId||'null'})">+ Ново...</button>
        <h1 style="font-size:22px;font-weight:800;color:#fff;text-align:center;flex:1">Документи</h1>
        <label class="btn btn-sm" style="cursor:pointer">\ud83d\udcce Качи<input type="file" style="display:none" onchange="uploadVaultFile(this,${folderId||'null'})"></label>
      </div>
      ${folderId?'<a href="#/vault" class="btn btn-sm" style="margin-bottom:16px;display:inline-flex">\u2190 Назад</a>':''}
      <div class="vault-grid">
        ${folders.map(f=>`<a class="vault-item folder" href="#/vault/${f.id}"><span class="vault-icon">📁</span><span class="vault-name">${esc(f.name)}</span></a>`).join('')}
        ${files.map(f=>`<div class="vault-item file"><a href="${f.storage_path}" target="_blank" class="vault-icon">${getFileIcon(f.mime_type)}</a><span class="vault-name">${esc(f.original_name)}</span><span class="hint">${formatFileSize(f.size_bytes)}</span></div>`).join('')}
        ${folders.length===0&&files.length===0?'<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-dim)">Празна папка</div>':''}
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
async function createVaultFolder(pid) { const n=prompt('Име на папка:'); if(!n?.trim())return; try { await fetch('/api/vault/folders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,parent_id:pid})}); router(); } catch {} }
async function uploadVaultFile(input,fid) { if(!input.files[0])return; const f=new FormData(); f.append('file',input.files[0]); if(fid)f.append('folder_id',fid); try { await fetch('/api/vault/upload',{method:'POST',body:f}); router(); } catch {} }
function getFileIcon(m) { if(m?.startsWith('image/'))return'🖼️'; if(m?.startsWith('video/'))return'🎬'; if(m?.includes('pdf'))return'📄'; return'📎'; }
function formatFileSize(b) { if(!b)return''; if(b<1024)return b+' B'; if(b<1048576)return(b/1024).toFixed(1)+' KB'; return(b/1048576).toFixed(1)+' MB'; }

// ==================== CAMPFIRE (Group Chat) ====================
async function renderCampfire(el, roomId) {
  setBreadcrumb([{label:'Video Production',href:'#/project/1'},{label:'Campfire',href:`#/campfire/${roomId}`}]);
  el.className = '';
  try {
    const msgs = await (await fetch(`/api/campfire/rooms/${roomId}/messages?limit=100`)).json();
    const campColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
    el.innerHTML = `
      <div class="chat-page">
        <div class="chat-header">
          <span style="font-size:24px">🔥</span>
          <h2>Campfire</h2>
          <span style="color:var(--text-dim);font-size:12px;margin-left:auto">${onlineUsers.size} онлайн</span>
        </div>
        <div class="chat-messages" id="campfireMessages">
          ${msgs.length === 0 ? '<div style="text-align:center;color:var(--text-dim);padding:40px">🔥 Добре дошли в Campfire!<br>Тук целият екип може да говори.</div>' : ''}
          ${msgs.map(m => {
            const mc = campColors[(m.user_name||'').length % campColors.length];
            return `<div class="chat-msg">
              <div class="chat-msg-avatar" style="background:${mc};color:#fff">${initials(m.user_name)}</div>
              <div class="chat-msg-body">
                <div class="chat-msg-name">${esc(m.user_name)} <span class="hint">${new Date(m.created_at).toLocaleTimeString('bg',{hour:'2-digit',minute:'2-digit'})}</span></div>
                <div class="chat-msg-text">${esc(m.content).replace(/\n/g,'<br>')}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
        <div id="campfireTyping" style="font-size:11px;color:var(--text-dim);padding:0 4px;min-height:18px"></div>
        <div class="chat-input-row">
          <textarea id="campfireInput" placeholder="Напиши на екипа..." rows="2"
            oninput="sendTypingIndicator('campfire',${roomId})"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendCampfireMsg(${roomId})}"></textarea>
          <button class="btn btn-primary" onclick="sendCampfireMsg(${roomId})">Изпрати</button>
        </div>
      </div>`;
    const m = document.getElementById('campfireMessages'); if(m) m.scrollTop = m.scrollHeight;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка при зареждане</div>'; }
}
async function sendCampfireMsg(roomId) {
  const i = document.getElementById('campfireInput'), c = i?.value?.trim(); if(!c) return;
  try { await fetch(`/api/campfire/rooms/${roomId}/messages`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:c})}); i.value=''; router(); } catch {}
}
function sendTypingIndicator(type, id) {
  if (!ws || ws.readyState !== 1) return;
  clearTimeout(typingTimeout);
  const key = type === 'campfire' ? 'roomId' : 'channelId';
  ws.send(JSON.stringify({type:'typing:start', [key]: id}));
  typingTimeout = setTimeout(() => {
    if (ws?.readyState === 1) ws.send(JSON.stringify({type:'typing:stop', [key]: id}));
  }, 2000);
}

// ==================== SCHEDULE / CALENDAR ====================
async function renderSchedule(el) {
  setBreadcrumb([{label:'Video Production',href:'#/project/1'},{label:'График',href:'#/schedule'}]);
  el.className = '';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const now = new Date();
  const year = parseInt(params.get('y')) || now.getFullYear();
  const month = parseInt(params.get('m')) || now.getMonth();
  const monthStr = `${year}-${String(month+1).padStart(2,'0')}`;

  try {
    const events = await (await fetch(`/api/schedule?month=${monthStr}`)).json();
    const monthName = new Date(year, month).toLocaleDateString('bg', {month:'long', year:'numeric'});
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = now.getDate();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
    const dayNames = ['НД','ПН','ВТ','СР','ЧТ','ПТ','СБ'];

    const prevM = month === 0 ? 11 : month - 1;
    const prevY = month === 0 ? year - 1 : year;
    const nextM = month === 11 ? 0 : month + 1;
    const nextY = month === 11 ? year + 1 : year;

    // Build day cells
    let cells = '';
    for (let i = 0; i < firstDay; i++) cells += '<div class="schedule-day schedule-day--empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayEvents = events.filter(e => e.starts_at?.startsWith(dateStr));
      const isToday = isCurrentMonth && d === today;
      cells += `<div class="schedule-day ${isToday ? 'schedule-day--today' : ''} ${dayEvents.length ? 'schedule-day--has-events' : ''}">
        <div class="schedule-day__num">${d}</div>
        ${dayEvents.slice(0,3).map(e => `<div class="schedule-event" style="background:${e.color || 'var(--accent-dim)'}; color:${e.color ? '#fff' : 'var(--accent)'}" title="${esc(e.title)}">${esc(e.title)}</div>`).join('')}
        ${dayEvents.length > 3 ? `<div class="schedule-event-more">+${dayEvents.length - 3} още</div>` : ''}
      </div>`;
    }

    el.innerHTML = `
      <div style="max-width:900px;margin:0 auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
          <button class="btn btn-sm" onclick="location.hash='#/schedule?y=${prevY}&m=${prevM}'">&larr; Предишен</button>
          <h1 style="font-size:22px;font-weight:800;color:#fff;text-transform:capitalize">${monthName}</h1>
          <div style="display:flex;gap:8px">
            ${canManage() ? '<button class="btn btn-primary btn-sm" onclick="createScheduleEvent()">+ Събитие</button>' : ''}
            <button class="btn btn-sm" onclick="location.hash='#/schedule?y=${nextY}&m=${nextM}'">Следващ &rarr;</button>
          </div>
        </div>
        <div class="schedule-calendar">
          <div class="schedule-header">${dayNames.map(d => `<div class="schedule-header__day">${d}</div>`).join('')}</div>
          <div class="schedule-grid">${cells}</div>
        </div>
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
async function createScheduleEvent() {
  const title = prompt('Заглавие на събитието:'); if(!title?.trim()) return;
  const dateStr = prompt('Дата (YYYY-MM-DD):', new Date().toISOString().split('T')[0]); if(!dateStr) return;
  try { await fetch('/api/schedule', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:title.trim(),starts_at:dateStr+'T09:00:00',all_day:true})}); router(); } catch {}
}

// ==================== AUTOMATIC CHECK-INS ====================
async function renderCheckins(el) {
  setBreadcrumb([{label:'Video Production',href:'#/project/1'},{label:'Check-ins',href:'#/checkins'}]);
  el.className = '';
  try {
    const [questions, pending] = await Promise.all([
      (await fetch('/api/checkins/questions')).json(),
      (await fetch('/api/checkins/my-pending')).json()
    ]);

    el.innerHTML = `
      <div style="max-width:700px;margin:0 auto">
        <div class="page-header">
          <h1>✋ Check-ins</h1>
          <p class="page-subtitle">Автоматични въпроси към екипа</p>
        </div>

        ${pending.length > 0 ? `
          <div style="margin-bottom:32px">
            <h2 style="font-size:16px;font-weight:700;color:var(--yellow);margin-bottom:16px">📝 Чакат твоя отговор</h2>
            ${pending.map(q => `
              <div class="checkin-question">
                <div class="checkin-question__text">${esc(q.question)}</div>
                <div class="checkin-response-form">
                  <textarea id="checkinResponse${q.id}" placeholder="Твоят отговор..." rows="3"></textarea>
                  <button class="btn btn-primary btn-sm" onclick="submitCheckinResponse(${q.id})">Изпрати</button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<div style="text-align:center;padding:20px;color:var(--green);margin-bottom:24px">✅ Нямаш чакащи check-ins!</div>'}

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="font-size:16px;font-weight:700;color:#fff">Всички въпроси</h2>
          ${canManage() ? '<button class="btn btn-primary btn-sm" onclick="createCheckinQuestion()">+ Нов въпрос</button>' : ''}
        </div>
        <div class="checkin-list">
          ${questions.length === 0 ? '<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма конфигурирани check-in въпроси.</div>' :
            questions.map(q => `
              <div class="checkin-question" onclick="viewCheckinResponses(${q.id})" style="cursor:pointer">
                <div class="checkin-question__text">${esc(q.question)}</div>
                <div style="font-size:11px;color:var(--text-dim);margin-top:4px">Cron: ${esc(q.schedule_cron)} · ${q.is_active ? '<span style="color:var(--green)">Активен</span>' : '<span style="color:var(--red)">Неактивен</span>'}</div>
              </div>
            `).join('')}
        </div>
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
async function submitCheckinResponse(questionId) {
  const c = document.getElementById(`checkinResponse${questionId}`)?.value?.trim(); if(!c) return;
  try { await fetch(`/api/checkins/questions/${questionId}/responses`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:c})}); router(); } catch {}
}
async function createCheckinQuestion() {
  const q = prompt('Въпрос (напр. "Какво свърши днес?"):'); if(!q?.trim()) return;
  const cron = prompt('Cron израз (по подразбиране: всеки делничен ден в 9:00):', '0 9 * * 1-5');
  try { await fetch('/api/checkins/questions', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q.trim(),schedule_cron:cron||'0 9 * * 1-5'})}); router(); } catch {}
}
async function viewCheckinResponses(questionId) {
  try {
    const responses = await (await fetch(`/api/checkins/questions/${questionId}/responses`)).json();
    const campColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308'];
    alert(responses.length === 0 ? 'Няма отговори все още.' :
      responses.map(r => `${r.user_name}: ${r.content}`).join('\n\n'));
  } catch {}
}

// ==================== ADMIN PANEL ====================
async function renderAdmin(el) {
  if (currentUser?.role !== 'admin') { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--red)">Нямаш достъп до тази страница.</div>'; return; }
  setBreadcrumb(null); el.className = '';
  try {
    const users = await (await fetch('/api/users')).json();
    el.innerHTML = `
      <div style="max-width:900px;margin:0 auto">
        <div class="page-header">
          <h1>⚙️ Админ панел</h1>
        </div>

        <div style="display:flex;gap:8px;justify-content:center;margin-bottom:24px">
          <button class="btn btn-sm admin-tab active" onclick="showAdminTab('users',this)">👤 Потребители</button>
          <button class="btn btn-sm admin-tab" onclick="showAdminTab('boards',this)">📋 Бордове</button>
          <button class="btn btn-sm admin-tab" onclick="showAdminTab('settings',this)">⚙️ Настройки</button>
        </div>

        <div id="adminContent">
          <div id="adminUsers">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
              <h2 style="font-size:16px;font-weight:700;color:#fff">Потребители (${users.length})</h2>
              <button class="btn btn-primary btn-sm" onclick="createNewUser()">+ Нов потребител</button>
            </div>
            <table class="admin-table">
              <thead><tr><th>Име</th><th>Email</th><th>Роля</th><th>Статус</th><th>Действия</th></tr></thead>
              <tbody>
                ${users.map(u => `<tr>
                  <td><strong>${esc(u.name)}</strong></td>
                  <td style="color:var(--text-dim)">${esc(u.email)}</td>
                  <td><select class="input-sm" onchange="changeUserRole(${u.id},this.value)" style="padding:2px 6px;font-size:11px">
                    <option value="member" ${u.role==='member'?'selected':''}>Член</option>
                    <option value="moderator" ${u.role==='moderator'?'selected':''}>Модератор</option>
                    <option value="admin" ${u.role==='admin'?'selected':''}>Админ</option>
                  </select></td>
                  <td>${u.is_active ? '<span style="color:var(--green)">●</span> Активен' : '<span style="color:var(--red)">●</span> Неактивен'}</td>
                  <td><button class="btn btn-sm" onclick="toggleUserActive(${u.id},${!u.is_active})">${u.is_active ? 'Деактивирай' : 'Активирай'}</button></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div id="adminBoards" style="display:none">
            <h2 style="font-size:16px;font-weight:700;color:#fff;margin-bottom:16px">Бордове</h2>
            <div class="task-list">
              ${allBoards.map(b => `<div class="task-row"><span class="task-title">${esc(b.title)}</span><span class="task-meta">${b.columns?.length || 0} колони</span></div>`).join('')}
            </div>
          </div>
          <div id="adminSettings" style="display:none">
            <h2 style="font-size:16px;font-weight:700;color:#fff;margin-bottom:16px">Настройки</h2>
            <div style="color:var(--text-dim);text-align:center;padding:40px">Настройките ще бъдат добавени скоро.</div>
          </div>
        </div>
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
function showAdminTab(tab, btn) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  btn?.classList.add('active');
  ['Users','Boards','Settings'].forEach(t => {
    const el = document.getElementById('admin'+t);
    if (el) el.style.display = t.toLowerCase() === tab ? 'block' : 'none';
  });
}
async function createNewUser() {
  const name = prompt('Име:'); if(!name?.trim()) return;
  const email = prompt('Email:'); if(!email?.trim()) return;
  const password = prompt('Парола:'); if(!password?.trim()) return;
  try { await fetch('/api/users', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim(),email:email.trim(),password})}); router(); } catch {}
}
async function changeUserRole(userId, role) {
  try { await fetch(`/api/users/${userId}/role`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})}); } catch {}
}
async function toggleUserActive(userId, active) {
  try { await fetch(`/api/users/${userId}/active`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_active:active})}); router(); } catch {}
}

// ==================== REPORTS ====================
async function renderReports(el) {
  setBreadcrumb(null); el.className = '';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const tab = params.get('tab') || 'overdue';

  try {
    let data;
    if (tab === 'overdue') data = await (await fetch('/api/reports/overdue')).json();
    else if (tab === 'upcoming') data = await (await fetch('/api/reports/upcoming?days=7')).json();
    else if (tab === 'assignments') data = await (await fetch('/api/reports/assignments')).json();
    else data = await (await fetch('/api/reports/unassigned')).json();

    el.innerHTML = `
      <div style="max-width:800px;margin:0 auto">
        <div class="page-header"><h1>📊 Отчети</h1></div>
        <div style="display:flex;gap:8px;justify-content:center;margin-bottom:24px">
          <a href="#/reports?tab=overdue" class="btn btn-sm ${tab==='overdue'?'btn-primary':''}">🔴 Просрочени</a>
          <a href="#/reports?tab=upcoming" class="btn btn-sm ${tab==='upcoming'?'btn-primary':''}">🟡 Предстоящи</a>
          <a href="#/reports?tab=assignments" class="btn btn-sm ${tab==='assignments'?'btn-primary':''}">👤 По хора</a>
          <a href="#/reports?tab=unassigned" class="btn btn-sm ${tab==='unassigned'?'btn-primary':''}">❓ Невъзложени</a>
        </div>
        <div class="task-list">
          ${data.length === 0 ? '<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма резултати</div>' :
            data.map(c => `
              <a class="task-row ${c.due_on && new Date(c.due_on) < new Date() ? 'overdue' : ''}" href="#/card/${c.id}">
                <span class="task-title">${esc(c.title)}</span>
                <span class="task-meta">
                  ${c.due_on ? `<span class="task-due">${formatDate(c.due_on)}</span>` : ''}
                  ${c.board_title ? `<span class="task-board">${esc(c.board_title)}</span>` : ''}
                  ${c.assignee_name ? `<span style="color:var(--accent)">${esc(c.assignee_name)}</span>` : ''}
                </span>
              </a>`).join('')}
        </div>
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

// ==================== BOOKMARKS ====================
async function renderBookmarks(el) {
  setBreadcrumb(null); el.className = '';
  try {
    const bookmarks = await (await fetch('/api/bookmarks')).json();
    el.innerHTML = `
      <div style="max-width:700px;margin:0 auto">
        <div class="page-header"><h1>⚑ Отметки</h1></div>
        <div class="task-list">
          ${bookmarks.length === 0 ? '<div style="text-align:center;padding:40px;color:var(--text-dim)"><div style="font-size:48px;opacity:0.3;margin-bottom:8px">⚑</div>Нямаш запазени отметки.<br>Натисни ⚑ на карта за да я добавиш тук.</div>' :
            bookmarks.map(b => `
              <div class="task-row" style="justify-content:space-between">
                <a href="${b.target_type === 'card' ? `#/card/${b.target_id}` : '#'}" class="task-title" style="text-decoration:none;color:var(--text)">${esc(b.title || 'Без заглавие')}</a>
                <div class="task-meta">
                  <span class="task-board">${esc(b.target_type)}</span>
                  <button class="btn btn-sm" onclick="removeBookmark(${b.id})" style="color:var(--red)">✕</button>
                </div>
              </div>`).join('')}
        </div>
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
async function toggleBookmark(type, id, title) {
  try {
    const bookmarks = await (await fetch('/api/bookmarks')).json();
    const existing = bookmarks.find(b => b.target_type === type && b.target_id === id);
    if (existing) {
      await fetch(`/api/bookmarks/${existing.id}`, {method:'DELETE'});
    } else {
      await fetch('/api/bookmarks', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target_type:type,target_id:id,title})});
    }
    router();
  } catch {}
}
async function removeBookmark(id) {
  try { await fetch(`/api/bookmarks/${id}`, {method:'DELETE'}); router(); } catch {}
}

// ==================== DONE SIDEBAR (Expanded) ====================
function showDoneCards(doneCards, boardId) {
  const existing = document.getElementById('doneSidebarPanel');
  if (existing) { existing.remove(); return; }
  const panel = document.createElement('div');
  panel.id = 'doneSidebarPanel';
  panel.className = 'done-sidebar-panel';
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border)">
      <h3 style="font-size:14px;font-weight:700;color:var(--green)">✓ Завършени карти (${doneCards.length})</h3>
      <button class="btn btn-sm" onclick="document.getElementById('doneSidebarPanel').remove()">✕</button>
    </div>
    <div style="padding:8px;overflow-y:auto;max-height:calc(100vh - 250px)">
      ${doneCards.map(c => `<a class="kanban-card" href="#/card/${c.id}" style="opacity:0.7;border-left:3px solid var(--green)">
        <div class="kanban-card__content"><h3 class="kanban-card__title">${esc(c.title)}</h3>
        <div class="kanban-card__meta">${c.completed_at ? 'Завършена ' + formatDate(c.completed_at) : ''}</div></div>
      </a>`).join('')}
      ${doneCards.length === 0 ? '<div style="text-align:center;padding:20px;color:var(--text-dim)">Няма завършени карти</div>' : ''}
    </div>`;
  document.querySelector('.board-kanban')?.appendChild(panel);
}

// ==================== COLUMN/BOARD MGMT ====================
async function promptAddColumn(bid) { const t=prompt('Име на колона:'); if(!t?.trim())return; try { await fetch(`/api/boards/${bid}/columns`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t.trim()})}); allBoards=await(await fetch('/api/boards')).json(); router(); } catch {} }
function editColumnTitle(bid,cid,el) { const cur=el.textContent; el.contentEditable=true; el.focus(); const save=async()=>{ el.contentEditable=false; const t=el.textContent.trim(); if(t&&t!==cur){ try{await fetch(`/api/boards/${bid}/columns/${cid}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t})})}catch{} } else el.textContent=cur; }; el.onblur=save; el.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();el.blur()}if(e.key==='Escape'){el.textContent=cur;el.blur()}}; }
function showColMenu(e,bid,cid) { e.stopPropagation(); document.querySelectorAll('.col-context-menu').forEach(m=>m.remove()); const menu=document.createElement('div'); menu.className='col-context-menu'; menu.innerHTML=`<button onclick="promptRenameColumn(${bid},${cid});this.parentElement.remove()">\u270e Преименувай</button><button onclick="deleteColumn(${bid},${cid});this.parentElement.remove()">\ud83d\uddd1 Изтрий</button>`; e.target.closest('.column-header-right').appendChild(menu); setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),10); }
async function promptRenameColumn(bid,cid) { const t=prompt('Ново име:'); if(!t?.trim())return; try{await fetch(`/api/boards/${bid}/columns/${cid}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t.trim()})}); allBoards=await(await fetch('/api/boards')).json(); router();}catch{} }
async function deleteColumn(bid,cid) { if(!confirm('Изтрий колона и всички карти в нея?'))return; try{await fetch(`/api/boards/${bid}/columns/${cid}`,{method:'DELETE'}); allBoards=await(await fetch('/api/boards')).json(); router();}catch{} }
function toggleBoardMenu(e,bid,cid) { /* TODO: full board menu */ }

// ==================== DRAG & DROP ====================
let dragCardId = null;
function handleDragStart(e) { dragCardId=e.currentTarget.dataset.cardId; e.currentTarget.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; }
function handleDragEnd(e) { e.currentTarget.classList.remove('dragging'); dragCardId=null; }
function handleDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
async function handleDrop(e) { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); if(!dragCardId)return; try{await fetch(`/api/cards/${dragCardId}/move`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({column_id:parseInt(e.currentTarget.dataset.columnId),board_id:parseInt(e.currentTarget.dataset.boardId)})}); router();}catch{} }

// ==================== PROFILE ====================
async function openProfile() { const m=document.getElementById('profileModal'); m.style.display='flex'; try{ const u=await(await fetch('/api/profile')).json(); const av=document.getElementById('profileAvatar'); if(u.avatar_url)av.innerHTML=`<img src="${u.avatar_url}" style="width:100%;height:100%;object-fit:cover">`; else av.textContent=initials(u.name); document.getElementById('profileName').textContent=u.name; document.getElementById('profileEmail').textContent=u.email; document.getElementById('profileRole').innerHTML=u.role==='admin'?'<span class="badge badge-accent">АДМИН</span>':u.role==='moderator'?'<span class="badge badge-blue">МОДЕРАТОР</span>':'<span class="badge">ЧЛЕН</span>'; document.getElementById('profileNameInput').value=u.name; }catch{} }
function closeProfile() { document.getElementById('profileModal').style.display='none'; }
async function saveProfileName() { const n=document.getElementById('profileNameInput').value.trim(); if(!n)return; try{const u=await(await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n})})).json(); document.getElementById('profileName').textContent=u.name; document.getElementById('navAvatar').textContent=initials(u.name);}catch{} }
async function uploadAvatar(input) { if(!input.files[0])return; const f=new FormData(); f.append('avatar',input.files[0]); try{const u=await(await fetch('/api/profile/avatar',{method:'POST',body:f})).json(); document.getElementById('profileAvatar').innerHTML=`<img src="${u.avatar_url}" style="width:100%;height:100%;object-fit:cover">`;}catch{} }
async function changePassword() { const msg=document.getElementById('pwdMsg'),c=document.getElementById('currentPwd').value,n=document.getElementById('newPwd').value; if(!c||!n){msg.textContent='Попълни и двете полета';msg.style.color='var(--red)';return;} try{const r=await fetch('/api/profile/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:c,newPassword:n})}); const d=await r.json(); if(r.ok){msg.textContent='Сменена';msg.style.color='var(--green)';}else{msg.textContent=d.error;msg.style.color='var(--red)';}}catch{msg.textContent='Грешка';msg.style.color='var(--red)';} }
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeProfile()});
document.getElementById('profileModal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeProfile()});

// ==================== WEBSOCKET ====================
function connectWS() { const p=location.protocol==='https:'?'wss':'ws'; ws=new WebSocket(`${p}://${location.host}/ws`); ws.onopen=()=>{wsReconnectDelay=1000;document.getElementById('wsStatusDot').className='status-dot online';document.getElementById('wsStatus').textContent='live'}; ws.onmessage=e=>{try{handleWSEvent(JSON.parse(e.data))}catch{}}; ws.onclose=()=>{document.getElementById('wsStatusDot').className='status-dot offline';document.getElementById('wsStatus').textContent='';setTimeout(connectWS,wsReconnectDelay);wsReconnectDelay=Math.min(wsReconnectDelay*2,30000)}; ws.onerror=()=>ws.close(); }
let _wsRouterTimeout = null;
function wsRouter() {
  // Debounce WS-triggered re-renders to avoid double refresh
  clearTimeout(_wsRouterTimeout);
  _wsRouterTimeout = setTimeout(router, 150);
}
function handleWSEvent(ev) {
  const t = ev.type || '';
  // Core data events — re-render current page
  if (t.startsWith('card:') || t.startsWith('board:') || t.startsWith('column:') || t.startsWith('step:') || t.startsWith('comment:')) wsRouter();
  if (t === 'chat:message' && location.hash.startsWith(`#/chat/${ev.channelId}`)) wsRouter();
  if (t === 'campfire:message' && location.hash.startsWith('#/campfire/')) wsRouter();
  if (t === 'checkin:reminder') wsRouter();
  // Presence
  if (t === 'presence:online') { onlineUsers.add(ev.userId); updatePresenceDots(); }
  if (t === 'presence:offline') { onlineUsers.delete(ev.userId); updatePresenceDots(); }
  // Typing indicators
  if (t === 'typing:start') showTypingIndicator(ev);
  if (t === 'typing:stop') hideTypingIndicator(ev);
  updateHeyBadge();
}
function updatePresenceDots() {
  document.querySelectorAll('[data-user-id]').forEach(el => {
    const dot = el.querySelector('.presence-dot');
    if (dot) dot.className = `presence-dot ${onlineUsers.has(parseInt(el.dataset.userId)) ? 'online' : ''}`;
  });
}
function showTypingIndicator(ev) {
  const el = document.getElementById('campfireTyping') || document.getElementById('chatTyping');
  if (el) el.textContent = `${ev.userName || 'Някой'} пише...`;
  clearTimeout(window._typingClearTimeout);
  window._typingClearTimeout = setTimeout(() => { if (el) el.textContent = ''; }, 3000);
}
function hideTypingIndicator(ev) {
  const el = document.getElementById('campfireTyping') || document.getElementById('chatTyping');
  if (el) el.textContent = '';
}

// ==================== UTILS ====================
function esc(s) { if(!s)return''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatDate(d) { if(!d)return''; const s=d.split('T')[0]; const[y,m,dd]=s.split('-'); return`${dd}.${m}.${y}`; }
function getCardColorClass(c) { if(c.is_on_hold)return'on-hold'; if(c.priority==='urgent')return'priority'; if(!c.due_on)return''; const n=new Date();n.setHours(0,0,0,0); const due=new Date(c.due_on+'T00:00:00'); const diff=Math.ceil((due-n)/86400000); if(diff<0)return'overdue'; if(diff===0)return'deadline-today'; if(diff<=4)return'deadline-soon'; return'deadline-ok'; }
function timeAgo(d) { const s=Math.floor((Date.now()-new Date(d))/1000); if(s<60)return'сега'; if(s<3600)return Math.floor(s/60)+'м'; if(s<86400)return Math.floor(s/3600)+'ч'; return Math.floor(s/86400)+'д назад'; }

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', (e) => {
  // Don't trigger shortcuts when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) return;

  // Ctrl/Cmd + J/K — open search
  if ((e.ctrlKey || e.metaKey) && (e.key === 'j' || e.key === 'k')) {
    e.preventDefault();
    toggleDropdown('findDropdown', document.querySelector('[data-nav="find"]'));
    return;
  }

  // ? — show shortcuts help
  if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    showShortcutsHelp();
    return;
  }

  // N — new card (only on board view)
  if (e.key === 'n' && location.hash.startsWith('#/board/')) {
    e.preventDefault();
    const boardId = parseInt(location.hash.split('/')[2]);
    const col = allBoards.find(b=>b.id===boardId)?.columns?.find(c=>!c.is_done_column);
    if (col) location.hash = `#/card/0/new?board=${boardId}&column=${col.id}`;
    return;
  }

  // G+key combos — navigate
  if (pendingShortcut === 'g') {
    pendingShortcut = null;
    e.preventDefault();
    if (e.key === 'h') location.hash = '#/home';
    else if (e.key === 'a') location.hash = '#/activity';
    else if (e.key === 'p') location.hash = '#/chat';
    else if (e.key === 'c') location.hash = '#/campfire/1';
    else if (e.key === 's') location.hash = '#/schedule';
    else if (e.key === 'r') location.hash = '#/reports';
    return;
  }
  if (e.key === 'g') { pendingShortcut = 'g'; setTimeout(() => { pendingShortcut = null; }, 1000); return; }

  // Escape — close modals/dropdowns
  if (e.key === 'Escape') {
    closeAllDropdowns();
    document.getElementById('doneSidebarPanel')?.remove();
    closeProfile();
  }
});

function showShortcutsHelp() {
  const existing = document.getElementById('shortcutsModal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'shortcutsModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:28px;max-width:480px;width:90%">
      <h2 style="font-size:18px;font-weight:800;color:#fff;margin-bottom:16px">⌨️ Клавишни комбинации</h2>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:13px">
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">Ctrl+J</kbd><span style="color:var(--text-secondary)">Бързо търсене</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">?</kbd><span style="color:var(--text-secondary)">Тази помощ</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">N</kbd><span style="color:var(--text-secondary)">Нова карта (в борд)</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">G → H</kbd><span style="color:var(--text-secondary)">Начало</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">G → A</kbd><span style="color:var(--text-secondary)">Активност</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">G → P</kbd><span style="color:var(--text-secondary)">Пингове</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">G → C</kbd><span style="color:var(--text-secondary)">Campfire</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">G → S</kbd><span style="color:var(--text-secondary)">График</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">G → R</kbd><span style="color:var(--text-secondary)">Отчети</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">Esc</kbd><span style="color:var(--text-secondary)">Затвори</span>
      </div>
      <button class="btn btn-sm" style="margin-top:16px" onclick="this.closest('#shortcutsModal').remove()">Затвори</button>
    </div>`;
  document.body.appendChild(modal);
}

// ==================== BOOKMARK ON CARD PAGE ====================
function addBookmarkToCardPage(cardId, cardTitle) {
  const toolbar = document.querySelector('.card-page__toolbar');
  if (!toolbar) return;
  const btn = document.createElement('button');
  btn.className = 'btn btn-sm';
  btn.style.marginRight = '8px';
  btn.textContent = '⚑ Запази';
  btn.onclick = () => toggleBookmark('card', cardId, cardTitle);
  toolbar.prepend(btn);
}

// ==================== INIT ====================
(async function() {
  if (!await checkAuth()) return;
  if (!location.hash || location.hash === '#' || location.hash === '#/') location.hash = '#/home';
  router();
  connectWS();
  // Fetch online users
  try { const ids = await (await fetch('/api/users/online')).json(); ids.forEach(id => onlineUsers.add(id)); } catch {}
})();
