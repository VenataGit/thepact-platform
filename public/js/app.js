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
function canEdit() { return !!currentUser; }
async function logout() { await fetch('/auth/logout', { method: 'POST' }); window.location.href = '/login.html'; }
function initials(name) { return name?.split(' ').map(n => n[0]).join('').substring(0, 2) || '?'; }

async function updateHeyBadge() {
  try {
    const { count } = await (await fetch('/api/notifications/unread-count')).json();
    const b = document.getElementById('heyBadge');
    if (count > 0) { b.textContent = count > 99 ? '99+' : count; b.style.display = ''; } else b.style.display = 'none';
  } catch {}
}

// ==================== NAV DROPDOWNS ====================
let openDropdownId = null;
function toggleDropdown(id, btn, e) {
  if (e) e.stopPropagation();
  const dd = document.getElementById(id);
  if (openDropdownId === id) { closeAllDropdowns(); return; }
  closeAllDropdowns();
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
    const unreadCount = items.filter(n => !n.is_read).length;

    if (items.length === 0) {
      el.innerHTML = '<div class="nav-dropdown__empty" style="padding:24px 16px">Няма нищо ново за теб.</div>';
      return;
    }

    const headerHtml = `<div class="hey-header">
      <span class="hey-header__title">Ново за теб${unreadCount > 0 ? ` (${unreadCount})` : ''}</span>
      ${unreadCount > 0 ? `<button class="hey-header__action" onclick="markAllHeyRead(event)">Маркирай всички</button>` : ''}
    </div>`;

    const itemsHtml = items.slice(0, 15).map(n => {
      const senderName = n.sender_name || '';
      const av = senderName ? initials(senderName) : '?';
      const link = n.reference_type === 'card' ? `#/card/${n.reference_id}` : '#/notifications';
      const scrollId = (n.reference_type === 'card' && n.comment_id) ? n.comment_id : null;
      return `<a class="hey-item${n.is_read ? '' : ' unread'}" href="${link}" onclick="if(${scrollId}){_pendingScrollCommentId=${scrollId};}closeAllDropdowns()">
        <div class="hey-item__av">${av}</div>
        <div class="hey-item__content">
          <div class="hey-item__subject">${esc(n.title)}</div>
          ${n.body ? `<div class="hey-item__preview">${esc(n.body)}</div>` : ''}
          <div class="hey-item__meta">${timeAgo(n.created_at)}</div>
        </div>
        ${!n.is_read ? '<div class="hey-item__unread-dot"></div>' : ''}
      </a>`;
    }).join('');

    const footerHtml = `<a class="hey-item" href="#/notifications" onclick="closeAllDropdowns()" style="justify-content:center">
      <div class="hey-item__content" style="text-align:center;color:var(--accent);padding:2px 0;flex:unset">Виж всички известия →</div>
    </a>`;

    el.innerHTML = headerHtml + itemsHtml + footerHtml;
  } catch { el.innerHTML = '<div class="nav-dropdown__empty">Грешка</div>'; }
}

async function markAllHeyRead(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  try {
    await fetch('/api/notifications/read-all', { method: 'PUT' });
    updateHeyBadge();
    const dd = document.getElementById('heyDropdown');
    if (dd?.classList.contains('open')) populateHey(dd);
  } catch {}
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
    case 'kp-auto': return renderKpAuto(el);
    case 'calendar': return renderCalendar(el);
    case 'column': return id ? renderColumnView(el, id) : renderHome(el);
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
    const now = new Date(); now.setHours(0,0,0,0);
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const now14 = new Date(now); now14.setDate(now14.getDate() + 14);
    const activeCards = cards.filter(c => !c.completed_at && !c.archived_at);
    const myCards = activeCards.filter(c => c.assignees?.some(a => a.id === currentUser.id));
    const overdueCards = activeCards.filter(c => c.due_on && new Date(c.due_on+'T00:00:00') < now);
    const myOverdue = myCards.filter(c => c.due_on && new Date(c.due_on+'T00:00:00') < now);
    const todayCards = activeCards.filter(c => c.due_on && new Date(c.due_on+'T00:00:00') >= now && new Date(c.due_on+'T00:00:00') < tomorrow);
    const urgentCards = activeCards.filter(c => c.priority === 'urgent');
    const myUpcoming = myCards
      .filter(c => c.due_on && new Date(c.due_on+'T00:00:00') <= now14)
      .sort((a, b) => new Date(a.due_on) - new Date(b.due_on))
      .slice(0, 8);
    const avatarColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];

    el.innerHTML = `
      <div style="max-width:820px;margin:0 auto">
        <div style="text-align:center;margin-bottom:28px;padding-top:8px">
          <img src="/img/logo-white.svg" alt="The Pact" style="height:44px;margin-bottom:6px">
        </div>

        <!-- Stats bar -->
        <div style="display:flex;gap:12px;justify-content:center;margin-bottom:32px;flex-wrap:wrap">
          <a href="#/mystuff" style="text-decoration:none">
            <div class="dash-stat" style="min-width:110px;cursor:pointer">
              <span class="dash-stat__num">${myCards.length}</span>
              <span class="dash-stat__label">Мои задачи</span>
            </div>
          </a>
          <a href="#/mystuff" style="text-decoration:none">
            <div class="dash-stat ${myOverdue.length > 0 ? 'dash-stat--warn' : ''}" style="min-width:110px;cursor:pointer">
              <span class="dash-stat__num">${myOverdue.length}</span>
              <span class="dash-stat__label">Мои просрочени</span>
            </div>
          </a>
          <a href="#/reports?tab=overdue" style="text-decoration:none">
            <div class="dash-stat ${overdueCards.length > 0 ? 'dash-stat--warn' : ''}" style="min-width:110px;cursor:pointer">
              <span class="dash-stat__num">${overdueCards.length}</span>
              <span class="dash-stat__label">Просрочени общо</span>
            </div>
          </a>
          <a href="#/reports?tab=upcoming&days=1" style="text-decoration:none">
            <div class="dash-stat ${todayCards.length > 0 ? 'dash-stat--warn' : ''}" style="min-width:110px;cursor:pointer">
              <span class="dash-stat__num">${todayCards.length}</span>
              <span class="dash-stat__label">\u0414\u043d\u0435\u0441 \u0435 \u043a\u0440\u0430\u0439\u043d\u0438\u044f\u0442 \u0441\u0440\u043e\u043a</span>
            </div>
          </a>
          ${urgentCards.length > 0 ? `<a href="#/reports?tab=overdue" style="text-decoration:none">
            <div class="dash-stat dash-stat--warn" style="min-width:110px;cursor:pointer">
              <span class="dash-stat__num">${urgentCards.length}</span>
              <span class="dash-stat__label">\ud83d\udd34 \u0421\u043f\u0435\u0448\u043d\u0438</span>
            </div>
          </a>` : ''}
          <a href="#/dashboard" style="text-decoration:none">
            <div class="dash-stat" style="min-width:110px;cursor:pointer">
              <span class="dash-stat__num">${boards.length}</span>
              <span class="dash-stat__label">\u0411\u043e\u0440\u0434\u0430</span>
            </div>
          </a>
        </div>

        <!-- Boards grid -->
        <div style="margin-bottom:32px">
          <div style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Проекти</div>
          <div class="projects-home-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">
            ${boards.map(b => {
              const bc = activeCards.filter(c => c.board_id === b.id);
              const bOver = bc.filter(c => c.due_on && new Date(c.due_on+'T00:00:00') < now).length;
              return '<a href="#/board/' + b.id + '" class="project-card-home" style="padding:16px 20px">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">' +
                  '<div class="project-card-home__title" style="font-size:15px;margin:0">' + esc(b.title) + '</div>' +
                  (bOver > 0 ? '<span style="background:rgba(239,68,68,.2);color:var(--red);font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px">⚠ ' + bOver + '</span>' : '') +
                '</div>' +
                '<div style="font-size:12px;color:var(--text-dim)">' + bc.length + ' карти · ' + (b.columns?.filter(c=>!c.is_done_column).length || 0) + ' колони</div>' +
              '</a>';
            }).join('')}
            ${canManage() ? '<div class="project-card-home" style="padding:16px 20px;cursor:pointer;border-style:dashed;opacity:0.5" onclick="promptCreateBoard()"><div class="project-card-home__title" style="font-size:14px;margin:0">+ Нов борд</div></div>' : ''}
          </div>
        </div>

        <!-- Quick access -->
        <div style="margin-bottom:32px">
          <div style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Бърз достъп</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <a href="#/dashboard" class="btn btn-sm">📊 Dashboard</a>
            <a href="#/calendar" class="btn btn-sm">📅 Календар</a>
            <a href="#/reports?tab=overdue" class="btn btn-sm">🔴 Просрочени</a>
            <a href="#/campfire/1" class="btn btn-sm">🔥 Campfire</a>
            <a href="#/tools/kp-auto" class="btn btn-sm">🤖 КП-Автоматизация</a>
            <a href="#/vault" class="btn btn-sm">📁 Документи</a>
          </div>
        </div>

        <!-- My upcoming tasks -->
        ${myUpcoming.length > 0 ? `
        <div style="margin-bottom:32px">
          <div style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">\u041c\u043e\u0438\u0442\u0435 \u043f\u0440\u0435\u0434\u0441\u0442\u043e\u044f\u0449\u0438</div>
          <div class="task-list" style="max-width:100%">
            ${myUpcoming.map(c => {
              const dueDate = new Date(c.due_on+'T00:00:00');
              const isOver = dueDate < now;
              const isToday = dueDate.getTime() === now.getTime();
              const dueLabel = isOver ? '<span style="color:var(--red);font-weight:600">\u26a0 ' + formatDate(c.due_on) + '</span>' : isToday ? '<span style="color:var(--yellow);font-weight:600">\u23f0 Днес</span>' : '<span>' + formatDate(c.due_on) + '</span>';
              const pri = c.priority === 'urgent' ? '\ud83d\udd34 ' : c.priority === 'high' ? '\u2191 ' : '';
              return '<a class="task-row ' + (isOver ? 'overdue' : '') + '" href="#/card/' + c.id + '" style="align-items:center">' +
                '<span class="task-title">' + pri + esc(c.title) + '</span>' +
                '<span class="task-meta">' +
                  (c.client_name ? '<span style="color:var(--accent)">' + esc(c.client_name) + '</span>' : '') +
                  dueLabel +
                '</span></a>';
            }).join('')}
          </div>
          <a href="#/mystuff" style="font-size:12px;color:var(--accent);text-decoration:none;display:inline-block;margin-top:8px">\u0412\u0441\u0438\u0447\u043a\u0438 \u043c\u043e\u0438 \u0437\u0430\u0434\u0430\u0447\u0438 \u2192</a>
        </div>` : ''}

        <!-- Team -->
        <div style="margin-bottom:32px">
          <div style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Екип</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${allUsers.map((u, i) => '<div style="display:flex;align-items:center;gap:8px;background:var(--card);border-radius:8px;padding:8px 12px">' +
              '<div style="width:30px;height:30px;border-radius:50%;background:' + avatarColors[i % avatarColors.length] + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">' + initials(u.name) + '</div>' +
              '<span style="font-size:13px;color:var(--text)">' + esc(u.name) + '</span>' +
            '</div>').join('')}
          </div>
        </div>

        <!-- Recent activity (lazy loaded) -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em">\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0430 \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442</div>
            <a href="#/activity" style="font-size:12px;color:var(--accent);text-decoration:none">\u0412\u0438\u0436 \u0432\u0441\u0438\u0447\u043a\u043e \u2192</a>
          </div>
          <div id="homeActivityFeed" style="color:var(--text-dim);font-size:13px;padding:16px;text-align:center">\u0417\u0430\u0440\u0435\u0436\u0434\u0430\u043d\u0435\u2026</div>
        </div>
      </div>
    `;
    // Lazy-load home activity after render
    setTimeout(loadHomeActivity, 0);
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

async function loadHomeActivity() {
  const container = document.getElementById('homeActivityFeed');
  if (!container) return;
  try {
    const items = await (await fetch('/api/activity?limit=6')).json();
    if (!Array.isArray(items) || items.length === 0) { container.textContent = '\u041d\u044f\u043c\u0430 \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442 \u0432\u0441\u0435 \u043e\u0449\u0435'; return; }
    const avColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
    const getAC = n => avColors[(n||'').length % avColors.length];
    const actLabel = a => { if(a.action==='created')return'\u0441\u044a\u0437\u0434\u0430\u0434\u0435'; if(a.action==='commented')return'\u043a\u043e\u043c\u0435\u043d\u0442\u0438\u0440\u0430'; if(a.action==='moved')return'\u043f\u0440\u0435\u043c\u0435\u0441\u0442\u0438'; if(a.action==='completed')return'\u0437\u0430\u0432\u044a\u0440\u0448\u0438'; if(a.action==='archived')return'\u0430\u0440\u0445\u0438\u0432\u0438\u0440\u0430'; return a.action; };
    container.style.textAlign = '';
    container.style.padding = '';
    container.innerHTML = items.map(a =>
      '<div class="activity-entry" style="margin-bottom:10px">' +
      '<div class="activity-avatar" style="background:' + getAC(a.user_name) + ';width:26px;height:26px;font-size:9px">' + initials(a.user_name||'') + '</div>' +
      '<div class="activity-body">' +
      '<div class="activity-text" style="font-size:13px"><strong>' + esc(a.user_name||'') + '</strong> ' + actLabel(a) + ' ' +
      (a.target_type==='card' ? '<a href="#/card/' + a.target_id + '">' + esc(a.target_title||'') + '</a>' : esc(a.target_title||'')) +
      '</div>' +
      '<div class="activity-meta">' + (a.board_title ? esc(a.board_title) + ' \u00b7 ' : '') + timeAgo(a.created_at) + '</div>' +
      '</div></div>'
    ).join('');
  } catch { if (container) container.textContent = ''; }
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
  setBreadcrumb([{ label: 'Начало', href: '#/home' }, { label: 'Dashboard', href: '#/dashboard' }]);
  el.className = 'full-width';
  try {
    const [boards, cards] = await Promise.all([
      (await fetch('/api/boards')).json(),
      (await fetch('/api/cards')).json()
    ]);
    allBoards = boards;
    _dashBoards = boards;
    _dashCards = cards;

    initDashDefaults(boards);

    const _nowMidnight = new Date(); _nowMidnight.setHours(0,0,0,0);
    const totalActive = cards.filter(c => !c.completed_at && !c.archived_at).length;
    const totalOnHold = cards.filter(c => c.is_on_hold).length;
    const totalOverdue = cards.filter(c => c.due_on && !c.is_on_hold && !c.completed_at && new Date(c.due_on+'T00:00:00') < _nowMidnight).length;

    el.innerHTML = '<div class="dash-wrap">' +
      '<div class="dash-stats-bar">' +
        '<div class="dash-stat"><span class="dash-stat__num">' + totalActive + '</span><span class="dash-stat__label">Активни</span></div>' +
        '<div class="dash-stat dash-stat--warn' + (totalOverdue > 0 ? ' dash-stat--clickable' : '') + '" id="dashOverdueStat" onclick="toggleDashOverdueFilter()" title="\u0424\u0438\u043b\u0442\u0440\u0438\u0440\u0430\u0439 \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u0438"><span class="dash-stat__num">' + totalOverdue + '</span><span class="dash-stat__label">\u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u0438</span></div>' +
        '<div class="dash-stat"><span class="dash-stat__num">' + totalOnHold + '</span><span class="dash-stat__label">Изчакване</span></div>' +
        '<div class="dash-stat"><span class="dash-stat__num">' + boards.length + '</span><span class="dash-stat__label">Борда</span></div>' +
        '<button class="dash-settings-btn" onclick="showDashSettings()" title="Настройки на Dashboard">⚙ Настройки</button>' +
      '</div>' +
      '<div class="dash-board" id="dashBoard"></div>' +
    '</div>';

    // Load + sync board timers
    try {
      var now = new Date(); now.setHours(0,0,0,0);
      var syncPayload = boards.map(function(board) {
        var boardCards = cards.filter(function(c) { return c.board_id === board.id && !c.completed_at && !c.archived_at; });
        var hasOverdue = boardCards.some(function(c) {
          return c.due_on && !c.is_on_hold && new Date(c.due_on) < now;
        });
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

    renderDashboardBoard(boards, cards, _dashStageColors);
  } catch (err) {
    console.error('Dashboard error:', err);
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка при зареждане</div>';
  }
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
  var assignee = card.assignees && card.assignees[0] ? card.assignees[0].name.split(' ')[0] : '';
  var stepsStr = card.steps_total > 0 ? card.steps_done + '/' + card.steps_total : '';
  var holdClass = card.is_on_hold ? ' dash-card--hold' : '';

  var nowDC = new Date(); nowDC.setHours(0,0,0,0);
  var dueDateDC = card.due_on ? new Date(card.due_on + 'T00:00:00') : null;
  var isDCOverdue = dueDateDC && dueDateDC < nowDC && !card.completed_at;
  var isDCToday = dueDateDC && dueDateDC.getTime() === nowDC.getTime();
  var dueStyle = isDCOverdue ? ' style="color:var(--red);font-weight:600"' : isDCToday ? ' style="color:var(--yellow);font-weight:600"' : '';
  var dueIcon = isDCOverdue ? '\u26a0 ' : isDCToday ? '\u23f0 ' : '\ud83d\udcc5 ';
  var dueStr = card.due_on ? formatDate(card.due_on) : '';

  var priIcon = card.priority === 'urgent' ? '\ud83d\udd34 ' : card.priority === 'high' ? '\u2191 ' : '';
  return '<a class="dash-card ' + colorClass + holdClass + '" href="#/card/' + card.id + '" draggable="true" data-card-id="' + card.id + '" ondragstart="handleDragStart(event)" ondragend="handleDashDragEnd(event)">' +
    '<div class="dash-card__title">' + (card.is_on_hold ? '\u23f8 ' : priIcon) + esc(card.title) + '</div>' +
    (card.client_name ? '<div class="dash-card__client">' + esc(card.client_name) + '</div>' : '') +
    '<div class="dash-card__footer">' +
      (dueStr ? '<span class="dash-card__date"' + dueStyle + '>' + dueIcon + dueStr + '</span>' : '<span></span>') +
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
  var due = new Date(card.due_on + 'T00:00:00');
  var diff = Math.ceil((due - now) / 86400000);
  if (diff < 0) return 'dash-card--overdue';
  if (diff === 0) return 'dash-card--today';
  if (diff <= 3) return 'dash-card--soon';
  return 'dash-card--ok';
}

function toggleDashCol(boardId) {
  expandedDashCol = expandedDashCol === boardId ? null : boardId;
  if (_dashBoards.length) { renderDashboardBoard(_dashBoards, _dashCards, _dashStageColors); return; }
  Promise.all([fetch('/api/boards').then(r=>r.json()), fetch('/api/cards').then(r=>r.json())])
    .then(res => { _dashBoards=res[0]; _dashCards=res[1]; renderDashboardBoard(res[0], res[1], _dashStageColors); });
}

function toggleDashSubCol(boardId, colId) {
  var key = boardId + '::' + colId;
  collapsedSubCols[key] = !collapsedSubCols[key];
  if (!collapsedSubCols[key]) delete collapsedSubCols[key];
  localStorage.setItem('thepact-collapsed-subcols', JSON.stringify(collapsedSubCols));
  if (_dashBoards.length) { renderDashboardBoard(_dashBoards, _dashCards, _dashStageColors); return; }
  Promise.all([fetch('/api/boards').then(r=>r.json()), fetch('/api/cards').then(r=>r.json())])
    .then(res => { _dashBoards=res[0]; _dashCards=res[1]; renderDashboardBoard(res[0], res[1], _dashStageColors); });
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
        <div style="font-size:13px;color:var(--text-dim)">Видео Продукция</div>
      </div>

      <div class="projects-home-grid" style="grid-template-columns:repeat(3, 1fr);max-width:900px">
        ${boards.map((board, bi) => {
          const now = new Date(); now.setHours(0,0,0,0);
          const bc = cards.filter(c => c.board_id === board.id && !c.completed_at && !c.archived_at);
          const overdue = bc.filter(c => c.due_on && new Date(c.due_on+'T00:00:00') < now).length;
          return '<a href="#/board/' + board.id + '" class="project-card-home">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
              '<div class="project-card-home__above">' + esc(board.title) + '</div>' +
              (overdue > 0 ? '<span style="background:rgba(239,68,68,.2);color:var(--red);font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px">⚠ ' + overdue + '</span>' : '') +
            '</div>' +
            '<div class="project-card-home__title" style="font-size:18px;margin-bottom:4px">' + bc.length + ' карти</div>' +
            '<div style="font-size:11px;color:var(--text-dim)">' + (board.columns?.filter(c=>!c.is_done_column).length || 0) + ' колони</div>' +
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
          <div class="project-card-home__above">Дейности</div>
          <div class="project-card-home__title" style="font-size:18px">✋ Въпроси</div>
        </a>

        <a href="#/chat" class="project-card-home">
          <div class="project-card-home__above">Чат</div>
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
              <div class="activity-text"><strong>${esc(a.user_name || '')}</strong> ${a.action === 'created' ? 'създаде' : a.action === 'commented' ? 'коментира' : a.action === 'moved' ? 'премести' : a.action === 'completed' ? 'завърши' : a.action === 'checked_off' ? 'отметна стъпка на' : a.action === 'archived' ? 'архивира' : a.action === 'updated' ? 'обнови' : a.action} ${a.target_type === 'card' ? `<a href="#/card/${a.target_id}">${esc(a.target_title || '')}</a>` : esc(a.target_title || '')}</div>
              <div class="activity-meta">${timeAgo(a.created_at)}</div>
            </div>
          </div>
        `).join('');
  } catch {}
}

function promptCreateBoard() {
  showPromptModal('\u041d\u043e\u0432 \u0431\u043e\u0440\u0434', '\u0412\u044a\u0432\u0435\u0434\u0438 \u0437\u0430\u0433\u043b\u0430\u0432\u0438\u0435\u2026', '', async function(title) {
    try { await fetch('/api/boards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title }) }); router(); } catch {}
  });
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
      { label: board.title }
    ]);

    const manage = canManage();
    const edit = canEdit();
    const visibleCols = board.columns.filter(c => !c.is_done_column);
    const doneCol = board.columns.find(c => c.is_done_column);
    const doneCards = doneCol ? cards.filter(c => c.column_id === doneCol.id) : [];
    const wColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308'];
    const nowB = new Date(); nowB.setHours(0,0,0,0);
    const boardOverdueCount = cards.filter(c => c.due_on && !c.is_on_hold && !c.completed_at && new Date(c.due_on+'T00:00:00') < nowB).length;

    el.innerHTML = `
      <div class="board-page-header">
        <h1 class="board-page-header__title">${esc(board.title)}</h1>
        <div class="board-page-header__actions">
          <input id="boardFilterInput" type="search" placeholder="Филтрирай карти..." style="background:var(--bg-hover);border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:12px;color:var(--text);width:160px;outline:none" oninput="filterBoardCards(this.value)">
          <div class="board-page-header__watchers">
            <div class="board-page-header__watcher-avatars">
              ${allUsers.slice(0,6).map((u,i) => `<div class="board-page-header__watcher-av" style="background:${wColors[i%wColors.length]}" title="${esc(u.name)}">${initials(u.name)}</div>`).join('')}
            </div>
          </div>
          ${boardOverdueCount > 0 ? `<button class="btn btn-sm btn-ghost" id="overdueFilterBtn" onclick="toggleOverdueFilter(this)" title="\u041f\u043e\u043a\u0430\u0436\u0438 \u0441\u0430\u043c\u043e \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u0438">\u26a0 ${boardOverdueCount}</button>` : ''}
          ${edit ? `<a class="btn btn-sm" href="#/card/0/new?board=${boardId}">+ Нова карта</a>` : ''}
          ${manage ? `<button class="btn btn-sm btn-ghost" onclick="showAddColumnModal(${boardId})">+ Колона</button>` : ''}
          <button class="btn btn-sm btn-ghost" onclick="toggleBoardMenu(event, ${boardId})">⋯</button>
        </div>
      </div>

      <div class="board-kanban">
        ${visibleCols.map((col, i) => {
          const colColor = COLUMN_COLORS[i % COLUMN_COLORS.length];
          const colCards = cards.filter(c => c.column_id === col.id && !c.is_on_hold);
          const holdCards = cards.filter(c => c.column_id === col.id && c.is_on_hold);
          return `
            <div class="kanban-column" data-col-id="${col.id}" style="--col-color:${colColor}"
                 ${manage ? `draggable="true" ondragstart="handleColDragStart(event)" ondragend="handleColDragEnd(event)" ondragover="handleColDragOver(event)" ondrop="handleColDrop(event,${boardId})"` : ''}>
              <div class="kanban-column__inner">
                <div class="column-header">
                  <div class="column-title-wrap">
                    ${manage ? `<span class="col-drag-handle" title="Премести колона">⠿</span>` : ''}
                    <span class="column-title-dot"></span>
                    <h2 class="column-title-link">
                      <span ${manage ? `ondblclick="editColumnTitle(${boardId}, ${col.id}, this)"` : ''}>${esc(col.title)}</span>
                      <span class="col-count${col.wip_limit && (colCards.length + holdCards.length) >= col.wip_limit ? ' col-count--wip' : ''}">${colCards.length + holdCards.length}${col.wip_limit ? `/${col.wip_limit}` : ''}</span>
                    </h2>
                  </div>
                  <div class="column-header-right">
                    <a class="col-permalink-btn" href="#/column/${col.id}" target="_blank" title="Отвори само тази колона" onclick="event.stopPropagation()">↗</a>
                    ${manage ? `<button class="col-menu-btn" onclick="showColMenu(event, ${boardId}, ${col.id})">⋮</button>` : ''}
                  </div>
                </div>
                <div class="column-cards" data-column-id="${col.id}" data-board-id="${boardId}" data-is-hold="false"
                     ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
                  ${colCards.map(c => renderKanbanCard(c, colColor)).join('')}
                </div>
                <div class="on-hold-section" id="hold-${col.id}">
                  <button class="on-hold-toggle" onclick="toggleHoldSection(${col.id})">
                    <span class="on-hold-toggle__icon">${holdCards.length > 0 ? '▾' : '▸'}</span>
                    <span>На изчакване</span>
                    <span class="on-hold-toggle__count">${holdCards.length}</span>
                  </button>
                  <div class="on-hold-cards" id="hold-cards-${col.id}" style="${holdCards.length > 0 ? '' : 'display:none'}">
                    <div class="column-cards on-hold-drop" data-column-id="${col.id}" data-board-id="${boardId}" data-is-hold="true"
                         ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
                      ${holdCards.map(c => renderKanbanCard(c, colColor)).join('')}
                      <div class="on-hold-drop-hint">Влачи тук за пауза</div>
                    </div>
                  </div>
                </div>
                ${edit ? `<a class="add-card-btn" href="#/card/0/new?board=${boardId}&column=${col.id}">+ Добави карта</a>` : ''}
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

function filterBoardCards(q) {
  const query = (q || '').toLowerCase().trim();
  document.querySelectorAll('.kanban-card').forEach(card => {
    if (!query) { card.style.display = ''; return; }
    const title = (card.querySelector('.kanban-card__title')?.textContent || '').toLowerCase();
    const client = (card.querySelector('.kanban-card__client')?.textContent || '').toLowerCase();
    const assignees = [...card.querySelectorAll('.kanban-card__av')].map(a => a.title.toLowerCase()).join(' ');
    card.style.display = (title.includes(query) || client.includes(query) || assignees.includes(query)) ? '' : 'none';
  });
  // Update column counts to show filtered/total when searching
  document.querySelectorAll('.kanban-column').forEach(col => {
    const countEl = col.querySelector('.col-count');
    if (!countEl) return;
    if (query) {
      if (!countEl.dataset.originalCount) countEl.dataset.originalCount = countEl.textContent;
      const visible = col.querySelectorAll('.column-cards:not(.on-hold-drop) .kanban-card:not([style*="display: none"]):not([style*="display:none"])').length;
      const wip = countEl.dataset.originalCount.includes('/') ? '/' + countEl.dataset.originalCount.split('/')[1] : '';
      countEl.textContent = visible + wip;
    } else if (countEl.dataset.originalCount) {
      countEl.textContent = countEl.dataset.originalCount;
      delete countEl.dataset.originalCount;
    }
  });
}

function toggleOverdueFilter(btn) {
  var active = btn.dataset.active === '1';
  active = !active;
  btn.dataset.active = active ? '1' : '';
  btn.style.cssText = active ? 'background:rgba(239,68,68,0.15) !important;color:var(--red) !important;border-color:var(--red) !important' : '';
  document.querySelectorAll('.kanban-card-wrap').forEach(function(wrap) {
    if (active) {
      var card = wrap.querySelector('.kanban-card');
      var isOver = card && (card.classList.contains('overdue') || card.classList.contains('deadline-today'));
      wrap.style.display = isOver ? '' : 'none';
    } else {
      wrap.style.display = '';
    }
  });
  document.querySelectorAll('.kanban-column').forEach(function(col) {
    var countEl = col.querySelector('.col-count');
    if (!countEl) return;
    if (active) {
      if (!countEl.dataset.originalCount) countEl.dataset.originalCount = countEl.textContent;
      var visible = col.querySelectorAll('.kanban-card-wrap:not([style*="display: none"]):not([style*="display:none"])').length;
      countEl.textContent = visible;
    } else if (countEl.dataset.originalCount) {
      countEl.textContent = countEl.dataset.originalCount;
      delete countEl.dataset.originalCount;
    }
  });
}

function renderKanbanCard(card, colColor) {
  const color = getCardColorClass(card);
  const nowDay = new Date(); nowDay.setHours(0,0,0,0);
  const dueDate = card.due_on ? new Date(card.due_on+'T00:00:00') : null;
  const isDueOverdue = dueDate && dueDate < nowDay;
  const isDueToday = dueDate && dueDate.getTime() === nowDay.getTime();
  const dueClass = isDueOverdue ? ' kanban-card__due--overdue' : isDueToday ? ' kanban-card__due--today' : '';
  const dueStr = card.due_on ? formatDate(card.due_on) : '';
  const publishStr = card.publish_date ? formatDate(card.publish_date) : '';
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

  const holdLabel = card.is_on_hold ? `<span class="kanban-card__hold-badge">⏸ На изчакване</span>` : '';
  const priorityBadge = card.priority === 'urgent' ? '<span class="kanban-card__priority-badge kanban-card__priority-badge--urgent">\ud83d\udd34 \u0421\u043f\u0435\u0448\u043d\u043e</span>' : card.priority === 'high' ? '<span class="kanban-card__priority-badge kanban-card__priority-badge--high">\u2191 \u0412\u0438\u0441\u043e\u043a</span>' : '';
  return `
    <div class="kanban-card-wrap">
      <a class="kanban-card ${color}" href="#/card/${card.id}" draggable="true" data-card-id="${card.id}"
         ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)"
         onauxclick="if(event.button===1){event.preventDefault();window.open('#/card/${card.id}','_blank')}">
        <div class="kanban-card__content">
          ${holdLabel}${priorityBadge}
          <h3 class="kanban-card__title">${esc(card.title)}</h3>
          <div class="kanban-card__footer">
            <div class="kanban-card__avatars">${avatarsHtml}</div>
            <div class="kanban-card__badges">
              ${card.client_name ? `<span class="kanban-card__client">${esc(card.client_name)}</span>` : ''}
              ${stepsStr ? `<span class="kanban-card__steps">✓ ${stepsStr}</span>` : ''}
              ${publishStr ? `<span class="kanban-card__publish">📅 ${publishStr}</span>` : dueStr ? `<span class="kanban-card__due${dueClass}">${isDueOverdue ? '⚠ ' : isDueToday ? '⏰ ' : ''}${dueStr}</span>` : ''}
              ${card.comment_count ? `<span class="kanban-card__comments">💬 ${card.comment_count}</span>` : ''}
            </div>
          </div>
        </div>
      </a>
      <button class="kanban-card__menu-btn" onclick="event.preventDefault();event.stopPropagation();showKanbanCardMenu(event,${card.id},${card.is_on_hold?'true':'false'})" title="Опции">⋮</button>
    </div>`;
}

// ==================== CARD PAGE ====================
var _cardPinnedComment = null;
var _commentSortOrder = 'desc';
var _commentFilterUserId = null;
var _replyToComment = null; // { id, userName }
var _pendingScrollCommentId = null;
var _pinnedSidebarScrollTop = 0;

var _cardEditMode = false;
const cardEditingPresence = new Map(); // cardId -> { userId, userName }

async function renderCardPage(el, cardId) {
  el.className = 'page-tool';
  try {
    const card = await (await fetch('/api/cards/' + cardId)).json();
    var comments = [];
    try { comments = await (await fetch('/api/cards/' + cardId + '/comments')).json(); } catch(e) {}

    // Load pinned comment from API
    _cardPinnedComment = card.pinned_comment || null;

    var board = allBoards.find(function(b) { return b.id === card.board_id; });
    var col = board && board.columns ? board.columns.find(function(c) { return c.id === card.column_id; }) : null;

    setBreadcrumb([
      { label: board ? board.title : 'Борд', href: '#/board/' + card.board_id },
      { label: col ? col.title : '\u2014', href: '#/board/' + card.board_id },
      { label: card.title.substring(0, 40) + (card.title.length > 40 ? '…' : '') }
    ]);

    var manage = canManage();
    var editing = _cardEditMode && canEdit();
    var creatorName = card.creator_name || (allUsers.find(function(u) { return u.id === card.creator_id; }) || {}).name || '';
    var createdAgo = card.created_at ? timeAgo(card.created_at) : '';
    var avatarColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
    var getAC = function(name) { return avatarColors[(name||'').length % avatarColors.length]; };

    // Envelope SVG icon
    var envelopeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg>';

    // ===== ASSIGNED TO =====
    var assigneesHtml = '';
    if (canEdit()) {
      if (card.assignees && card.assignees.length > 0) {
        assigneesHtml = card.assignees.map(function(a) {
          return '<span class="bc-assignee">' + esc(a.name) + '<button class="bc-assignee__remove" onclick="event.stopPropagation();removeAssignee(' + cardId + ',' + a.id + ')" title="Премахни">\u2715</button></span>';
        }).join(' ');
      }
      var availableUsers = allUsers.filter(function(u) { return !(card.assignees || []).some(function(a) { return a.id === u.id; }); });
      var assignPlaceholder = card.assignees && card.assignees.length ? '+ Добави...' : 'Търси хора\u2026';
      var assignClass = card.assignees && card.assignees.length ? 'bc-select-inline' : 'bc-select-inline bc-select-inline--ghost';
      assigneesHtml += '<select class="' + assignClass + '" onchange="addAssignee(' + cardId + ', this.value)">' +
        '<option value="">' + assignPlaceholder + '</option>' +
        availableUsers.map(function(u) { return '<option value="' + u.id + '">' + esc(u.name) + '</option>'; }).join('') +
        '</select>';
    } else {
      if (card.assignees && card.assignees.length > 0) {
        assigneesHtml = card.assignees.map(function(a) { return '<span>' + esc(a.name) + '</span>'; }).join(', ');
      } else {
        assigneesHtml = '<span class="bc-field__placeholder">Търси хора\u2026</span>';
      }
    }

    // ===== DUE DATE =====
    var dueHtml = '';
    if (canEdit()) {
      var noDueChecked = !card.due_on ? ' checked' : '';
      var specificChecked = card.due_on ? ' checked' : '';
      var dueBtnText = card.due_on ? formatDate(card.due_on) : '\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026';
      var dueBtnCls = card.due_on ? 'bc-date-btn' : 'bc-date-btn bc-date-btn--placeholder';
      var dueBtnStyle = card.due_on ? '' : ' style="display:none"';
      dueHtml = '<label class="bc-radio"><input type="radio" name="due_' + cardId + '"' + noDueChecked + ' onclick="handleNoDueDate(' + cardId + ')"> \u0411\u0435\u0437 \u0434\u0430\u0442\u0430</label>' +
        '<label class="bc-radio"><input type="radio" name="due_' + cardId + '"' + specificChecked + ' onclick="handleSpecificDate(' + cardId + ')"> \u041a\u043e\u043d\u043a\u0440\u0435\u0442\u043d\u0430 \u0434\u0430\u0442\u0430 ' +
        '<button class="' + dueBtnCls + '" id="dueDateBtn_' + cardId + '" data-value="' + ((card.due_on || '').split('T')[0]) + '"' + dueBtnStyle + ' onclick="event.stopPropagation();openDueDatePicker(' + cardId + ',this)">' + dueBtnText + '</button></label>' +
        '<span id="dueSavedLabel_' + cardId + '" class="bc-due-saved" style="display:none">\u2713 \u0417\u0430\u043f\u0430\u0437\u0435\u043d\u043e</span>';
    } else {
      var dueDateObj = card.due_on ? new Date(card.due_on+'T00:00:00') : null;
      var nowDay2 = new Date(); nowDay2.setHours(0,0,0,0);
      var dueIsOverdue = dueDateObj && dueDateObj < nowDay2 && !card.completed_at;
      var dueIsToday = dueDateObj && dueDateObj.getTime() === nowDay2.getTime();
      if (card.due_on) {
        var dueStyle = dueIsOverdue ? ' style="color:var(--red);font-weight:600"' : dueIsToday ? ' style="color:var(--yellow);font-weight:600"' : '';
        var duePrefix = dueIsOverdue ? '\u26a0 ' : dueIsToday ? '\u23f0 ' : '';
        dueHtml = '<span' + dueStyle + '>' + duePrefix + formatDate(card.due_on) + '</span>' +
          (dueIsOverdue ? ' <span style="background:rgba(239,68,68,0.15);color:var(--red);font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px">\u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u043e!</span>' : '');
      } else {
        dueHtml = '<span class="bc-field__placeholder">\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430</span>';
      }
    }

    // ===== CLIENT NAME =====
    var clientHtml = '';
    if (editing) {
      clientHtml = '<input class="bc-inline-input" id="clientNameInput_' + cardId + '" type="text" value="' + esc(card.client_name || '') + '" placeholder="\u0418\u043c\u0435 \u043d\u0430 \u043a\u043b\u0438\u0435\u043d\u0442\u2026" onblur="saveClientNameField(' + cardId + ',this.value)">';
    } else {
      clientHtml = card.client_name
        ? '<span class="bc-client-badge">' + esc(card.client_name) + (card.kp_number ? ' \u00b7 \u041a\u041f-' + card.kp_number : '') + '</span>'
        : '<span class="bc-field__placeholder">\u2014</span>';
    }

    // ===== PRIORITY =====
    var priorityHtml = '';
    if (editing) {
      priorityHtml = '<select class="bc-select-inline" onchange="updateField(' + cardId + ',\'priority\',this.value)">' +
        '<option value="normal"' + (!card.priority || card.priority === 'normal' ? ' selected' : '') + '>\u041d\u043e\u0440\u043c\u0430\u043b\u0435\u043d</option>' +
        '<option value="high"' + (card.priority === 'high' ? ' selected' : '') + '>\u2191 \u0412\u0438\u0441\u043e\u043a</option>' +
        '<option value="urgent"' + (card.priority === 'urgent' ? ' selected' : '') + '>\ud83d\udd34 \u0421\u043f\u0435\u0448\u043d\u043e</option>' +
        '</select>';
    } else {
      var pLabels = {'urgent': '\ud83d\udd34 \u0421\u043f\u0435\u0448\u043d\u043e', 'high': '\u2191 \u0412\u0438\u0441\u043e\u043a', 'normal': '\u041d\u043e\u0440\u043c\u0430\u043b\u0435\u043d'};
      priorityHtml = '<span>' + (pLabels[card.priority] || '\u041d\u043e\u0440\u043c\u0430\u043b\u0435\u043d') + '</span>';
    }

    // ===== PRODUCTION DATES =====
    var prodDateDefs = [
      { key: 'brainstorm_date', label: '\u0418\u0437\u043c\u0438\u0441\u043b\u044f\u043d\u0435' },
      { key: 'filming_date',    label: '\u0417\u0430\u0441\u043d\u0435\u043c\u0430\u043d\u0435' },
      { key: 'editing_date',    label: '\u041c\u043e\u043d\u0442\u0430\u0436' },
      { key: 'upload_date',     label: '\u041a\u0430\u0447\u0432\u0430\u043d\u0435' },
      { key: 'publish_date',    label: '\u041f\u0443\u0431\u043b\u0438\u043a\u0443\u0432\u0430\u043d\u0435' }
    ];
    var prodDatesHtml = '<div class="bc-prod-dates">';
    prodDateDefs.forEach(function(f) {
      var val = (card[f.key] || '').split('T')[0];
      var isPublish = f.key === 'publish_date';
      if (editing) {
        var btnCls = val ? 'bc-date-btn' : 'bc-date-btn bc-date-btn--placeholder';
        var btnTxt = val ? formatDate(val) : '\u0418\u0437\u0431\u0435\u0440\u0438\u2026';
        prodDatesHtml += '<div class="bc-prod-date-row' + (isPublish ? ' bc-prod-date-row--publish' : '') + '">' +
          '<span class="bc-prod-date-label">' + f.label + '</span>' +
          '<button class="' + btnCls + '" id="prodDateBtn_' + f.key + '_' + cardId + '" data-value="' + val + '" ' +
          'onclick="event.stopPropagation();openProductionDatePicker(' + cardId + ',\'' + f.key + '\',this)">' + btnTxt + '</button>' +
          (isPublish ? '<span class="bc-prod-date-hint">\u2190 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u043d\u043e \u0438\u0437\u0447\u0438\u0441\u043b\u044f\u0432\u0430 \u043e\u0441\u0442\u0430\u043d\u0430\u043b\u0438\u0442\u0435</span>' : '') +
          '</div>';
      } else {
        prodDatesHtml += '<div class="bc-prod-date-row' + (isPublish ? ' bc-prod-date-row--publish' : '') + '">' +
          '<span class="bc-prod-date-label">' + f.label + '</span>' +
          '<span class="bc-prod-date-value">' + (val ? formatDate(val) : '<span class="bc-field__placeholder">\u2014</span>') + '</span>' +
          '</div>';
      }
    });
    prodDatesHtml += '</div>';

    // ===== NOTES =====
    var notesHtml = '';
    if (editing) {
      notesHtml = '<div class="bc-editor">' +
        '<input id="cardNotesInput" type="hidden" value="' + esc(card.content || '') + '">' +
        '<trix-editor input="cardNotesInput" class="trix-dark" placeholder="Добави бележки\u2026"></trix-editor>' +
        '</div>' +
        '';
    } else {
      if (card.content && card.content.replace(/<[^>]*>/g, '').trim()) {
        notesHtml = '<div class="rich-content">' + card.content + '</div>';
      } else {
        notesHtml = '<span class="bc-field__placeholder">Добави бележки\u2026</span>';
      }
    }

    // ===== STEPS =====
    var stepsHtml = '';
    if (card.steps && card.steps.length) {
      stepsHtml += '<ul class="bc-checklist">';
      stepsHtml += card.steps.map(function(s) {
        var doneClass = s.completed ? ' bc-checklist__item--done' : '';
        var stepClick = canEdit() ? ' onclick="expandStep(' + cardId + ',' + s.id + ',this.closest(\'li\'))"' : '';
        return '<li class="bc-checklist__item' + doneClass + '" data-step-id="' + s.id + '" data-card-id="' + cardId + '">' +
          '<input type="checkbox" ' + (s.completed ? 'checked' : '') + ' onclick="event.stopPropagation();toggleStep(' + cardId + ',' + s.id + ',this.checked)">' +
          '<span' + stepClick + '>' + esc(s.title) + '</span>' +
          '</li>';
      }).join('');
      stepsHtml += '</ul>';
    }
    if (canEdit()) {
      stepsHtml += '<button class="bc-add-step-link" onclick="showAddStepForm(' + cardId + ')">Добави стъпка</button>';
      stepsHtml += '<div class="bc-add-step" id="addStepForm_' + cardId + '">' +
        '<input id="newStepInput" class="bc-step-expand__input" type="text" placeholder="Опиши тази стъпка…" onkeydown="if(event.key===\'Enter\')addStepFromPage(' + cardId + ')">' +
        '<div style="display:flex;gap:8px;margin-top:8px"><button class="bc-btn-save" onclick="addStepFromPage(' + cardId + ')">Добави тази стъпка</button><button class="bc-btn-discard" onclick="hideAddStepForm(' + cardId + ')">Откажи</button></div>' +
        '</div>';
    }


    // ===== COLUMN (always show Move along to dropdown, incl. on-hold variants) =====
    var colOptionsHtml = '';
    if (canEdit() && board && board.columns) {
      var sortedCols = board.columns.slice().sort(function(a, b) { return (a.is_done_column ? 1 : 0) - (b.is_done_column ? 1 : 0); });
      var colOptions = [];
      sortedCols.forEach(function(c) {
        var isCurrentRegular = (c.id === card.column_id && !card.is_on_hold);
        var isCurrentHold    = (c.id === card.column_id && !!card.is_on_hold);
        if (!isCurrentRegular) colOptions.push('<option value="' + c.id + ':0">' + esc(c.title) + '</option>');
        if (!c.is_done_column && !isCurrentHold) colOptions.push('<option value="' + c.id + ':1">\u23f8 ' + esc(c.title) + ' (\u041d\u0430 \u0438\u0437\u0447\u0430\u043a\u0432\u0430\u043d\u0435)</option>');
      });
      colOptionsHtml = '<select class="bc-select-inline" onchange="moveCardTo(' + cardId + ',this.value,this)">' +
        '<option value="">\u041f\u0440\u0435\u043c\u0435\u0441\u0442\u0438 \u0432\u2026</option>' +
        colOptions.join('') +
        '</select>';
    }

    // ===== COMMENTS =====
    var commentAddHtml = '<div class="bc-comment-add">' +
      '<div class="bc-comment-avatar" style="background:' + getAC(currentUser ? currentUser.name : '') + '">' + initials(currentUser ? currentUser.name : '') + '</div>' +
      '<div class="bc-comment-input-wrap">' +
      '<div id="replyBadge" class="bc-reply-badge" style="display:none"><span>↩ Отговаряш на <strong class="bc-reply-badge__name"></strong></span><button class="bc-reply-badge__cancel" onclick="cancelReply()">✕</button></div>' +
      '<div class="bc-comment-placeholder" onclick="expandCommentInput()">Написвай коментар\u2026</div>' +
      '<div class="bc-comment-editor-wrap" id="commentEditorWrap">' +
      '<div class="bc-editor"><input id="newCommentInput" type="hidden" value=""><trix-editor input="newCommentInput" class="trix-dark" placeholder="Написвай коментар тук\u2026" style="min-height:80px"></trix-editor></div>' +
      '<div style="display:flex;gap:8px;margin-top:8px"><button class="bc-btn-save bc-btn-add-comment" onclick="addComment(' + cardId + ')">Добави коментар</button><button class="bc-btn-discard" onclick="collapseCommentInput()">Отказ</button></div>' +
      '</div>' +
      '</div></div>';

    var COMMENTS_INITIAL = 5, COMMENTS_PAGE = 10;
    var commentsListHtml = '';
    if (comments.length) {
            var uniqueUsers = {};
      comments.forEach(function(cm) { uniqueUsers[cm.user_id] = cm.user_name; });
      var userOpts = Object.keys(uniqueUsers).map(function(uid) {
        return '<option value="' + uid + '">' + esc(uniqueUsers[uid]) + '</option>';
      }).join('');
      commentsListHtml += '<div class="bc-comments-filter">' +
        '<div class="bc-filter-tabs">' +
        '<button class="bc-filter-tab active" data-sort="desc" onclick="setCommentSort(\x27desc\x27)">↓ Нови</button>' +
        '<button class="bc-filter-tab" data-sort="asc" onclick="setCommentSort(\x27asc\x27)">↑ Стари</button>' +
        '</div>' +
        '<select class="bc-filter-user-select" onchange="setCommentUser(this.value)">' +
        '<option value="">Всички</option>' + userOpts +
        '</select>' +
        '</div>';
      commentsListHtml = '<div class="bc-comments-list" id="commentsList">';
      var shown = comments.slice(0, COMMENTS_INITIAL);
      var remaining = comments.slice(COMMENTS_INITIAL);
      var renderComment = function(c) {
        var cc = getAC(c.user_name);
        var isOwn = currentUser && (c.user_id === currentUser.id || currentUser.role === 'admin' || currentUser.role === 'moderator');
        var isPinned = _cardPinnedComment && _cardPinnedComment.id === c.id;
        return '<div class="bc-comment" data-comment-id="' + c.id + '" data-user-id="' + c.user_id + '" data-timestamp="' + (c.created_at||'') + '">' +
          '<div class="bc-comment-avatar" style="background:' + cc + '">' + initials(c.user_name) + '</div>' +
          '<div class="bc-comment-body">' +
          (c.reply_to_id && c.parent_user_name ? '<div class="bc-reply-preview" onclick="scrollToComment(' + c.reply_to_id + ')" title="Премини към оригиналния коментар"><span class="bc-reply-preview__author">↩ ' + esc(c.parent_user_name) + ':</span> <span class="bc-reply-preview__text">' + esc((c.parent_content||'').replace(/<[^>]*>/g,'').slice(0,120)) + ((c.parent_content||'').replace(/<[^>]*>/g,'').length>120?'…':'') + '</span></div>' : '') +
          '<div class="bc-comment-meta"><strong>' + esc(c.user_name) + '</strong> <span>' + timeAgo(c.created_at) + '</span><button class="bc-reply-btn" onclick="replyToComment(' + cardId + ',' + c.id + ',\'' + esc(c.user_name) + '\')">↩ Отговори</button></div>' +
          '<div class="bc-comment-text">' + (c.content || '').replace(/\n/g, '<br>') + '</div>' +
          '<div class="bc-comment-actions">' +
          (isOwn ? '<button class="bc-comment-action" onclick="editComment(' + cardId + ',' + c.id + ',this)">Редактирай</button>' : '') +
          (isOwn ? '<button class="bc-comment-action bc-comment-action--danger" onclick="deleteComment(' + cardId + ',' + c.id + ')">Изтрий</button>' : '') +
          '<button class="bc-comment-action bc-comment-action--pin" onclick="pinComment(' + cardId + ',' + c.id + ')">' + (isPinned ? 'Откачи' : '\ud83d\udccc Закачи') + '</button>' +
          '</div></div></div>';
      };
      commentsListHtml += shown.map(renderComment).join('');
      if (remaining.length > 0) {
        commentsListHtml += '<div id="hiddenComments" style="display:none">' + remaining.map(renderComment).join('') + '</div>';
        commentsListHtml += '<button class="bc-show-more-comments" id="showMoreCommentsBtn" onclick="showMoreComments()">Покажи по-стари (' + remaining.length + ')</button>';
      }
      commentsListHtml += '</div>';
    }

    // ===== PINNED SIDEBAR =====
    var pinnedSidebarHtml = '';
    if (_cardPinnedComment) {
      var pc = _cardPinnedComment;
      pinnedSidebarHtml = '<div class="bc-pinned-sidebar">' +
        '<div class="bc-pinned-sidebar__header">' +
          '<span class="bc-pinned-sidebar__title">\ud83d\udccc \u0417\u0430\u043a\u0430\u0447\u0435\u043d\u043e</span>' +
          '<button class="bc-pinned-sidebar__unpin" onclick="unpinComment(' + cardId + ')">' +
            '\u041e\u0442\u043a\u0430\u0447\u0438</button>' +
        '</div>' +
        '<div class="bc-pinned-sidebar__body" id="pinnedSidebarBody">' +
          '<div class="bc-pinned-sidebar__content">' + (pc.content || '').replace(/\n/g, '<br>') + '</div>' +
          '<div class="bc-pinned-sidebar__meta">\u2014 ' + esc(pc.user_name) + ', ' + timeAgo(pc.created_at) + '</div>' +
        '</div>' +
        '</div>';
    }

    // Register Trix highlight (background) color attribute (idempotent)
    if (window.Trix && !Trix.config.textAttributes.backgroundColor) {
      Trix.config.textAttributes.backgroundColor = { styleProperty: 'background-color', inheritable: true };
    }

    // ===== BUILD PAGE =====
    var wrapperStart = pinnedSidebarHtml ? '<div class="card-page-wrapper">' : '';
    var wrapperEnd = pinnedSidebarHtml ? pinnedSidebarHtml + '</div>' : '';

    var titleEsc = esc(card.title).replace(/'/g, "\\'");

    // Populate editing presence from API response (only if it's someone else)
    if (card.editing_by && currentUser && card.editing_by.userId !== currentUser.id) {
      cardEditingPresence.set(cardId, { userId: card.editing_by.userId, userName: card.editing_by.userName });
    } else if (!card.editing_by) {
      cardEditingPresence.delete(cardId);
    }

    el.innerHTML = wrapperStart +
      '<div class="' + (pinnedSidebarHtml ? 'card-page-main' : 'card-page') + '">' +
        '<div class="card-page__toolbar" id="cardPageToolbar_' + cardId + '"></div>' +
        '<div id="cardEditingBanner" class="card-editing-banner" style="display:none"></div>' +
        '<article class="bc-card">' +
                    '<header class="bc-card__header">' +
            '<span class="bc-card__icon">' + envelopeIcon + '</span>' +
            '<h1 class="bc-card__title" onclick="' + (editing ? 'editCardTitle(this,' + cardId + ')' : 'enterCardEditMode(' + cardId + ')') + '">' + esc(card.title) + '</h1>' +
          '</header>' +
          '<div class="bc-card__fields">' +
            '<div class="bc-field"><span class="bc-field__label">Колона</span><div class="bc-field__value"><span>' + esc(col ? col.title : '\u2014') + '</span>' + colOptionsHtml + '</div></div>' +
            '<div class="bc-field"><span class="bc-field__label">Отговорник</span><div class="bc-field__value">' + assigneesHtml + '</div></div>' +
            '<div class="bc-field"><span class="bc-field__label">Приоритет</span><div class="bc-field__value">' + priorityHtml + '</div></div>' +
            '<div class="bc-field"><span class="bc-field__label">Краен срок</span><div class="bc-field__value bc-field__value--vertical">' + dueHtml + '</div></div>' +
            '<div class="bc-field bc-field--dates"><span class="bc-field__label">\u0414\u0430\u0442\u0438</span><div class="bc-field__value bc-field__value--full">' + prodDatesHtml + '</div></div>' +
            '<div class="bc-field"><span class="bc-field__label">Бележки</span><div class="bc-field__value bc-field__value--full">' + notesHtml + '</div></div>' +
            '<div class="bc-field"><span class="bc-field__label">Стъпки</span><div class="bc-field__value bc-field__value--full">' + stepsHtml + '</div></div>' +
            '<div class="bc-field bc-field--light"><span class="bc-field__label">Добавено от</span><div class="bc-field__value"><span>' + esc(creatorName) + '</span><span class="bc-field__hint">' + createdAgo + '</span></div></div>' +
          '</div>' +
          (editing ? '<div class="bc-card__actions"><button class="bc-btn-save" onclick="saveCardEdits(' + cardId + ')">Запази промените</button><button class="bc-btn-discard" onclick="exitCardEditMode(' + cardId + ')">Откажи</button></div>' : '') +
        '</article>' +
        '<div class="bc-comments">' + commentAddHtml + commentsListHtml + '</div>' +
      '</div>' + wrapperEnd;

    // Restore pinned sidebar scroll position after re-render
    var _psb = document.getElementById('pinnedSidebarBody');
    if (_psb) {
      _psb.scrollTop = _pinnedSidebarScrollTop;
      _psb.addEventListener('scroll', function() { _pinnedSidebarScrollTop = this.scrollTop; }, { passive: true });
    }

    // Populate card toolbar with action buttons
    setupCardPageToolbar(card, col, editing);

    // Auto-scroll to comment from notification
    if (_pendingScrollCommentId) {
      var _scrollCid = _pendingScrollCommentId;
      _pendingScrollCommentId = null;
      var _hc = document.getElementById('hiddenComments');
      if (_hc) { _hc.style.display = ''; var _sb = document.getElementById('showMoreCommentsBtn'); if (_sb) _sb.style.display = 'none'; }
      setTimeout(function() {
        var _cs = document.querySelector('.bc-comments');
        if (_cs) _cs.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(function() { scrollToComment(_scrollCid); }, 400);
      }, 200);
    }

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
        setupMentionPicker(commentEditor, cardId);
      }
      var notesEditor = document.querySelector('trix-editor[input="cardNotesInput"]');
      if (notesEditor) {
        setupMentionPicker(notesEditor, cardId);
      }
    }, 300);

    // Show editing banner if someone is currently editing
    updateCardEditingBanner(cardId);

  } catch(e) { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">\u041a\u0430\u0440\u0442\u0430\u0442\u0430 \u043d\u0435 \u0435 \u043d\u0430\u043c\u0435\u0440\u0435\u043d\u0430</div>'; }
}

function updateCardEditingBanner(cardId) {
  var banner = document.getElementById('cardEditingBanner');
  if (!banner) return;
  var match = location.hash.match(/#\/card\/(\d+)/);
  var currentCardId = match ? parseInt(match[1]) : null;
  if (currentCardId !== parseInt(cardId)) return;
  var editor = cardEditingPresence.get(parseInt(cardId));
  // Don't show banner to the editor themselves
  if (editor && currentUser && editor.userId !== currentUser.id) {
    banner.innerHTML = '✏️ <strong>' + esc(editor.userName) + '</strong> редактира тази задача в момента';
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

// Enter/exit edit mode
function enterCardEditMode(cardId) {
  var editor = cardEditingPresence.get(parseInt(cardId));
  if (editor && currentUser && editor.userId !== currentUser.id) {
    showConfirmModal(editor.userName + ' \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0430 \u0442\u0430\u0437\u0438 \u0437\u0430\u0434\u0430\u0447\u0430 \u0432 \u043c\u043e\u043c\u0435\u043d\u0442\u0430. \u0410\u043a\u043e \u043f\u0440\u043e\u0434\u044a\u043b\u0436\u0438\u0448, \u043f\u0440\u043e\u043c\u0435\u043d\u0438\u0442\u0435 \u0438\u043c \u043c\u043e\u0436\u0435 \u0434\u0430 \u0431\u044a\u0434\u0430\u0442 \u0438\u0437\u0433\u0443\u0431\u0435\u043d\u0438. \u0418\u0441\u043a\u0430\u0448 \u043b\u0438 \u0432\u0441\u0435 \u043f\u0430\u043a \u0434\u0430 \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0430\u0448?', function() {
      _cardEditMode = true;
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'card:editing', cardId }));
      router();
    }, false, '\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0430\u0439');
    return;
  }
  _cardEditMode = true;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'card:editing', cardId }));
  router();
}
function exitCardEditMode(cardId) {
  _cardEditMode = false;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'card:editing:stop', cardId }));
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
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'card:editing:stop', cardId }));
  showToast('\u041f\u0440\u043e\u043c\u0435\u043d\u0438\u0442\u0435 \u0441\u0430 \u0437\u0430\u043f\u0430\u0437\u0435\u043d\u0438', 'success');
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
  cancelReply();
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
  if (toolbar.querySelector('.bc-trix-color-btn')) return;
  var group = toolbar.querySelector('.trix-button-group--text-tools');
  if (!group) return;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'trix-button bc-trix-color-btn';
  btn.title = 'Маркиране';
  btn.innerHTML = '<span style="display:inline-block;width:14px;height:10px;background:linear-gradient(90deg,#fde047 50%,#4ade80 50%);border-radius:2px;vertical-align:middle"></span>';
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

  // 8 colors — all at S=39% L=44% (same as Basecamp's #9B7D44), hue-stepped 45°
  var COLORS = [
    { name: 'Злато',     bg: '#9B7D44', fg: '#fff' }, // H=38°  — anchor
    { name: 'Маслина',   bg: '#7A9C44', fg: '#fff' }, // H=83°
    { name: 'Зелено',    bg: '#449C50', fg: '#fff' }, // H=128°
    { name: 'Тюркоаз',   bg: '#449C92', fg: '#fff' }, // H=173°
    { name: 'Синьо',     bg: '#44659C', fg: '#fff' }, // H=218°
    { name: 'Индиго',    bg: '#66449C', fg: '#fff' }, // H=263°
    { name: 'Лилаво',    bg: '#9C4490', fg: '#fff' }, // H=308°
    { name: 'Червено',   bg: '#9C444F', fg: '#fff' }, // H=353°
  ];

  // Find the active color if any
  var activeColor = '';
  try {
    var sel = trixEl.editor.getSelectedRange();
    if (sel[0] !== sel[1]) {
      var attrs = trixEl.editor.getDocument().getCommonAttributesAtRange(sel);
      activeColor = attrs.backgroundColor || '';
    }
  } catch(ex) {}

  var picker = document.createElement('div');
  picker.className = 'bc-color-picker';

  COLORS.forEach(function(c) {
    var swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'bc-color-swatch';
    swatch.style.background = c.bg;
    swatch.style.color = c.fg;
    swatch.title = c.name;
    swatch.innerHTML = activeColor === c.bg
      ? '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : 'Ab';
    swatch.addEventListener('click', function(ev) {
      ev.stopPropagation();
      if (window.Trix && Trix.config.textAttributes.backgroundColor) {
        trixEl.editor.activateAttribute('backgroundColor', c.bg);
      }
      picker.remove();
      trixEl.focus();
    });
    picker.appendChild(swatch);
  });

  // Full-width "Remove all coloring" button
  var resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'bc-color-swatch--reset';
  resetBtn.textContent = 'Премахни маркирането';
  resetBtn.addEventListener('click', function(ev) {
    ev.stopPropagation();
    if (window.Trix && Trix.config.textAttributes.backgroundColor) {
      trixEl.editor.deactivateAttribute('backgroundColor');
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
  var ta = document.createElement('textarea');
  ta.className = 'bc-card__title-input';
  ta.value = current;
  ta.rows = 1;
  el.replaceWith(ta);
  // Auto-size to content
  function autosize() { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  autosize();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  var saving = false;
  var save = function() {
    if (saving) return;
    saving = true;
    var val = ta.value.replace(/\n/g, ' ').trim();
    if (val && val !== current) {
      updateField(cardId, 'title', val);
    }
    var h1 = document.createElement('h1');
    h1.className = 'bc-card__title';
    h1.textContent = val || current;
    h1.onclick = function() { editCardTitle(h1, cardId); };
    ta.replaceWith(h1);
  };
  ta.addEventListener('input', autosize);
  ta.addEventListener('blur', save);
  ta.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); ta.blur(); }
    if (e.key === 'Escape') { ta.value = current; ta.blur(); }
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
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();document.querySelector(\'.bc-card__title\').click()">\u270f\ufe0f Редактирай</button>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();showMoveCardPicker(' + cardId + ')">\u2197\ufe0f Премести</button>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();copyCardLink(' + cardId + ')">\ud83d\udccb Копирай линк</button>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();archiveCard(' + cardId + ')">\ud83d\udce6 Архивирай</button>' +
    '<button class="bc-options-menu__item bc-options-menu__item--danger" onclick="document.querySelector(\'.bc-options-menu\').remove();trashCard(' + cardId + ')">\ud83d\uddd1\ufe0f В кошчето</button>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();toggleBookmark(\'card\',' + cardId + ',\'' + cardTitle.replace(/'/g, "\\'") + '\')">\ud83d\udd16 Отметка</button>' +
    '<div class="bc-options-menu__sep"></div>' +
    '<div class="bc-options-menu__heading">История</div>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();showCardHistory(' + cardId + ')">\ud83d\udd50 История на промените</button>' +
    '<button class="bc-options-menu__item" style="opacity:0.5;cursor:default">\ud83d\udc65 Уведомени хора</button>';

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

// Move card picker - proper modal with dropdowns
function showMoveCardPicker(cardId) {
  var ov = document.createElement('div'); ov.className = 'modal-overlay';
  var boardOpts = allBoards.map(function(b) { return '<option value="' + b.id + '">' + esc(b.title) + '</option>'; }).join('');
  ov.innerHTML = '<div class="confirm-modal-box"><p class="confirm-modal-msg">\u041f\u0440\u0435\u043c\u0435\u0441\u0442\u0438 \u043a\u0430\u0440\u0442\u0430</p>' +
    '<select class="confirm-modal-input" id="mcBoard">' + boardOpts + '</select>' +
    '<select class="confirm-modal-input" id="mcCol"></select>' +
    '<div class="confirm-modal-actions"><button class="btn btn-primary" id="mcOk">\u041f\u0440\u0435\u043c\u0435\u0441\u0442\u0438</button><button class="btn btn-ghost" id="mcCancel">\u041e\u0442\u043a\u0430\u0437</button></div></div>';
  document.body.appendChild(ov);
  function updateCols() {
    var bid = parseInt(ov.querySelector('#mcBoard').value);
    var board = allBoards.find(function(b) { return b.id === bid; });
    var cols = (board && board.columns) ? board.columns.filter(function(c) { return !c.is_done_column; }) : [];
    ov.querySelector('#mcCol').innerHTML = cols.map(function(c) { return '<option value="' + c.id + '">' + esc(c.title) + '</option>'; }).join('');
  }
  updateCols();
  ov.querySelector('#mcBoard').onchange = updateCols;
  ov.querySelector('#mcOk').onclick = function() {
    var colId = parseInt(ov.querySelector('#mcCol').value);
    if (!colId) return;
    ov.remove();
    moveCard(cardId, colId);
  };
  ov.querySelector('#mcCancel').onclick = function() { ov.remove(); };
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
}

// Copy card link
function copyCardLink(cardId) {
  var url = location.origin + '/#/card/' + cardId;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(function() {
      showToast('\u0421\u0441\u044b\u043b\u043a\u0430\u0442\u0430 \u0435 \u043a\u043e\u043f\u0438\u0440\u0430\u043d\u0430', 'success');
    }).catch(function() {
      showToast('\u041d\u0435 \u043c\u043e\u0436\u0435 \u0434\u0430 \u043a\u043e\u043f\u0438\u0440\u0430', 'error');
    });
  }
}

// Archive card (DELETE)
function archiveCard(cardId) {
  showConfirmModal('\u0410\u0440\u0445\u0438\u0432\u0438\u0440\u0430\u0439 \u0442\u0430\u0437\u0438 \u043a\u0430\u0440\u0442\u0430?', async function() {
    try {
      await fetch('/api/cards/' + cardId, { method: 'DELETE' });
      history.back();
    } catch(e) {}
  }, true);
}

// Trash card (same as archive for now)
function trashCard(cardId) {
  showConfirmModal('\u0410\u0440\u0445\u0438\u0432\u0438\u0440\u0430\u0439 \u0442\u0430\u0437\u0438 \u043a\u0430\u0440\u0442\u0430?', async function() {
    try {
      await fetch('/api/cards/' + cardId, { method: 'DELETE' });
      history.back();
    } catch(e) {}
  }, true);
}

// Remove assignee
async function removeAssignee(cardId, userId) {
  try {
    var card = await (await fetch('/api/cards/' + cardId)).json();
    var ids = (card.assignees || []).map(function(a) { return a.id; }).filter(function(id) { return id !== parseInt(userId); });
    await fetch('/api/cards/' + cardId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignee_ids: ids }) });
    router();
  } catch(e) { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u043f\u0440\u0435\u043c\u0430\u0445\u0432\u0430\u043d\u0435', 'error'); }
}

// Due date radio handlers
function handleNoDueDate(cardId) {
  var btn = document.getElementById('dueDateBtn_' + cardId);
  if (btn) { btn.style.display = 'none'; btn.dataset.value = ''; }
  if (_dpCurrentPicker) { _dpCurrentPicker.remove(); _dpCurrentPicker = null; }
  updateField(cardId, 'due_on', null);
}

function handleSpecificDate(cardId) {
  var btn = document.getElementById('dueDateBtn_' + cardId);
  if (!btn) return;
  btn.style.display = '';
  openDueDatePicker(cardId, btn);
}

async function saveDueDateField(cardId, value) {
  if (!value) return;
  // Suppress WS re-render for 2s so the user sees the saved state clearly
  _suppressWsRerender = Date.now() + 2000;
  await updateField(cardId, 'due_on', value);
  var lbl = document.getElementById('dueSavedLabel_' + cardId);
  if (lbl) { lbl.style.display = 'inline'; setTimeout(function() { lbl.style.display = 'none'; }, 2000); }
}

function handlePublishDate(cardId) {
  var btn = document.getElementById('publishDateBtn_' + cardId);
  if (!btn) return;
  btn.style.display = '';
  openPublishDatePicker(cardId, btn);
}
async function savePublishDateField(cardId, value) {
  _suppressWsRerender = Date.now() + 2000;
  await updateField(cardId, 'publish_date', value || null);
  var lbl = document.getElementById('pubSavedLabel_' + cardId);
  if (lbl) { lbl.style.display = 'inline'; setTimeout(function() { lbl.style.display = 'none'; }, 2000); }
}
// ===== PRODUCTION DATE FIELDS =====
function subtractWorkingDays(isoStr, n) {
  var d = new Date(isoStr + 'T12:00:00');
  var remaining = n;
  while (remaining > 0) { d.setDate(d.getDate() - 1); if (d.getDay() !== 0 && d.getDay() !== 6) remaining--; }
  return d.toISOString().split('T')[0];
}
function recalcProdDatesFromPublish(cardId, publishStr) {
  if (!publishStr) return null;
  var uploadStr     = subtractWorkingDays(publishStr, 1);
  var editingStr    = subtractWorkingDays(uploadStr, 5);
  var filmingStr    = subtractWorkingDays(editingStr, 5);
  var brainstormStr = subtractWorkingDays(filmingStr, 5);
  var map = { brainstorm_date: brainstormStr, filming_date: filmingStr, editing_date: editingStr, upload_date: uploadStr };
  Object.keys(map).forEach(function(key) {
    var btn = document.getElementById('prodDateBtn_' + key + '_' + cardId);
    if (btn) { btn.dataset.value = map[key]; btn.textContent = formatDate(map[key]); btn.className = 'bc-date-btn'; }
  });
  return map;
}
function openProductionDatePicker(cardId, field, btn) {
  showDatePickerPopup(btn, btn.dataset.value || '', function(dateStr) {
    if (!dateStr) return;
    btn.dataset.value = dateStr;
    btn.textContent = formatDate(dateStr);
    btn.className = 'bc-date-btn';
    if (field === 'publish_date') {
      var map = recalcProdDatesFromPublish(cardId, dateStr);
      var body = { publish_date: dateStr };
      if (map) Object.assign(body, map);
      _suppressWsRerender = Date.now() + 4000;
      fetch('/api/cards/' + cardId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function() { loadDateChangelog(cardId); });
    } else {
      _suppressWsRerender = Date.now() + 2000;
      updateField(cardId, field, dateStr).then(function() { loadDateChangelog(cardId); });
    }
  });
}
function showCardHistory(cardId) {
  window.open('/card-history/' + cardId, '_blank');
}

async function loadDateChangelog(cardId) {
  var container = document.getElementById('dateChangelog_' + cardId);
  if (!container) return;
  try {
    var rows = await (await fetch('/api/cards/' + cardId + '/date-changes')).json();
    if (!rows || !rows.length) { container.innerHTML = ''; return; }
    var labels = { publish_date: '\u041f\u0443\u0431\u043b\u0438\u043a\u0443\u0432\u0430\u043d\u0435', upload_date: '\u041a\u0430\u0447\u0432\u0430\u043d\u0435', editing_date: '\u041c\u043e\u043d\u0442\u0430\u0436', filming_date: '\u0417\u0430\u0441\u043d\u0435\u043c\u0430\u043d\u0435', brainstorm_date: '\u0418\u0437\u043c\u0438\u0441\u043b\u044f\u043d\u0435' };
    var html = '<div class="bc-date-changelog__title">\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u043d\u0430 \u043f\u0440\u043e\u043c\u0435\u043d\u0438</div>';
    rows.forEach(function(r) {
      var dt = new Date(r.changed_at);
      var dtStr = String(dt.getDate()).padStart(2,'0') + '.' + String(dt.getMonth()+1).padStart(2,'0') + '.' + dt.getFullYear() + ' ' + String(dt.getHours()).padStart(2,'0') + ':' + String(dt.getMinutes()).padStart(2,'0');
      var oldStr = r.old_value ? formatDate(r.old_value) : '\u2014';
      var newStr = r.new_value ? formatDate(r.new_value) : '\u2014';
      html += '<div class="bc-date-changelog__row"><span class="bc-date-changelog__time">' + dtStr + '</span><span class="bc-date-changelog__user">' + esc(r.changed_by_name || '') + '</span><span class="bc-date-changelog__field">' + (labels[r.field_name] || r.field_name) + '</span><span class="bc-date-changelog__arrow">' + oldStr + ' \u2192 ' + newStr + '</span></div>';
    });
    container.innerHTML = html;
  } catch(e) { container.innerHTML = ''; }
}
async function saveClientNameField(cardId, value) {
  _suppressWsRerender = Date.now() + 2000;
  await updateField(cardId, 'client_name', value.trim() || null);
}

// Steps: expand on click
function expandStep(cardId, stepId, li) {
  // If already editing this step, just focus the input
  if (li.classList.contains('bc-checklist__item--editing')) {
    var ex = li.querySelector('.bc-step-edit-input');
    if (ex) ex.focus();
    return;
  }
  // Collapse any other open inline editors
  document.querySelectorAll('.bc-checklist__item--editing').forEach(function(item) {
    collapseStepEditInline(item);
  });

  var textSpan = li.querySelector('span');
  if (!textSpan) return;
  var originalText = textSpan.textContent;

  li.classList.add('bc-checklist__item--editing');

  // Wrapper replaces the span — contains input + action buttons
  var wrap = document.createElement('div');
  wrap.className = 'bc-step-edit-wrap';
  wrap.addEventListener('click', function(e) { e.stopPropagation(); });

  var inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'bc-step-edit-input';
  inp.id = 'editStepTitle_' + stepId;
  inp.value = originalText;

  var actions = document.createElement('div');
  actions.className = 'bc-step-expand__actions';
  actions.style.marginTop = '8px';

  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px';

  var saveBtn = document.createElement('button');
  saveBtn.className = 'bc-btn-save';
  saveBtn.textContent = 'Запази';
  saveBtn.onclick = function() { saveStepEdit(cardId, stepId); };

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'bc-btn-discard';
  cancelBtn.textContent = 'Отказ';
  cancelBtn.onclick = function() { collapseStepEditInline(li); };

  var delBtn = document.createElement('button');
  delBtn.className = 'bc-step-expand__delete';
  delBtn.textContent = 'Изтрий стъпка';
  delBtn.onclick = function() { deleteStep(cardId, stepId); };

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  actions.appendChild(btnRow);
  actions.appendChild(delBtn);
  wrap.appendChild(inp);
  wrap.appendChild(actions);

  textSpan.replaceWith(wrap);
  inp.focus();
  inp.select();

  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); saveStepEdit(cardId, stepId); }
    if (e.key === 'Escape') { collapseStepEditInline(li); }
  });
}

function collapseStepEditInline(li) {
  var wrap = li.querySelector('.bc-step-edit-wrap');
  var inp  = li.querySelector('.bc-step-edit-input');
  if (!wrap) return;
  li.classList.remove('bc-checklist__item--editing');
  var span = document.createElement('span');
  span.textContent = inp ? (inp.value || '') : '';
  var cId    = li.dataset.cardId;
  var stepId = li.dataset.stepId;
  if (cId && stepId) {
    span.onclick = (function(ci, si) {
      return function() { expandStep(parseInt(ci), parseInt(si), li); };
    })(cId, stepId);
  }
  wrap.replaceWith(span);
}
async function saveStepEdit(cardId, stepId) {
  var titleEl = document.getElementById('editStepTitle_' + stepId);
  if (!titleEl || !titleEl.value.trim()) return;
  var data = { title: titleEl.value.trim() };
  try {
    await fetch('/api/cards/' + cardId + '/steps/' + stepId, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    router();
  } catch(e) {}
}
function deleteStep(cardId, stepId) {
  showConfirmModal('\u0418\u0437\u0442\u0440\u0438\u0439 \u0442\u0430\u0437\u0438 \u0441\u0442\u044a\u043f\u043a\u0430?', async function() {
    try {
      await fetch('/api/cards/' + cardId + '/steps/' + stepId, { method: 'DELETE' });
      router();
    } catch(e) {}
  }, true);
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
    '<div style="display:flex;gap:8px;margin-top:8px"><button class="bc-btn-save" onclick="saveCommentEdit(' + cardId + ',' + commentId + ')">Запази</button><button class="bc-btn-discard" onclick="router()">Отказ</button></div>';
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
function deleteComment(cardId, commentId) {
  showConfirmModal('\u0418\u0437\u0442\u0440\u0438\u0439 \u043a\u043e\u043c\u0435\u043d\u0442\u0430\u0440\u0430?', async function() {
    try {
      await fetch('/api/cards/' + cardId + '/comments/' + commentId, { method: 'DELETE' });
      router();
    } catch(e) {}
  }, true);
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
function deleteAttachment(cardId, attachId) {
  showConfirmModal('\u0418\u0437\u0442\u0440\u0438\u0439 \u0444\u0430\u0439\u043b\u0430?', async function() {
    try { await fetch(`/api/cards/${cardId}/attachments/${attachId}`, {method:'DELETE'}); loadCardAttachments(cardId); } catch {}
  }, true);
}

// ==================== CARD CREATE ====================
async function renderCardCreate(el) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const boardId = parseInt(params.get('board')) || allBoards[0]?.id;
  const columnId = parseInt(params.get('column')) || null;
  const board = allBoards.find(b => b.id === boardId);

  setBreadcrumb([
    { label: board?.title || '—', href: `#/board/${boardId}` },
    { label: 'Нова карта' }
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
        <div class="edit-row"><label>Краен срок</label><button class="bc-date-btn bc-date-btn--placeholder" id="createDueBtn" data-value="" onclick="event.stopPropagation();showDatePickerPopup(this,this.dataset.value,function(d){var b=document.getElementById('createDueBtn');b.dataset.value=d||'';b.textContent=d?formatDate(d):'\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026';b.className=d?'bc-date-btn':'bc-date-btn bc-date-btn--placeholder';})">Избери дата\u2026</button></div>
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
  if (!title) return showToast('Заглавието е задължително', 'warn');
  const data = {
    title, board_id: parseInt(document.getElementById('createBoard').value),
    column_id: parseInt(document.getElementById('createColumn').value),
    content: document.getElementById('createContent').value || null,
    due_on: document.getElementById('createDueBtn')?.dataset.value || null,
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
  try {
    const r = await fetch(`/api/cards/${cardId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({[field]:value}) });
    if (!r.ok) { const d = await r.json(); showToast(d.error || '\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0437\u0430\u043f\u0430\u0437\u0432\u0430\u043d\u0435', 'error'); }
  } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0437\u0430\u043f\u0430\u0437\u0432\u0430\u043d\u0435', 'error'); }
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
  try {
    await fetch('/api/cards/'+cardId+'/move', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({column_id:parseInt(columnId)}) });
    showToast('\u041a\u0430\u0440\u0442\u0430\u0442\u0430 \u0435 \u043f\u0440\u0435\u043c\u0435\u0441\u0442\u0435\u043d\u0430', 'success');
    router();
  } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u043f\u0440\u0435\u043c\u0435\u0441\u0442\u0432\u0430\u043d\u0435', 'error'); }
}
async function moveCardTo(cardId, value, sel) {
  if (!value) return;
  if (sel) sel.value = '';
  var parts = value.split(':');
  var columnId = parseInt(parts[0]);
  var hold = parts[1] === '1';
  try {
    await fetch('/api/cards/'+cardId+'/move', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({column_id:columnId}) });
    await fetch('/api/cards/'+cardId, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({is_on_hold:hold}) });
    showToast(hold ? '\u041a\u0430\u0440\u0442\u0430\u0442\u0430 \u0435 \u043d\u0430 \u0438\u0437\u0447\u0430\u043a\u0432\u0430\u043d\u0435' : '\u041a\u0430\u0440\u0442\u0430\u0442\u0430 \u0435 \u043f\u0440\u0435\u043c\u0435\u0441\u0442\u0435\u043d\u0430', 'success');
    router();
  } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u043f\u0440\u0435\u043c\u0435\u0441\u0442\u0432\u0430\u043d\u0435', 'error'); }
}
async function addAssignee(cardId, userId) {
  if (!userId) return;
  try {
    const card = await (await fetch(`/api/cards/${cardId}`)).json();
    const ids = (card.assignees||[]).map(a=>a.id).concat(parseInt(userId));
    await fetch(`/api/cards/${cardId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({assignee_ids:ids}) });
    router();
  } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0434\u043e\u0431\u0430\u0432\u044f\u043d\u0435', 'error'); }
}
async function toggleStep(cid, sid, done) {
  try { await fetch(`/api/cards/${cid}/steps/${sid}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({completed:done}) }); router(); } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u043e\u0431\u043d\u043e\u0432\u044f\u0432\u0430\u043d\u0435', 'error'); }
}
async function addStepFromPage(cardId) {
  var t = document.getElementById('newStepInput');
  if (!t || !t.value.trim()) return;
  var title = t.value.trim();
  try {
    await fetch('/api/cards/' + cardId + '/steps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title })
    });
    t.value = '';
    router();
  } catch(e) { showToast('Грешка при добавяне', 'error'); }
}
function replyToComment(cardId, commentId, userName) {
  _replyToComment = { id: commentId, userName: userName };
  expandCommentInput();
  var badge = document.getElementById('replyBadge');
  if (badge) {
    badge.style.display = 'flex';
    var nameEl = badge.querySelector('.bc-reply-badge__name');
    if (nameEl) nameEl.textContent = userName;
  }
  var wrap = document.getElementById('commentEditorWrap');
  if (wrap) setTimeout(function() { wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
}

function cancelReply() {
  _replyToComment = null;
  var badge = document.getElementById('replyBadge');
  if (badge) badge.style.display = 'none';
}

function scrollToComment(commentId) {
  var el = document.querySelector('[data-comment-id="' + commentId + '"]');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('bc-comment--highlight');
  setTimeout(function() { el.classList.remove('bc-comment--highlight'); }, 2000);
}

function setCommentSort(order) {
  _commentSortOrder = order;
  document.querySelectorAll('.bc-filter-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.sort === order);
  });
  applyCommentFilter();
}

function setCommentUser(userId) {
  _commentFilterUserId = userId || null;
  applyCommentFilter();
}

function applyCommentFilter() {
  var list = document.getElementById('commentsList');
  if (!list) return;
  // Move any hidden comments into the list first
  var hidden = document.getElementById('hiddenComments');
  if (hidden) {
    Array.from(hidden.querySelectorAll('.bc-comment')).forEach(function(el) { list.appendChild(el); });
    hidden.remove();
  }
  var moreBtn = document.getElementById('showMoreCommentsBtn');
  if (moreBtn) moreBtn.remove();
  var comments = Array.from(list.querySelectorAll('.bc-comment'));
  // Filter by user
  comments.forEach(function(el) {
    var show = !_commentFilterUserId || el.dataset.userId === String(_commentFilterUserId);
    el.style.display = show ? '' : 'none';
  });
  // Sort
  var visible = comments.filter(function(el) { return el.style.display !== 'none'; });
  visible.sort(function(a, b) {
    var ta = a.dataset.timestamp || '', tb = b.dataset.timestamp || '';
    return _commentSortOrder === 'asc' ? ta.localeCompare(tb) : tb.localeCompare(ta);
  });
  visible.forEach(function(el) { list.appendChild(el); });
}
async function addComment(cardId) {
  var input = document.getElementById('newCommentInput');
  var c = input ? input.value.trim() : '';
  if (!c || c === '<div><br></div>' || c === '<div></div>') return;
  var textContent = c.replace(/<[^>]*>/g, '');
  if (!textContent.trim()) return;
  var mentions = [];
  var mentionMatches = textContent.match(/@(\S+)/g);
  if (mentionMatches) {
    mentions = mentionMatches.map(function(m) { return m.substring(1).toLowerCase(); });
  }
  var mIds = allUsers.filter(function(u) { return mentions.some(function(n) { return u.name.toLowerCase().includes(n); }); }).map(function(u) { return u.id; });
  var btn = document.querySelector('.bc-btn-add-comment');
  if (btn) { btn.disabled = true; btn.textContent = 'Изпращане…'; }
  try {
    var r = await fetch('/api/cards/' + cardId + '/comments', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content:c,mentions:mIds,reply_to_id:_replyToComment?_replyToComment.id:null}) });
    if (!r.ok) { var d = await r.json(); showToast(d.error || 'Грешка', 'error'); if(btn){btn.disabled=false;btn.textContent='Добави коментар';} return; }
    router();
  } catch(e) { showToast('Грешка при изпращане', 'error'); if(btn){btn.disabled=false;btn.textContent='Добави коментар';} }
}

function showMoreComments() {
  var hidden = document.getElementById('hiddenComments');
  var btn = document.getElementById('showMoreCommentsBtn');
  if (!hidden || !btn) return;
  var BATCH = 10;
  var items = hidden.querySelectorAll('.bc-comment');
  var showing = 0;
  for (var i = 0; i < items.length && showing < BATCH; i++) {
    if (items[i].style.display === 'none' || items[i].parentElement === hidden) {
      items[i].style.display = '';
      hidden.parentElement.insertBefore(items[i], btn);
      showing++;
    }
  }
  if (hidden.querySelectorAll('.bc-comment').length === 0) {
    btn.style.display = 'none';
    hidden.remove();
  } else {
    btn.textContent = 'Покажи по-стари (' + hidden.querySelectorAll('.bc-comment').length + ')';
  }
}

// ==================== ACTIVITY ====================
let _activityItems = [];
function filterActivity(board, btn) {
  document.querySelectorAll('.activity-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const toShow = board === 'all' ? _activityItems : board === 'mine' ? _activityItems.filter(a => a.user_id === currentUser.id) : _activityItems.filter(a => a.board_title === board);
  const container = document.getElementById('activityList');
  if (!container) return;
  const campColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
  const getAvatarColor = (name) => campColors[(name||'').length % campColors.length];
  const grouped = {};
  toShow.forEach(a => {
    const d = new Date(a.created_at);
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
    const dateKey = d >= today ? 'ДНЕС' : d >= yesterday ? 'ВЧЕРА' : d.toLocaleDateString('bg', { month: 'long', day: 'numeric', year: 'numeric' });
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(a);
  });
  container.innerHTML = toShow.length === 0 ? '<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма активност</div>' :
    Object.entries(grouped).map(([date, entries]) =>
      '<div style="margin-bottom:24px"><div style="font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;padding:8px 0;border-bottom:1px solid var(--border);margin-bottom:8px">' + date + '</div>' +
      entries.map(a =>
        '<div class="activity-entry"><div class="activity-avatar" style="background:' + getAvatarColor(a.user_name) + '">' + initials(a.user_name||'') + '</div>' +
        '<div class="activity-body"><div class="activity-text"><strong>' + esc(a.user_name||'') + '</strong> ' +
        (a.action==='created'?'създаде':a.action==='commented'?'коментира':a.action==='moved'?'премести':a.action==='completed'?'завърши':a.action==='checked_off'?'отметна стъпка на':a.action==='archived'?'архивира':a.action==='updated'?'обнови':a.action) + ' ' +
        (a.target_type==='card' ? '<a href="#/card/' + a.target_id + '">' + esc(a.target_title||'') + '</a>' : esc(a.target_title||'')) + '</div>' +
        (a.excerpt ? '<div class="activity-excerpt">' + esc(a.excerpt).substring(0,150) + '</div>' : '') +
        '<div class="activity-meta">' + (a.board_title ? esc(a.board_title) + ' · ' : '') + timeAgo(a.created_at) + '</div></div></div>'
      ).join('') + '</div>'
    ).join('');
}
async function renderActivity(el) {
  setBreadcrumb(null); el.className = '';
  try {
    const _actRes = await fetch('/api/activity?limit=50');
    const _actData = await _actRes.json();
    const items = Array.isArray(_actData) ? _actData : [];
    const avatarColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
    const getAvatarColor = (name) => avatarColors[(name||'').length % avatarColors.length];

    _activityItems = items;
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
      if (a.action === 'archived') return 'архивира';
      if (a.action === 'updated') return 'обнови';
      return a.action;
    };

    window._activityOffset = items.length;
    el.innerHTML = `
      <div class="page-header"><h1>Последна активност</h1></div>
      <div style="display:flex;justify-content:center;gap:8px;margin-bottom:24px;flex-wrap:wrap">
        <button class="btn btn-sm activity-filter-btn active" style="background:var(--accent-dim);color:var(--accent);border-color:var(--accent)" onclick="filterActivity('all',this)">\u0412\u0441\u0438\u0447\u043a\u043e</button>
        <button class="btn btn-sm activity-filter-btn" onclick="filterActivity('mine',this)">\ud83d\udc64 \u041c\u043e\u0438\u0442\u0435</button>
        ${[...new Set(items.filter(a=>a.board_title).map(a=>a.board_title))].slice(0,5).map(b=>`<button class="btn btn-sm activity-filter-btn" onclick="filterActivity('${b.replace(/'/g,'')}',this)">${esc(b)}</button>`).join('')}
      </div>
      <div id="activityList" style="max-width:700px;margin:0 auto">
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
      </div>
      ${items.length >= 50 ? `<div style="text-align:center;padding:24px"><button class="btn btn-sm btn-ghost" id="loadMoreActivityBtn" onclick="loadMoreActivity(this)">\u0417\u0430\u0440\u0435\u0434\u0438 \u043f\u043e\u0432\u0435\u0447\u0435</button></div>` : ''}
      `;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

async function loadMoreActivity(btn) {
  if (!btn) return;
  btn.disabled = true; btn.textContent = '\u0417\u0430\u0440\u0435\u0436\u0434\u0430\u043d\u0435\u2026';
  try {
    const offset = window._activityOffset || 50;
    const more = await (await fetch('/api/activity?limit=50&offset=' + offset)).json();
    window._activityOffset = offset + more.length;
    if (!Array.isArray(more) || more.length === 0) { btn.parentElement.remove(); return; }
    _activityItems = (_activityItems || []).concat(more);
    const list = document.getElementById('activityList');
    if (!list) return;
    const avatarColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
    const getAC = n => avatarColors[(n||'').length % avatarColors.length];
    const actionText = a => { if(a.action==='created')return'\u0441\u044a\u0437\u0434\u0430\u0434\u0435'; if(a.action==='commented')return'\u043a\u043e\u043c\u0435\u043d\u0442\u0438\u0440\u0430'; if(a.action==='moved')return'\u043f\u0440\u0435\u043c\u0435\u0441\u0442\u0438'; if(a.action==='completed')return'\u0437\u0430\u0432\u044a\u0440\u0448\u0438'; if(a.action==='checked_off')return'\u043e\u0442\u043c\u0435\u0442\u043d\u0430 \u0441\u0442\u044a\u043f\u043a\u0430 \u043d\u0430'; if(a.action==='archived')return'\u0430\u0440\u0445\u0438\u0432\u0438\u0440\u0430'; if(a.action==='updated')return'\u043e\u0431\u043d\u043e\u0432\u0438'; return a.action; };
    const frag = document.createDocumentFragment();
    const div = document.createElement('div');
    div.innerHTML = more.map(a => `<div class="activity-entry">
      <div class="activity-avatar" style="background:${getAC(a.user_name)}">${initials(a.user_name||'')}</div>
      <div class="activity-body">
        <div class="activity-text"><strong>${esc(a.user_name||'')}</strong> ${actionText(a)} ${a.target_type==='card'?`<a href="#/card/${a.target_id}">${esc(a.target_title||'')}</a>`:esc(a.target_title||'')}</div>
        ${a.excerpt ? `<div class="activity-excerpt">${esc(a.excerpt).substring(0,150)}</div>` : ''}
        <div class="activity-meta">${a.board_title ? esc(a.board_title) + ' \u00b7 ' : ''}${timeAgo(a.created_at)}</div>
      </div></div>`).join('');
    list.appendChild(div);
    if (more.length < 50) btn.parentElement.remove();
    else { btn.disabled = false; btn.textContent = '\u0417\u0430\u0440\u0435\u0434\u0438 \u043f\u043e\u0432\u0435\u0447\u0435'; }
  } catch { btn.disabled = false; btn.textContent = '\u0413\u0440\u0435\u0448\u043a\u0430 — \u043f\u0440\u043e\u0431\u0432\u0430\u0439 \u043f\u0430\u043a'; }
}

// ==================== MY STUFF ====================
async function renderMyStuff(el) {
  setBreadcrumb(null); el.className = '';
  try {
    const cards = await (await fetch(`/api/cards?assignee_id=${currentUser.id}`)).json();
    const now = new Date(); now.setHours(0,0,0,0);
    const overdue  = cards.filter(c => c.due_on && new Date(c.due_on+'T00:00:00') < now);
    const upcoming = cards.filter(c => c.due_on && new Date(c.due_on+'T00:00:00') >= now);
    const noDate   = cards.filter(c => !c.due_on);
    const renderCard = c => {
      const pri = c.priority === 'urgent' ? '\ud83d\udd34 ' : c.priority === 'high' ? '\u2191 ' : '';
      const cls = getCardColorClass(c);
      const dueStyle = cls==='overdue' ? 'color:var(--red);font-weight:600' : cls==='deadline-today' ? 'color:var(--yellow);font-weight:600' : '';
      const duePrefix = cls==='overdue' ? '\u26a0 ' : cls==='deadline-today' ? '\u23f0 ' : '';
      return `<a class="task-row ${cls}" href="#/card/${c.id}">
        <span class="task-title">${pri}${esc(c.title)}</span>
        <span class="task-meta">
          ${c.client_name ? `<span class="task-board" style="color:var(--accent)">${esc(c.client_name)}</span>` : ''}
          ${c.board_title ? `<span class="task-board">${esc(c.board_title)}</span>` : ''}
          ${c.column_title ? `<span class="task-board" style="opacity:0.6">${esc(c.column_title)}</span>` : ''}
          ${c.steps_total > 0 ? `<span style="font-size:10px;color:var(--green)">✓ ${c.steps_done}/${c.steps_total}</span>` : ''}
          ${c.due_on ? `<span class="task-due" style="${dueStyle}">${duePrefix}${formatDate(c.due_on)}</span>` : ''}
        </span>
      </a>`;
    };
    el.innerHTML = `
      <div class="page-header"><h1>Моите задачи</h1><div class="page-subtitle">${cards.length} задачи</div></div>
      <div class="task-list" style="max-width:760px;margin:0 auto">
        ${cards.length===0 ? '<div style="text-align:center;padding:40px;color:var(--text-dim)"><div style="font-size:48px;opacity:0.3;margin-bottom:8px">✓</div>Нямаш задачи в момента</div>' : ''}
        ${overdue.length  > 0 ? `<div class="task-section-label" style="color:var(--red)">🔴 Просрочени (${overdue.length})</div>${overdue.map(renderCard).join('')}` : ''}
        ${upcoming.length > 0 ? `<div class="task-section-label">📅 Предстоящи (${upcoming.length})</div>${upcoming.map(renderCard).join('')}` : ''}
        ${noDate.length   > 0 ? `<div class="task-section-label" style="opacity:0.6">Без дата (${noDate.length})</div>${noDate.map(renderCard).join('')}` : ''}
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

// ==================== NOTIFICATIONS ====================
async function renderNotifications(el) {
  setBreadcrumb(null); el.className = '';
  try {
    const items = await (await fetch('/api/notifications')).json();
    const unreadCount = items.filter(n => !n.is_read).length;
    // Auto-mark as read on full page view
    if (unreadCount > 0) { fetch('/api/notifications/read-all', { method:'PUT' }); updateHeyBadge(); }

    const listHtml = items.length === 0
      ? '<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма нищо ново за теб.</div>'
      : items.map(n => {
          const senderName = n.sender_name || '';
          const av = senderName ? initials(senderName) : '?';
          const link = n.reference_type === 'card' ? `#/card/${n.reference_id}` : '#';
          const scrollId = (n.reference_type === 'card' && n.comment_id) ? n.comment_id : null;
          return `<a class="hey-item${n.is_read ? '' : ' unread'}" href="${link}"${scrollId ? ` onclick="_pendingScrollCommentId=${scrollId}"` : ''}>
            <div class="hey-item__av">${av}</div>
            <div class="hey-item__content">
              <div class="hey-item__subject">${esc(n.title)}</div>
              ${n.body ? `<div class="hey-item__preview">${esc(n.body)}</div>` : ''}
              <div class="hey-item__meta">${timeAgo(n.created_at)}</div>
            </div>
            ${!n.is_read ? '<div class="hey-item__unread-dot"></div>' : ''}
          </a>`;
        }).join('');

    el.innerHTML = `
      <div class="page-header">
        <h1>Hey!</h1>
        <div class="page-subtitle">Твоите известия</div>
      </div>
      <div style="max-width:640px;margin:0 auto;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;overflow:hidden">
        ${listHtml}
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
  const i=document.getElementById('chatInput'), c=i?.value?.trim(); if(!c)return;
  i.value = '';
  try {
    const res = await fetch(`/api/chat/channels/${chId}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:c})});
    const msg = await res.json();
    if (msg && msg.id) appendChatMsg(msg);
  } catch {}
}
function appendChatMsg(msg) {
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  const chatColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
  const mc = chatColors[(msg.user_name||'').length % chatColors.length];
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = '<div class="chat-msg-avatar" style="background:' + mc + ';color:#fff">' + initials(msg.user_name) + '</div>' +
    '<div class="chat-msg-body"><div class="chat-msg-name">' + esc(msg.user_name) +
    ' <span class="hint">' + new Date(msg.created_at).toLocaleTimeString('bg',{hour:'2-digit',minute:'2-digit'}) + '</span></div>' +
    '<div class="chat-msg-text">' + esc(msg.content).replace(/\n/g,'<br>') + '</div></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

// ==================== MESSAGE BOARD ====================
async function renderMessageBoard(el) {
  setBreadcrumb([{label:'Съобщения'}]); el.className='';
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
function createMessage() {
  var ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box"><p class="confirm-modal-msg">\u041d\u043e\u0432\u043e \u0441\u044a\u043e\u0431\u0449\u0435\u043d\u0438\u0435</p>' +
    '<input class="confirm-modal-input" id="msgTitle" placeholder="\u0417\u0430\u0433\u043b\u0430\u0432\u0438\u0435\u2026">' +
    '<textarea class="confirm-modal-input" id="msgContent" rows="4" placeholder="\u0421\u044a\u0434\u044a\u0440\u0436\u0430\u043d\u0438\u0435 (\u043d\u0435\u0437\u0430\u0434\u044a\u043b\u0436\u0438\u0442\u0435\u043b\u043d\u043e)\u2026" style="resize:vertical"></textarea>' +
    '<div class="confirm-modal-actions"><button class="btn btn-primary" id="msgOk">\u0421\u044a\u0437\u0434\u0430\u0439</button><button class="btn btn-ghost" id="msgCancel">\u041e\u0442\u043a\u0430\u0437</button></div></div>';
  document.body.appendChild(ov);
  var inp = ov.querySelector('#msgTitle'); setTimeout(function(){ inp.focus(); }, 50);
  ov.querySelector('#msgOk').onclick = async function() {
    var t = ov.querySelector('#msgTitle').value.trim(); if (!t) { ov.querySelector('#msgTitle').focus(); return; }
    var c = ov.querySelector('#msgContent').value;
    ov.remove();
    try { await fetch('/api/messageboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t,content:c})}); router(); } catch {}
  };
  ov.querySelector('#msgCancel').onclick = function() { ov.remove(); };
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
  ov.querySelector('#msgTitle').onkeydown = function(e) { if (e.key === 'Escape') ov.remove(); };
}
async function generateDailyReport() {
  try { await fetch('/api/messageboard/daily-report',{method:'POST'}); router(); } catch {}
}

// ==================== VAULT ====================
async function renderVault(el, folderId) {
  el.className='';
  try {
    const url = folderId ? `/api/vault/folders?parent_id=${folderId}` : '/api/vault/folders';
    const data = await (await fetch(url)).json();
    const { folders, files, current_folder } = data;
    const folderName = current_folder ? current_folder.name : null;
    setBreadcrumb(folderId && folderName
      ? [{label:'Документи',href:'#/vault'},{label:folderName}]
      : [{label:'Документи'}]);
    const canDel = canManage();
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <button class="btn btn-primary btn-sm" onclick="createVaultFolder(${folderId||'null'})">📁 Нова папка</button>
        <h1 style="font-size:22px;font-weight:800;color:#fff;text-align:center;flex:1">Документи</h1>
        <label class="btn btn-sm" style="cursor:pointer">📎 Качи файл<input type="file" style="display:none" onchange="uploadVaultFile(this,${folderId||'null'})"></label>
      </div>
      ${folderId?'<a href="#/vault" class="btn btn-sm" style="margin-bottom:16px;display:inline-flex">← Назад</a>':''}
      <div class="vault-grid">
        ${folders.map(f=>`<div class="vault-item folder" style="position:relative">
          <a href="#/vault/${f.id}" style="display:contents"><span class="vault-icon">📁</span><span class="vault-name">${esc(f.name)}</span></a>
          ${canDel ? `<button onclick="deleteVaultFolder(${f.id})" style="position:absolute;top:6px;right:6px;background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:14px;opacity:0;transition:opacity .15s" class="vault-del-btn" title="Изтрий папка">✕</button>` : ''}
        </div>`).join('')}
        ${files.map(f=>`<div class="vault-item file" style="position:relative">
          <a href="${f.storage_path}" target="_blank" class="vault-icon">${getFileIcon(f.mime_type)}</a>
          <span class="vault-name">${esc(f.original_name)}</span>
          <span class="hint">${formatFileSize(f.size_bytes)}</span>
          ${canDel ? `<button onclick="deleteVaultFile(${f.id})" style="position:absolute;top:6px;right:6px;background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:14px;opacity:0;transition:opacity .15s" class="vault-del-btn" title="Изтрий файл">✕</button>` : ''}
        </div>`).join('')}
        ${folders.length===0&&files.length===0?'<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-dim)">Празна папка</div>':''}
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
function createVaultFolder(pid) { showPromptModal('\u041d\u043e\u0432\u0430 \u043f\u0430\u043f\u043a\u0430', '\u0412\u044a\u0432\u0435\u0434\u0438 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435\u2026', '', async function(n) { try { await fetch('/api/vault/folders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,parent_id:pid})}); router(); } catch {} }); }
async function uploadVaultFile(input,fid) { if(!input.files[0])return; const f=new FormData(); f.append('file',input.files[0]); if(fid)f.append('folder_id',fid); try { await fetch('/api/vault/upload',{method:'POST',body:f}); router(); } catch {} }
function deleteVaultFile(id) { showConfirmModal('\u0418\u0437\u0442\u0440\u0438\u0439 \u0444\u0430\u0439\u043b\u0430?', async function() { try{ await fetch('/api/vault/files/'+id,{method:'DELETE'}); router(); }catch{} }, true); }
function deleteVaultFolder(id) { showConfirmModal('\u0418\u0437\u0442\u0440\u0438\u0439 \u043f\u0430\u043f\u043a\u0430\u0442\u0430 \u0438 \u0432\u0441\u0438\u0447\u043a\u043e \u0432 \u043d\u0435\u044f?', async function() { try{ await fetch('/api/vault/folders/'+id,{method:'DELETE'}); router(); }catch{} }, true); }
function getFileIcon(m) { if(m?.startsWith('image/'))return'🖼️'; if(m?.startsWith('video/'))return'🎬'; if(m?.includes('pdf'))return'📄'; return'📎'; }
function formatFileSize(b) { if(!b)return''; if(b<1024)return b+' B'; if(b<1048576)return(b/1024).toFixed(1)+' KB'; return(b/1048576).toFixed(1)+' MB'; }

// ==================== CAMPFIRE (Group Chat) ====================
async function renderCampfire(el, roomId) {
  setBreadcrumb([{label:'🔥 Campfire',href:`#/campfire/${roomId}`}]);
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
            const isSystem = !m.user_id;
            const mc = isSystem ? '#1a3040' : campColors[(m.user_name||'').length % campColors.length];
            const avatarContent = isSystem ? '📊' : initials(m.user_name);
            const msgContent = parseCampfireMarkdown(m.content || '');
            return `<div class="chat-msg${isSystem ? ' campfire-system-msg' : ''}">
              <div class="chat-msg-avatar" style="background:${mc};color:#fff">${avatarContent}</div>
              <div class="chat-msg-body">
                <div class="chat-msg-name">${esc(m.user_name || 'Система')} <span class="hint">${new Date(m.created_at).toLocaleTimeString('bg',{hour:'2-digit',minute:'2-digit'})}</span></div>
                <div class="chat-msg-text">${msgContent}</div>
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
function parseCampfireMarkdown(text) {
  return esc(text)
    .replace(/\n/g, '<br>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}
async function sendCampfireMsg(roomId) {
  const i = document.getElementById('campfireInput'), c = i?.value?.trim(); if(!c) return;
  i.value = '';
  try {
    const res = await fetch(`/api/campfire/rooms/${roomId}/messages`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:c})});
    const msg = await res.json();
    if (msg && msg.id) appendCampfireMsg(msg);
  } catch {}
}
function appendCampfireMsg(msg) {
  const msgs = document.getElementById('campfireMessages');
  if (!msgs) return;
  const campColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
  const isSystem = !msg.user_id;
  const mc = isSystem ? '#1a3040' : campColors[(msg.user_name||'').length % campColors.length];
  const avatarContent = isSystem ? '📊' : initials(msg.user_name);
  const msgContent = parseCampfireMarkdown(msg.content || '');
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isSystem ? ' campfire-system-msg' : '');
  div.innerHTML = '<div class="chat-msg-avatar" style="background:' + mc + ';color:#fff">' + avatarContent + '</div>' +
    '<div class="chat-msg-body"><div class="chat-msg-name">' + esc(msg.user_name || 'Система') +
    ' <span class="hint">' + new Date(msg.created_at).toLocaleTimeString('bg',{hour:'2-digit',minute:'2-digit'}) + '</span></div>' +
    '<div class="chat-msg-text">' + msgContent + '</div></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
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
  setBreadcrumb([{label:'График',href:'#/schedule'}]);
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
function createScheduleEvent() {
  var today = new Date().toISOString().split('T')[0];
  var ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box"><p class="confirm-modal-msg">\u041d\u043e\u0432\u043e \u0441\u044a\u0431\u0438\u0442\u0438\u0435</p>' +
    '<input class="confirm-modal-input" id="evTitle" placeholder="\u0417\u0430\u0433\u043b\u0430\u0432\u0438\u0435\u2026">' +
    '<button class="bc-date-btn" id="evDate" data-value="' + today + '" onclick="event.stopPropagation();showDatePickerPopup(this,this.dataset.value,function(d){var b=document.getElementById(\'evDate\');if(b){b.dataset.value=d||\'\';b.textContent=d?formatDate(d):\'Избери дата\u2026\';b.className=d?\'bc-date-btn\':\'bc-date-btn bc-date-btn--placeholder\';}})" style="margin-bottom:8px;width:100%;text-align:left">' + formatDate(today) + '</button>' +
    '<div class="confirm-modal-actions"><button class="btn btn-primary" id="evOk">\u0421\u044a\u0437\u0434\u0430\u0439</button><button class="btn btn-ghost" id="evCancel">\u041e\u0442\u043a\u0430\u0437</button></div></div>';
  document.body.appendChild(ov);
  setTimeout(function(){ ov.querySelector('#evTitle').focus(); }, 50);
  ov.querySelector('#evOk').onclick = async function() {
    var t = ov.querySelector('#evTitle').value.trim(); if (!t) { ov.querySelector('#evTitle').focus(); return; }
    var d = ov.querySelector('#evDate').dataset.value; if (!d) { showToast('\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430', 'warn'); return; }
    ov.remove();
    try { await fetch('/api/schedule', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t,starts_at:d+'T09:00:00',all_day:true})}); router(); } catch {}
  };
  ov.querySelector('#evCancel').onclick = function() { ov.remove(); };
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
  ov.querySelector('#evTitle').onkeydown = function(e) { if (e.key === 'Escape') ov.remove(); };
}

// ==================== PRODUCTION CALENDAR ====================
async function renderCalendar(el) {
  setBreadcrumb([{label:'Производствен Календар',href:'#/calendar'}]);
  el.className = '';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const now = new Date();
  const year  = parseInt(params.get('y')) || now.getFullYear();
  const month = parseInt(params.get('m'));
  const m = isNaN(month) ? now.getMonth() : month;
  const monthStr = `${year}-${String(m+1).padStart(2,'0')}`;

  el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-dim)">Зареждане...</div>';

  try {
    const data = await (await fetch(`/api/reports/calendar?month=${monthStr}`)).json();
    const { dueCards, publishCards, stepDues } = data;

    // Group all items by date string
    const byDate = {};
    const addItem = (item) => {
      const d = (item.date || '').split('T')[0];
      if (!d) return;
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(item);
    };
    dueCards.forEach(addItem);
    publishCards.forEach(addItem);
    stepDues.forEach(addItem);

    const monthName = new Date(year, m).toLocaleDateString('bg', {month:'long', year:'numeric'});
    // Week starts Monday: shift Sunday (0) to 6, others -1
    const rawFirst = new Date(year, m, 1).getDay();
    const firstDay = (rawFirst + 6) % 7;
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    const todayD = (year === now.getFullYear() && m === now.getMonth()) ? now.getDate() : -1;
    const dayNames = ['ПН','ВТ','СР','ЧТ','ПТ','СБ','НД'];

    const prevM = m === 0 ? 11 : m - 1, prevY = m === 0 ? year-1 : year;
    const nextM = m === 11 ? 0  : m + 1, nextY = m === 11 ? year+1 : year;

    let cells = '';
    for (let i = 0; i < firstDay; i++) cells += '<div class="prod-cal-day prod-cal-day--empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const items = byDate[dateStr] || [];
      const dueN     = items.filter(i => i.type === 'due').length;
      const pubN     = items.filter(i => i.type === 'publish').length;
      const stepN    = items.filter(i => i.type === 'step').length;
      const isToday  = d === todayD;
      const colIdx   = (firstDay + d - 1) % 7; // 0=Mon … 6=Sun
      const isWeekend = colIdx >= 5;

      let dotsHtml = '';
      if (dueN)  dotsHtml += `<span class="prod-cal-dot prod-cal-dot--due">${dueN}</span>`;
      if (pubN)  dotsHtml += `<span class="prod-cal-dot prod-cal-dot--publish">${pubN}</span>`;
      if (stepN) dotsHtml += `<span class="prod-cal-dot prod-cal-dot--step">${stepN}</span>`;

      cells += `<div class="prod-cal-day ${isToday?'prod-cal-day--today':''} ${isWeekend?'prod-cal-day--weekend':''} ${items.length?'prod-cal-day--has-events':''}"
                    onclick="toggleCalDay('${dateStr}')">
        <div class="prod-cal-day__num">${d}</div>
        <div class="prod-cal-day__dots">${dotsHtml}</div>
      </div>`;
    }

    el.innerHTML = `
      <div style="max-width:980px;margin:0 auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
          <button class="btn btn-sm" onclick="location.hash='#/calendar?y=${prevY}&m=${prevM}'">&larr; Предишен</button>
          <div style="text-align:center">
            <h1 style="font-size:21px;font-weight:800;color:#fff;text-transform:capitalize;margin-bottom:6px">${monthName}</h1>
            <div class="prod-cal-legend">
              <span class="prod-cal-legend-item"><span class="prod-cal-dot prod-cal-dot--due">N</span> Краен срок</span>
              <span class="prod-cal-legend-item"><span class="prod-cal-dot prod-cal-dot--publish">N</span> Публикуване</span>
              <span class="prod-cal-legend-item"><span class="prod-cal-dot prod-cal-dot--step">N</span> Стъпка</span>
            </div>
          </div>
          <button class="btn btn-sm" onclick="location.hash='#/calendar?y=${nextY}&m=${nextM}'">Следващ &rarr;</button>
        </div>
        <div class="prod-cal">
          <div class="prod-cal-header">${dayNames.map(d=>`<div class="prod-cal-header__day">${d}</div>`).join('')}</div>
          <div class="prod-cal-grid">${cells}</div>
        </div>
        <div id="calDayDetail" style="margin-top:16px"></div>
      </div>`;

    // Store for click handler
    window._calData = byDate;
  } catch(e) { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка при зареждане</div>'; }
}

function toggleCalDay(dateStr) {
  const detail = document.getElementById('calDayDetail');
  if (!detail) return;
  const items = (window._calData || {})[dateStr] || [];

  // Toggle off if same date is clicked again
  if (detail.dataset.date === dateStr && detail.innerHTML) { detail.innerHTML = ''; detail.dataset.date = ''; return; }
  detail.dataset.date = dateStr;

  if (!items.length) { detail.innerHTML = ''; return; }

  const dateLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('bg-BG', {weekday:'long',day:'numeric',month:'long'});
  const due     = items.filter(i => i.type === 'due');
  const publish = items.filter(i => i.type === 'publish');
  const steps   = items.filter(i => i.type === 'step');

  let html = `<div class="prod-cal-detail"><h3>📅 ${dateLabel}</h3>`;

  if (due.length) {
    html += `<div class="prod-cal-detail__section"><div class="prod-cal-detail__label">📌 Краен срок (${due.length})</div>`;
    html += due.map(c => {
      const who = Array.isArray(c.assignees) && c.assignees.length
        ? c.assignees.map(a=>a.name).filter(Boolean).join(', ') : '';
      return `<a class="prod-cal-detail__item" href="#/card/${c.id}">
        <span style="color:#60a5fa;margin-left:0">📌</span> ${esc(c.title)}
        <span>${who ? esc(who)+' · ' : ''}${esc(c.board_title||'')}</span>
      </a>`;
    }).join('');
    html += '</div>';
  }

  if (publish.length) {
    html += `<div class="prod-cal-detail__section"><div class="prod-cal-detail__label">🎬 Публикуване (${publish.length})</div>`;
    html += publish.map(c => `<a class="prod-cal-detail__item" href="#/card/${c.id}">
      <span style="color:#46a374;margin-left:0">🎬</span> ${esc(c.title)}
      <span>${c.client_name ? esc(c.client_name)+' · ' : ''}${esc(c.board_title||'')}</span>
    </a>`).join('');
    html += '</div>';
  }

  if (steps.length) {
    html += `<div class="prod-cal-detail__section"><div class="prod-cal-detail__label">📋 Стъпки (${steps.length})</div>`;
    html += steps.map(c => `<a class="prod-cal-detail__item" href="#/card/${c.card_id}">
      <span style="color:#eab308;margin-left:0">📋</span> ${esc(c.title)}
      <span>→ ${esc(c.card_title||'')}</span>
    </a>`).join('');
    html += '</div>';
  }

  html += '</div>';
  detail.innerHTML = html;
  setTimeout(() => detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

// ==================== AUTOMATIC CHECK-INS ====================
async function renderCheckins(el) {
  setBreadcrumb([{label:'✋ Дейности'}]);
  el.className = '';
  try {
    const [questions, pending] = await Promise.all([
      (await fetch('/api/checkins/questions')).json(),
      (await fetch('/api/checkins/my-pending')).json()
    ]);

    el.innerHTML = `
      <div style="max-width:700px;margin:0 auto">
        <div class="page-header">
          <h1>✋ Дейности</h1>
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
function createCheckinQuestion() {
  var ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box"><p class="confirm-modal-msg">\u041d\u043e\u0432 \u0447\u0435\u043a-\u0438\u043d \u0432\u044a\u043f\u0440\u043e\u0441</p>' +
    '<input class="confirm-modal-input" id="ciQ" placeholder="\u041d\u0430\u043f\u0440. \u201e\u041a\u0430\u043a\u0432\u043e \u0441\u0432\u044a\u0440\u0448\u0438 \u0434\u043d\u0435\u0441?\u201c">' +
    '<input class="confirm-modal-input" id="ciCron" value="0 9 * * 1-5" placeholder="Cron \u0438\u0437\u0440\u0430\u0437\u2026">' +
    '<div style="font-size:11px;color:var(--text-dim);margin:-10px 0 14px">\u041f\u043e \u043f\u043e\u0434\u0440\u0430\u0437\u0431\u0438\u0440\u0430\u043d\u0435: \u0432\u0441\u0435\u043a\u0438 \u0434\u0435\u043b\u043d\u0438\u0447\u0435\u043d \u0434\u0435\u043d \u0432 9:00</div>' +
    '<div class="confirm-modal-actions"><button class="btn btn-primary" id="ciOk">\u0421\u044a\u0437\u0434\u0430\u0439</button><button class="btn btn-ghost" id="ciCancel">\u041e\u0442\u043a\u0430\u0437</button></div></div>';
  document.body.appendChild(ov);
  setTimeout(function(){ ov.querySelector('#ciQ').focus(); }, 50);
  ov.querySelector('#ciOk').onclick = async function() {
    var q = ov.querySelector('#ciQ').value.trim(); if (!q) { ov.querySelector('#ciQ').focus(); return; }
    var cron = ov.querySelector('#ciCron').value || '0 9 * * 1-5';
    ov.remove();
    try { await fetch('/api/checkins/questions', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q,schedule_cron:cron})}); router(); } catch {}
  };
  ov.querySelector('#ciCancel').onclick = function() { ov.remove(); };
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
  ov.querySelector('#ciQ').onkeydown = function(e) { if (e.key === 'Escape') ov.remove(); };
}
async function viewCheckinResponses(questionId) {
  try {
    const responses = await (await fetch(`/api/checkins/questions/${questionId}/responses`)).json();
    const campColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308'];
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    var inner = document.createElement('div');
    inner.style.cssText = 'background:var(--bg-card);border:1px solid var(--border);border-radius:12px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;padding:24px';
    inner.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
      '<h3 style="font-size:16px;font-weight:700;color:#fff">\u041e\u0442\u0433\u043e\u0432\u043e\u0440\u0438 (' + responses.length + ')</h3>' +
      '<button onclick="this.closest(\'.modal-overlay\').remove()" style="background:none;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;line-height:1">\u2715</button>' +
      '</div>' +
      (responses.length === 0
        ? '<div style="text-align:center;color:var(--text-dim);padding:24px">\u041d\u044f\u043c\u0430 \u043e\u0442\u0433\u043e\u0432\u043e\u0440\u0438 \u0432\u0441\u0435 \u043e\u0449\u0435</div>'
        : responses.map(function(r) {
            var col = campColors[(r.user_name||'').length % campColors.length];
            return '<div style="padding:12px 0;border-bottom:1px solid var(--border)">' +
              '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
              '<div style="width:28px;height:28px;border-radius:50%;background:' + col + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0">' + initials(r.user_name||'') + '</div>' +
              '<strong style="font-size:13px;color:#fff">' + esc(r.user_name||'') + '</strong>' +
              '<span style="font-size:11px;color:var(--text-dim);margin-left:6px">' + timeAgo(r.created_at) + '</span>' +
              '</div>' +
              '<div style="font-size:13px;color:var(--text-secondary);padding-left:36px">' + esc(r.content||'') + '</div>' +
              '</div>';
          }).join(''));
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
  } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0437\u0430\u0440\u0435\u0436\u0434\u0430\u043d\u0435', 'error'); }
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
            <h2 style="font-size:16px;font-weight:700;color:#fff;margin-bottom:20px">Настройки на системата</h2>
            <div id="adminSettingsContent" style="color:var(--text-dim);text-align:center;padding:40px">Зареждане...</div>
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
  if (tab === 'settings') loadAdminSettings();
}
function createNewUser() {
  var ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box"><p class="confirm-modal-msg">\u041d\u043e\u0432 \u043f\u043e\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043b</p>' +
    '<input class="confirm-modal-input" id="nuName" placeholder="\u0418\u043c\u0435\u2026">' +
    '<input class="confirm-modal-input" type="email" id="nuEmail" placeholder="\u0418\u043c\u0435\u0439\u043b\u2026">' +
    '<input class="confirm-modal-input" type="password" id="nuPass" placeholder="\u041f\u0430\u0440\u043e\u043b\u0430\u2026">' +
    '<div class="confirm-modal-actions"><button class="btn btn-primary" id="nuOk">\u0421\u044a\u0437\u0434\u0430\u0439</button><button class="btn btn-ghost" id="nuCancel">\u041e\u0442\u043a\u0430\u0437</button></div></div>';
  document.body.appendChild(ov);
  setTimeout(function(){ ov.querySelector('#nuName').focus(); }, 50);
  ov.querySelector('#nuOk').onclick = async function() {
    var name = ov.querySelector('#nuName').value.trim(); if (!name) { ov.querySelector('#nuName').focus(); return; }
    var email = ov.querySelector('#nuEmail').value.trim(); if (!email) { ov.querySelector('#nuEmail').focus(); return; }
    var password = ov.querySelector('#nuPass').value; if (!password) { ov.querySelector('#nuPass').focus(); return; }
    ov.remove();
    try { await fetch('/api/users', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password})}); router(); } catch {}
  };
  ov.querySelector('#nuCancel').onclick = function() { ov.remove(); };
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
  ov.querySelector('#nuName').onkeydown = function(e) { if (e.key === 'Escape') ov.remove(); };
}
async function changeUserRole(userId, role) {
  try { await fetch(`/api/users/${userId}/role`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})}); } catch {}
}
async function toggleUserActive(userId, active) {
  try { await fetch(`/api/users/${userId}/active`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_active:active})}); router(); } catch {}
}

// ==================== ADMIN SETTINGS ====================
async function loadAdminSettings() {
  const el = document.getElementById('adminSettingsContent');
  if (!el) return;
  try {
    const [settingsRes, roomsRes, boardsRes] = await Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/campfire/rooms').then(r => r.json()),
      fetch('/api/boards').then(r => r.json())
    ]);
    const s = settingsRes.settings || {};
    const rooms = Array.isArray(roomsRes) ? roomsRes : [];
    const boardsList = Array.isArray(boardsRes) ? boardsRes : [];
    const allCols = boardsList.flatMap(b => (b.columns || []).map(c => ({ ...c, board_title: b.title })));
    const colOpts = (settingKey) => `<option value="">— изберете колона —</option>` +
      allCols.map(c => `<option value="${c.id}" ${String(s[settingKey]) === String(c.id) ? 'selected' : ''}>${esc(c.board_title)} → ${esc(c.title)}</option>`).join('');
    const roomOpts = rooms.map(r => `<option value="${r.id}" ${String(s.daily_report_room_id) === String(r.id) ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
    const reportEnabled = s.daily_report_enabled !== 'false';

    el.innerHTML = `
      <div class="admin-settings-section">
        <h3>📊 Дневен отчет <span class="info-tooltip" title="Автоматично публикува сутрешен отчет в Campfire — задачи за деня, публикации и просрочени.">ⓘ</span></h3>
        <div class="admin-setting-row">
          <label>Активен</label>
          <label class="toggle-switch">
            <input type="checkbox" ${reportEnabled ? 'checked' : ''} onchange="saveSetting('daily_report_enabled', this.checked ? 'true' : 'false')">
            <span class="toggle-track"></span>
          </label>
          <span style="font-size:11px;color:var(--text-dim)">${reportEnabled ? 'включен' : 'изключен'}</span>
        </div>
        <div class="admin-setting-row">
          <label>Campfire канал</label>
          <select class="input-sm" onchange="saveSetting('daily_report_room_id', this.value)">${roomOpts || '<option>Няма канали</option>'}</select>
        </div>
        <div class="admin-setting-row">
          <label>Час (cron израз)</label>
          <input class="input-sm" type="text" value="${esc(s.daily_report_cron || '30 9 * * 1-5')}"
                 style="width:140px" placeholder="30 9 * * 1-5"
                 onblur="saveSetting('daily_report_cron', this.value)">
          <span style="font-size:11px;color:var(--text-dim)">Пн–Пт 9:30</span>
        </div>
        <div class="admin-setting-row">
          <label>Ръчен тест</label>
          <button class="btn btn-sm" onclick="testDailyReport(this)">📤 Изпрати сега</button>
          <span style="font-size:11px;color:var(--text-dim)">Изпраща незабавно в избрания канал</span>
        </div>
      </div>

      <div class="admin-settings-section">
        <h3>💬 Коментари</h3>
        <div class="admin-setting-row">
          <label>Прозорец за редакция</label>
          <input class="input-sm" type="number" min="0" max="1440" style="width:70px"
                 value="${esc(s.comment_edit_window_minutes || '10')}"
                 onblur="saveSetting('comment_edit_window_minutes', this.value)">
          <span style="font-size:11px;color:var(--text-dim)">минути след изпращане</span>
        </div>
      </div>

      <div class="admin-settings-section">
        <h3>🤖 КП Автоматизация <span class="info-tooltip" title="Настройки за автоматично генериране на видео задачи от КП карти.">ⓘ</span></h3>
        <div class="admin-setting-row">
          <label>Колона "Измисляне"</label>
          <select class="input-sm" style="max-width:280px" onchange="saveSetting('kp_izmislyane_column_id', this.value)">${colOpts('kp_izmislyane_column_id')}</select>
          <span style="font-size:11px;color:var(--text-dim)">тук се пускат КП картите</span>
        </div>
        <div class="admin-setting-row">
          <label>Колона "Разпределение"</label>
          <select class="input-sm" style="max-width:280px" onchange="saveSetting('kp_razpredelenie_column_id', this.value)">${colOpts('kp_razpredelenie_column_id')}</select>
          <span style="font-size:11px;color:var(--text-dim)">тук отиват видео задачите</span>
        </div>
        <div class="admin-setting-row">
          <label>Стъпки за видео карта</label>
          <span style="color:#fff;font-weight:600">17</span>
          <span style="font-size:11px;color:var(--text-dim)">фиксирано — от концепция до публикуване</span>
        </div>
        <div class="admin-setting-row">
          <label>Работни дни преди публ.</label>
          <span style="color:#fff;font-weight:600">10 → 0</span>
          <span style="font-size:11px;color:var(--text-dim)">автоматично изчислени</span>
        </div>
      </div>`;
  } catch(e) {
    el.innerHTML = '<div style="color:var(--red);padding:20px">Грешка при зареждане: ' + esc(e.message) + '</div>';
  }
}

async function saveSetting(key, value) {
  try {
    const res = await fetch(`/api/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(value) })
    });
    if (!res.ok) console.error('Save setting failed:', key, value);
  } catch(e) { console.error('Save setting error:', e); }
}

async function testDailyReport(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генериране...'; }
  try {
    const res = await fetch('/api/settings/daily-report/trigger', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      if (btn) { btn.textContent = '✅ Изпратено!'; }
      setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '📤 Изпрати сега'; } }, 3000);
    } else {
      showToast('Грешка: ' + (data.error || 'Неизвестна'), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '📤 Изпрати сега'; }
    }
  } catch(e) {
    showToast('Грешка: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📤 Изпрати сега'; }
  }
}

// ==================== REPORTS ====================
function renderReportRow(c, tab) {
  const now = new Date(); now.setHours(0,0,0,0);
  const isOver = c.due_on && new Date(c.due_on+'T00:00:00') < now;
  const priLabel = c.priority === 'urgent' ? '<span style="color:var(--red);font-weight:700;font-size:11px">\ud83d\udd34</span>' : c.priority === 'high' ? '<span style="color:var(--yellow);font-weight:700;font-size:11px">\u2191</span>' : '';
  return '<a class="task-row ' + (isOver ? 'overdue' : '') + '" href="#/card/' + c.id + '">' +
    '<span class="task-title">' + priLabel + (priLabel ? ' ' : '') + esc(c.title) + '</span>' +
    '<span class="task-meta">' +
      (c.client_name ? '<span style="color:var(--accent);font-weight:600">' + esc(c.client_name) + '</span>' : '') +
      (c.board_title ? '<span class="task-board">' + esc(c.board_title) + '</span>' : '') +
      (c.column_title ? '<span style="opacity:.6;font-size:11px">' + esc(c.column_title) + '</span>' : '') +
      (tab !== 'assignments' && c.assignee_name ? '<span style="color:var(--green)">' + esc(c.assignee_name) + '</span>' : '') +
      (c.due_on ? '<span class="task-due">' + formatDate(c.due_on) + '</span>' : '') +
    '</span></a>';
}
function renderReportRows(data, tab) {
  if (data.length === 0) return '<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма резултати</div>';
  if (tab === 'assignments') {
    const byPerson = {};
    data.forEach(c => { const k = c.assignee_name || 'Без отговорник'; if (!byPerson[k]) byPerson[k] = []; byPerson[k].push(c); });
    return Object.entries(byPerson).sort(([a],[b]) => a.localeCompare(b)).map(([name, cards]) =>
      '<div class="task-section-label" style="color:var(--accent)">' + esc(name) + ' (' + cards.length + ')</div>' +
      cards.map(c => renderReportRow(c, tab)).join('')
    ).join('');
  }
  return data.map(c => renderReportRow(c, tab)).join('');
}
async function renderReports(el) {
  setBreadcrumb(null); el.className = '';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const tab = params.get('tab') || 'overdue';

  try {
    let data;
    const days = parseInt(params.get('days')) || 7;
    if (tab === 'overdue') data = await (await fetch('/api/reports/overdue')).json();
    else if (tab === 'upcoming') data = await (await fetch('/api/reports/upcoming?days=' + days)).json();
    else if (tab === 'assignments') {
      const uid = params.get('user_id') || '';
      data = await (await fetch('/api/reports/assignments' + (uid ? '?user_id=' + uid : ''))).json();
    } else data = await (await fetch('/api/reports/unassigned')).json();

    const upcomingDaysHtml = tab === 'upcoming' ? `
      <div style="display:flex;gap:6px;justify-content:center;margin-bottom:12px">
        ${[7,14,30].map(d => `<a href="#/reports?tab=upcoming&days=${d}" class="btn btn-sm btn-ghost${days===d?' active':''}" style="${days===d?'background:var(--accent-dim);color:var(--accent)':''}">${d} дни</a>`).join('')}
      </div>` : '';

    el.innerHTML = `
      <div style="max-width:800px;margin:0 auto">
        <div class="page-header"><h1>\ud83d\udcca \u041e\u0442\u0447\u0435\u0442\u0438</h1><div class="page-subtitle">${data.length} \u0440\u0435\u0437\u0443\u043b\u0442\u0430\u0442\u0430</div></div>
        <div style="display:flex;gap:8px;justify-content:center;margin-bottom:16px">
          <a href="#/reports?tab=overdue" class="btn btn-sm ${tab==='overdue'?'btn-primary':''}">🔴 Просрочени</a>
          <a href="#/reports?tab=upcoming" class="btn btn-sm ${tab==='upcoming'?'btn-primary':''}">🟡 Предстоящи</a>
          <a href="#/reports?tab=assignments" class="btn btn-sm ${tab==='assignments'?'btn-primary':''}">👤 По хора</a>
          <a href="#/reports?tab=unassigned" class="btn btn-sm ${tab==='unassigned'?'btn-primary':''}">❓ Невъзложени</a>
        </div>
        ${upcomingDaysHtml}
        <div class="task-list">
          ${renderReportRows(data, tab)}
        </div>
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

// ==================== COLUMN PERMALINK VIEW ====================
async function renderColumnView(el, id) {
  setBreadcrumb(null); el.className = '';
  try {
    const [col, cards] = await Promise.all([
      (await fetch(`/api/boards/columns/${id}`)).json(),
      (await fetch(`/api/cards?column_id=${id}`)).json()
    ]);
    if (col.error) { el.innerHTML = `<div style="text-align:center;padding:60px;color:var(--red)">${esc(col.error)}</div>`; return; }

    setBreadcrumb([
      { label: col.board_title, href: `#/board/${col.board_id}` },
      { label: col.title }
    ]);

    const activeCards = Array.isArray(cards) ? cards.filter(c => !c.is_on_hold) : [];
    const holdCards = Array.isArray(cards) ? cards.filter(c => c.is_on_hold) : [];

    const renderRow = (c) => `
      <a class="task-row" href="#/card/${c.id}">
        <span class="task-title">${esc(c.title)}</span>
        <span class="task-meta">
          ${c.due_on ? `<span class="task-due">${formatDate(c.due_on)}</span>` : ''}
          ${c.publish_date ? `<span style="color:var(--accent)">📅 ${formatDate(c.publish_date)}</span>` : ''}
          ${c.client_name ? `<span class="task-board">${esc(c.client_name)}</span>` : ''}
          ${c.priority === 'high' ? `<span style="color:var(--red)">↑</span>` : ''}
        </span>
      </a>`;

    el.innerHTML = `
      <div style="max-width:820px;margin:0 auto">
        <div class="page-header">
          <h1>${esc(col.title)}</h1>
          <div class="page-subtitle">${esc(col.board_title)} · ${activeCards.length} задачи${holdCards.length > 0 ? ` · ${holdCards.length} на изчакване` : ''}</div>
        </div>
        <div class="task-list">
          ${activeCards.length === 0 && holdCards.length === 0
            ? '<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма задачи в тази колона</div>'
            : activeCards.map(renderRow).join('')}
          ${holdCards.length > 0 ? `
            <div style="margin-top:16px;padding:10px 14px;font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em">
              На изчакване (${holdCards.length})
            </div>
            ${holdCards.map(renderRow).join('')}` : ''}
        </div>
      </div>`;
  } catch(e) {
    el.innerHTML = `<div style="text-align:center;padding:60px;color:var(--red)">Грешка: ${esc(e.message)}</div>`;
  }
}

// ==================== КП АВТОМАТИЗАЦИЯ ====================
async function renderKpAuto(el) {
  setBreadcrumb([{ label: 'Инструменти' }, { label: 'КП-Автоматизация' }]);
  el.className = 'page-tool';
  el.innerHTML = '<div class="kp-auto-wrap"><div style="text-align:center;padding:40px;color:var(--text-dim)">Зареждане...</div></div>';
  await loadKpAuto(el);
}

async function loadKpAuto(el) {
  try {
    const res = await fetch('/api/kp/clients');
    const clients = await res.json();
    if (!res.ok || !Array.isArray(clients)) {
      el.innerHTML = '<div class="kp-auto-wrap"><div style="text-align:center;padding:40px;color:var(--red)">Грешка: ' + esc((clients && clients.error) || 'Неуспешно зареждане') + '</div></div>';
      return;
    }

    // Auto-create KP cards for clients that have no card in Измисляне but have a date configured
    var toAutoCreate = clients.filter(function(c) {
      return !c.has_kp_card && (c.next_kp_date || c.first_publish_date);
    });
    if (toAutoCreate.length > 0) {
      el.querySelector('.kp-auto-wrap') && (el.querySelector('.kp-auto-wrap').innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim)">🤖 Автоматично създаване на КП карти…</div>');
      var autoResults = await Promise.all(toAutoCreate.map(function(c) {
        return fetch('/api/kp/create-card/' + c.id, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
          .then(function(r) { return r.json(); })
          .then(function(data) { return { clientName: c.name, ok: data.ok, title: data.title, error: data.error }; })
          .catch(function(e) { return { clientName: c.name, ok: false, error: e.message }; });
      }));
      autoResults.forEach(function(r) {
        if (r.ok) showToast('\u2705 \u0421\u044a\u0437\u0434\u0430\u0434\u0435\u043d: ' + r.title, 'success');
        else showToast('\u26a0 ' + r.clientName + ': ' + (r.error || '\u0413\u0440\u0435\u0448\u043a\u0430'), 'error');
      });
      if (autoResults.some(function(r) { return r.ok; })) {
        await loadKpAuto(el);
        return;
      }
    }

    const needsKp = clients.filter(function(c) { return !c.has_kp_card && !c.next_kp_date && !c.first_publish_date; });
    var warningHtml = '';
    if (needsKp.length > 0) {
      warningHtml = '<div class="kp-warning">' +
        '<span>\u26a0\ufe0f</span>' +
        '<span>' + (needsKp.length === 1 ? esc(needsKp[0].name) + ' \u043d\u044f\u043c\u0430 \u0437\u0430\u0434\u0430\u0434\u0435\u043d\u0430 \u0434\u0430\u0442\u0430 \u2014 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u0442\u0435 \u0434\u0430\u0442\u0430 \u0437\u0430 \u043f\u0443\u0431\u043b\u0438\u043a\u0443\u0432\u0430\u043d\u0435 \u0437\u0430 \u0434\u0430 \u0441\u0435 \u0441\u044a\u0437\u0434\u0430\u0434\u0435 \u041a\u041f' : needsKp.length + ' \u043a\u043b\u0438\u0435\u043d\u0442\u0430 \u043d\u044f\u043c\u0430\u0442 \u0437\u0430\u0434\u0430\u0434\u0435\u043d\u0430 \u0434\u0430\u0442\u0430') + '</span>' +
      '</div>';
    }

    var rowsHtml = '';
    clients.forEach(function(c) {
      var autoCreateDate = '—';
      if (c.next_kp_date) {
        var nkd = new Date(c.next_kp_date + 'T12:00:00');
        nkd.setDate(nkd.getDate() - 21);
        var today = new Date(); today.setHours(0,0,0,0);
        var autoStr = nkd.toLocaleDateString('bg-BG', { day:'2-digit', month:'2-digit', year:'numeric' });
        autoCreateDate = nkd <= today
          ? '<span style="color:var(--red)">' + autoStr + ' ⚠</span>'
          : autoStr;
      }
      var missingKp = !c.has_kp_card;
      var rowBg = missingKp ? 'background:rgba(220,120,0,0.08);' : '';
      var nameCell = missingKp
        ? '<td class="kp-td"><strong>' + esc(c.name) + '</strong> <span style="color:#e8a030" title="Няма карта в Измисляне">⚠️</span></td>'
        : '<td class="kp-td"><strong>' + esc(c.name) + '</strong></td>';
      var cardLinkBtn = (!missingKp && c.kp_card_id)
        ? '<a class="btn btn-sm btn-ghost" href="#/card/' + c.kp_card_id + '">👁 КП карта</a>'
        : '';
      var actionBtn = missingKp
        ? '<button class="btn btn-sm kp-launch-btn" onclick="createKpCardNow(' + c.id + ',\'' + esc(c.name) + '\')">🚀 Пусни КП</button>'
        : '<button class="btn btn-sm" onclick="createKpCardNow(' + c.id + ',\'' + esc(c.name) + '\')">📋 Нов КП</button>';
      rowsHtml += '<tr style="' + rowBg + '">' +
        nameCell +
        '<td class="kp-td">' + (c.videos_per_month || 10) + '</td>' +
        '<td class="kp-td">' + (c.publish_interval_days || 3) + 'д</td>' +
        '<td class="kp-td">КП-' + (c.current_kp_number || 1) + '</td>' +
        '<td class="kp-td">' + (c.first_publish_date ? formatDate(c.first_publish_date) : '—') + '</td>' +
        '<td class="kp-td">' + (c.last_video_date ? formatDate(c.last_video_date) : '—') + '</td>' +
        '<td class="kp-td">' + (c.next_kp_date ? formatDate(c.next_kp_date) : '—') + '</td>' +
        '<td class="kp-td">' + autoCreateDate + '</td>' +
        '<td class="kp-td" style="display:flex;gap:4px">' +
          '<button class="btn btn-sm" onclick="editKpClientForm(' + c.id + ')">✏️</button>' +
          '<button class="btn btn-sm btn-danger" onclick="deleteKpClientNow(' + c.id + ',\'' + esc(c.name) + '\')">🗑️</button>' +
          cardLinkBtn +
          actionBtn +
        '</td>' +
      '</tr>';
    });

    var tableHtml = clients.length === 0
      ? '<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма клиенти. Добавете първия.</div>'
      : '<div class="kp-table-wrap"><table class="kp-table">' +
          '<thead><tr>' +
            '<th class="kp-th">Клиент</th><th class="kp-th">Видеа</th><th class="kp-th">Интервал</th>' +
            '<th class="kp-th">Текущ КП</th><th class="kp-th">Първо видео</th><th class="kp-th">Последно видео</th>' +
            '<th class="kp-th">Следващ КП</th><th class="kp-th">Създаване на</th><th class="kp-th">Действия</th>' +
          '</tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table></div>';

    el.innerHTML = '<div class="kp-auto-wrap">' +
      '<div class="kp-auto-header">' +
        '<h2 class="kp-auto-title">📋 КП-Автоматизация</h2>' +
        '<button class="btn btn-primary" onclick="showKpClientForm()">+ Нов клиент</button>' +
      '</div>' +
      warningHtml +
      '<div id="kpClientFormWrap" style="display:none"></div>' +
      tableHtml +
    '</div>';
  } catch (err) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--red)">Грешка: ' + esc(err.message) + '</div>';
  }
}

function showKpClientForm(editData) {
  var wrap = document.getElementById('kpClientFormWrap');
  if (!wrap) return;
  var isEdit = !!editData;
  var firstDateVal = isEdit ? (editData.first_publish_date || '').split('T')[0] : '';
  var lastDateVal  = isEdit ? (editData.last_video_date  || '').split('T')[0] : '';
  var nextDateVal  = isEdit ? (editData.next_kp_date     || '').split('T')[0] : '';
  wrap.style.display = 'block';
  wrap.innerHTML = '<div class="kp-form-box">' +
    '<h4 style="margin:0 0 16px">' + (isEdit ? '\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0430\u043d\u0435' : '\u041d\u043e\u0432 \u043a\u043b\u0438\u0435\u043d\u0442') + '</h4>' +
    '<div class="kp-form-grid">' +
      '<div><label class="kp-label">\u041a\u043b\u0438\u0435\u043d\u0442</label><input class="input" type="text" id="kpName" value="' + (isEdit ? esc(editData.name) : '') + '" placeholder="\u0418\u043c\u0435 \u043d\u0430 \u043a\u043b\u0438\u0435\u043d\u0442"></div>' +
      '<div><label class="kp-label">\u0412\u0438\u0434\u0435\u0430 \u0432 \u041a\u041f</label><input class="input" type="number" id="kpVideos" value="' + (isEdit ? (editData.videos_per_month || 10) : 10) + '" min="1" max="50" onchange="kpRecalcDates()"></div>' +
      '<div><label class="kp-label">\u0418\u043d\u0442\u0435\u0440\u0432\u0430\u043b (\u0434\u043d\u0438)</label><input class="input" type="number" id="kpInterval" value="' + (isEdit ? (editData.publish_interval_days || 3) : 3) + '" min="1" max="30" onchange="kpRecalcDates()"></div>' +
      '<div><label class="kp-label">\u0422\u0435\u043a\u0443\u0449 \u041a\u041f \u2116</label><input class="input" type="number" id="kpKpNum" value="' + (isEdit ? (editData.current_kp_number || 1) : 1) + '" min="1"></div>' +
      '<div><label class="kp-label">\u0414\u0430\u0442\u0430 \u043f\u044a\u0440\u0432\u043e \u0432\u0438\u0434\u0435\u043e</label><button class="bc-date-btn ' + (firstDateVal ? '' : 'bc-date-btn--placeholder') + '" id="kpFirstDate" data-value="' + firstDateVal + '" onclick="event.stopPropagation();showDatePickerPopup(this,this.dataset.value,function(d){var b=document.getElementById(\'kpFirstDate\');if(b){b.dataset.value=d||\'\';b.textContent=d?formatDate(d):\'\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026\';b.className=d?\'bc-date-btn\':\'bc-date-btn bc-date-btn--placeholder\';}kpRecalcDates();})" style="width:100%;text-align:left">' + (firstDateVal ? formatDate(firstDateVal) : '\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026') + '</button></div>' +
      '<div><label class="kp-label">\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u043e \u0432\u0438\u0434\u0435\u043e <span style="opacity:.5">(\u0430\u0432\u0442\u043e)</span></label><span class="input" id="kpLastDate" data-value="' + lastDateVal + '" style="display:block;padding:8px 12px;min-height:38px;color:var(--text-dim)">' + (lastDateVal ? formatDate(lastDateVal) : '\u2014') + '</span></div>' +
      '<div><label class="kp-label">\u0421\u043b\u0435\u0434\u0432\u0430\u0449 \u041a\u041f \u043f\u044a\u0440\u0432\u043e \u0432\u0438\u0434\u0435\u043e <span style="opacity:.5">(\u0430\u0432\u0442\u043e)</span></label><span class="input" id="kpNextDate" data-value="' + nextDateVal + '" style="display:block;padding:8px 12px;min-height:38px;color:var(--text-dim)">' + (nextDateVal ? formatDate(nextDateVal) : '\u2014') + '</span></div>' +
    '</div>' +
    '<div style="margin-top:12px"><label class="kp-label">Бележки</label><textarea class="input" id="kpNotes" rows="2" style="width:100%;resize:vertical">' + (isEdit ? esc(editData.notes || '') : '') + '</textarea></div>' +
    '<div style="margin-top:16px;display:flex;gap:8px">' +
      '<button class="btn btn-primary" onclick="saveKpClient(' + (isEdit ? editData.id : 'null') + ')">' + (isEdit ? 'Запази' : 'Добави') + '</button>' +
      '<button class="btn" onclick="document.getElementById(\'kpClientFormWrap\').style.display=\'none\'">Отказ</button>' +
    '</div>' +
  '</div>';
}

function kpRecalcDates() {
  var firstEl = document.getElementById('kpFirstDate');
  var firstDate = firstEl && firstEl.dataset.value;
  var videos = parseInt((document.getElementById('kpVideos') || {}).value) || 10;
  var interval = parseInt((document.getElementById('kpInterval') || {}).value) || 3;
  if (!firstDate) return;
  var first = new Date(firstDate + 'T12:00:00');
  var last = new Date(first); last.setDate(last.getDate() + (videos - 1) * interval);
  var nextFirst = new Date(last); nextFirst.setDate(nextFirst.getDate() + interval);
  var lastEl = document.getElementById('kpLastDate');
  if (lastEl) { var lastStr = last.toISOString().split('T')[0]; lastEl.dataset.value = lastStr; lastEl.textContent = formatDate(lastStr); }
  var nextEl = document.getElementById('kpNextDate');
  if (nextEl) { var nextStr = nextFirst.toISOString().split('T')[0]; nextEl.dataset.value = nextStr; nextEl.textContent = formatDate(nextStr); }
}

async function editKpClientForm(id) {
  try {
    var clients = await (await fetch('/api/kp/clients')).json();
    var client = clients.find(function(c) { return c.id === id; });
    if (client) showKpClientForm(client);
  } catch (err) { showToast('Грешка: ' + err.message, 'error'); }
}

async function saveKpClient(id) {
  var name = document.getElementById('kpName').value.trim();
  if (!name) return showToast('Въведи име на клиент', 'warn');
  var data = {
    name: name,
    videos_per_month: parseInt(document.getElementById('kpVideos').value) || 10,
    publish_interval_days: parseInt(document.getElementById('kpInterval').value) || 3,
    current_kp_number: parseInt(document.getElementById('kpKpNum').value) || 1,
    first_publish_date: (document.getElementById('kpFirstDate') && document.getElementById('kpFirstDate').dataset.value) || null,
    last_video_date: (document.getElementById('kpLastDate') && document.getElementById('kpLastDate').dataset.value) || null,
    next_kp_date: (document.getElementById('kpNextDate') && document.getElementById('kpNextDate').dataset.value) || null,
    notes: document.getElementById('kpNotes').value || null
  };
  try {
    var url = id ? '/api/kp/clients/' + id : '/api/kp/clients';
    var method = id ? 'PUT' : 'POST';
    var res = await fetch(url, { method: method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
    var json = await res.json();
    if (!res.ok) return showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + (json.error || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430'), 'error');
    document.getElementById('kpClientFormWrap').style.display = 'none';
    var el = document.getElementById('pageContent');
    if (el) await loadKpAuto(el);
    // Auto-create KP card for new client with date set
    if (!id && data.first_publish_date && json.id) {
      var cardRes = await fetch('/api/kp/create-card/' + json.id, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ firstPublishDate: data.first_publish_date })
      });
      var cardData = await cardRes.json();
      if (cardData.ok) showToast('\u2705 \u041a\u043b\u0438\u0435\u043d\u0442\u044a\u0442 \u0435 \u0434\u043e\u0431\u0430\u0432\u0435\u043d \u0438 \u041a\u041f \u043a\u0430\u0440\u0442\u0430\u0442\u0430 \u0435 \u0441\u044a\u0437\u0434\u0430\u0434\u0435\u043d\u0430: ' + cardData.title, 'success');
      else showToast('\u26a0\ufe0f \u041a\u043b\u0438\u0435\u043d\u0442\u044a\u0442 \u0435 \u0434\u043e\u0431\u0430\u0432\u0435\u043d, \u043d\u043e \u041a\u041f \u043a\u0430\u0440\u0442\u0430\u0442\u0430 \u043d\u0435 \u0441\u0435 \u0441\u044a\u0437\u0434\u0430\u0434\u0435: ' + (cardData.error || '\u0413\u0440\u0435\u0448\u043a\u0430'), 'warn');
      if (el) await loadKpAuto(el);
    }
  } catch (err) { showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + err.message, 'error'); }
}

function createKpCardNow(clientId, clientName) {
  showConfirmModal('\u0421\u044a\u0437\u0434\u0430\u0439 \u043d\u043e\u0432 \u043a\u043e\u043d\u0442\u0435\u043d\u0442 \u043f\u043b\u0430\u043d \u0437\u0430 ' + clientName + ' \u0432 \u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430\u0442\u0430?', async function() {
    try {
      var res = await fetch('/api/kp/create-card/' + clientId, { method: 'POST', headers: {'Content-Type':'application/json'} });
      var data = await res.json();
      if (data.ok) {
        showToast('\u2705 \u0421\u044a\u0437\u0434\u0430\u0434\u0435\u043d\u043e: ' + data.title, 'success');
        var el = document.getElementById('pageContent');
        if (el) await loadKpAuto(el);
      } else {
        showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + (data.error || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430'), 'error');
      }
    } catch (err) { showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + err.message, 'error'); }
  });
}

function deleteKpClientNow(clientId, clientName) {
  showConfirmModal('\u0418\u0437\u0442\u0440\u0438\u0439 \u043a\u043b\u0438\u0435\u043d\u0442 "' + clientName + '"?\u0422\u043e\u0432\u0430 \u0449\u0435 \u0441\u043a\u0440\u0438\u0435 \u0437\u0430\u043f\u0438\u0441\u0430 \u043e\u0442 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0437\u0430\u0446\u0438\u044f\u0442\u0430.', async function() {
    try {
      var res = await fetch('/api/kp/clients/' + clientId, { method: 'DELETE' });
      var data = await res.json();
      if (data.ok) { var el = document.getElementById('pageContent'); if (el) await loadKpAuto(el); }
      else showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + (data.error || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430'), 'error');
    } catch (err) { showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + err.message, 'error'); }
  }, true);
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
            bookmarks.map(b => {
              const href = b.target_type === 'card' ? '#/card/' + b.target_id : '#';
              const typeLabel = b.target_type === 'card' ? '📋 Карта' : b.target_type === 'message' ? '📢 Съобщение' : esc(b.target_type);
              const board = b.board_title ? esc(b.board_title) : '';
              return '<a class="task-row ' + (b.color_class || '') + '" href="' + href + '" style="text-decoration:none">' +
                '<span class="task-title">' + esc(b.title || 'Без заглавие') + '</span>' +
                '<span class="task-meta">' +
                  '<span class="task-board" style="opacity:.6">' + typeLabel + '</span>' +
                  (board ? '<span class="task-board">' + board + '</span>' : '') +
                  (b.saved_at ? '<span style="font-size:10px;color:var(--text-dim)">' + timeAgo(b.saved_at) + '</span>' : '') +
                  '<button class="btn btn-sm" onclick="event.preventDefault();removeBookmark(' + b.id + ')" style="color:var(--text-dim);margin-left:4px">✕</button>' +
                '</span>' +
              '</a>';
            }).join('')}
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
let _addColumnBoardId = null;
function showAddColumnModal(bid) { _addColumnBoardId=bid; const m=document.getElementById('addColumnModal'); document.getElementById('addColumnInput').value=''; m.style.display='flex'; setTimeout(()=>document.getElementById('addColumnInput').focus(),50); }
function closeAddColumnModal() { document.getElementById('addColumnModal').style.display='none'; }
async function submitAddColumn() { const t=document.getElementById('addColumnInput').value.trim(); if(!t)return; closeAddColumnModal(); try{await fetch(`/api/boards/${_addColumnBoardId}/columns`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t})}); allBoards=await(await fetch('/api/boards')).json(); router();}catch{} }
async function promptAddColumn(bid) { showAddColumnModal(bid); }
function editColumnTitle(bid,cid,el) { const cur=el.textContent; el.contentEditable=true; el.focus(); const save=async()=>{ el.contentEditable=false; const t=el.textContent.trim(); if(t&&t!==cur){ try{await fetch(`/api/boards/${bid}/columns/${cid}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t})})}catch{} } else el.textContent=cur; }; el.onblur=save; el.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();el.blur()}if(e.key==='Escape'){el.textContent=cur;el.blur()}}; }
function showColMenu(e,bid,cid) {
  e.stopPropagation();
  document.querySelectorAll('.col-context-menu').forEach(m=>m.remove());
  const menu=document.createElement('div');
  menu.className='col-context-menu';
  const board = allBoards.find(b=>b.id===bid);
  const col = board && board.columns ? board.columns.find(c=>c.id===cid) : null;
  const wipCurrent = col && col.wip_limit ? col.wip_limit : '';
  menu.innerHTML = '<button onclick="promptRenameColumn(' + bid + ',' + cid + ');this.parentElement.remove()">\u270e Преименувай</button>' +
    '<button onclick="promptSetWipLimit(' + bid + ',' + cid + ');this.parentElement.remove()">\ud83d\udea6 WIP лимит' + (wipCurrent ? ' (' + wipCurrent + ')' : '') + '</button>' +
    '<button style="color:var(--red)" onclick="deleteColumn(' + bid + ',' + cid + ');this.parentElement.remove()">\ud83d\uddd1 Изтрий</button>';
  e.target.closest('.column-header-right').appendChild(menu);
  setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),10);
}
function promptSetWipLimit(bid,cid) {
  const board = allBoards.find(b=>b.id===bid);
  const col = board && board.columns ? board.columns.find(c=>c.id===cid) : null;
  const current = col && col.wip_limit ? String(col.wip_limit) : '';
  showPromptModal('WIP \u043b\u0438\u043c\u0438\u0442 (0 = \u0431\u0435\u0437 \u043b\u0438\u043c\u0438\u0442)', '\u041d\u0430\u043f\u0440. 3', current, async function(val) {
    const limit = parseInt(val) || 0;
    try { await fetch('/api/boards/' + bid + '/columns/' + cid, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({wip_limit: limit || null})}); allBoards=await(await fetch('/api/boards')).json(); router(); } catch {}
  }, 'number');
}
function promptRenameColumn(bid,cid) { showPromptModal('\u041f\u0440\u0435\u0438\u043c\u0435\u043d\u0443\u0432\u0430\u0439 \u043a\u043e\u043b\u043e\u043d\u0430', '\u041d\u043e\u0432\u043e \u0438\u043c\u0435\u2026', '', async function(t) { try{await fetch(`/api/boards/${bid}/columns/${cid}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t})}); allBoards=await(await fetch('/api/boards')).json(); router();}catch{} }); }
function deleteColumn(bid,cid) { showConfirmModal('\u0418\u0437\u0442\u0440\u0438\u0439 \u043a\u043e\u043b\u043e\u043d\u0430 \u0438 \u0432\u0441\u0438\u0447\u043a\u0438 \u043a\u0430\u0440\u0442\u0438 \u0432 \u043d\u0435\u044f?', async function() { try{const r=await fetch(`/api/boards/${bid}/columns/${cid}`,{method:'DELETE'}); if(!r.ok){const d=await r.json();showToast(d.error||'\u0413\u0440\u0435\u0448\u043a\u0430','error');return;} allBoards=await(await fetch('/api/boards')).json(); router();}catch{showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0438\u0437\u0442\u0440\u0438\u0432\u0430\u043d\u0435','error');} }, true); }
function toggleBoardMenu(e, bid) {
  e.stopPropagation();
  document.querySelectorAll('.board-context-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'col-context-menu board-context-menu';
  menu.style.cssText = 'right:0;left:auto;min-width:180px';
  const manage = canManage();
  const isAdmin = currentUser && currentUser.role === 'admin';
  let html = '<button onclick="promptRenameBoard(' + bid + ');this.parentElement.remove()">✏️ Преименувай борд</button>';
  if (manage) html += '<button onclick="showAddColumnModal(' + bid + ');this.parentElement.remove()">+ Добави колона</button>';
  if (isAdmin) html += '<button style="color:var(--red)" onclick="deleteBoardConfirm(' + bid + ');this.parentElement.remove()">\ud83d\uddd1 Изтрий борд</button>';
  menu.innerHTML = html;
  e.target.closest('.board-page-header__actions').appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}
function promptRenameBoard(bid) {
  const board = allBoards.find(b => b.id === bid);
  showPromptModal('\u041f\u0440\u0435\u0438\u043c\u0435\u043d\u0443\u0432\u0430\u0439 \u0431\u043e\u0440\u0434', '\u041d\u043e\u0432\u043e \u0438\u043c\u0435\u2026', board ? board.title : '', async function(t) {
    try { await fetch('/api/boards/' + bid, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t})}); allBoards = await (await fetch('/api/boards')).json(); router(); } catch {}
  });
}
function deleteBoardConfirm(bid) {
  const board = allBoards.find(b => b.id === bid);
  showConfirmModal('\u0418\u0437\u0442\u0440\u0438\u0439 \u0431\u043e\u0440\u0434 "' + (board ? board.title : '') + '"?\n\u0412\u0441\u0438\u0447\u043a\u0438 \u043a\u0430\u0440\u0442\u0438 \u0438 \u043a\u043e\u043b\u043e\u043d\u0438 \u0449\u0435 \u0431\u044a\u0434\u0430\u0442 \u0438\u0437\u0442\u0440\u0438\u0442\u0438!', async function() {
    try {
      const r = await fetch('/api/boards/' + bid, { method: 'DELETE' });
      if (!r.ok) { const d = await r.json(); showToast(d.error || '\u0413\u0440\u0435\u0448\u043a\u0430', 'error'); return; }
      allBoards = await (await fetch('/api/boards')).json();
      location.hash = '#/home';
      router();
    } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0438\u0437\u0442\u0440\u0438\u0432\u0430\u043d\u0435', 'error'); }
  }, true);
}

// ==================== DRAG & DROP ====================
let dragCardId = null;
function _clearAllDragOver() {
  document.querySelectorAll('.drag-over, .col-drag-over, .dash-drop-over').forEach(function(el) {
    el.classList.remove('drag-over', 'col-drag-over', 'dash-drop-over');
  });
  document.querySelectorAll('.dragging').forEach(function(el) {
    el.classList.remove('dragging');
  });
  // NOTE: does NOT clear dragCardId — callers manage that themselves
}
function handleDragStart(e) { dragCardId=e.currentTarget.dataset.cardId; e.currentTarget.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; }
function handleDragEnd(e) { e.currentTarget.classList.remove('dragging'); dragCardId=null; _clearAllDragOver(); }
function handleDragOver(e) { if(!dragCardId)return; e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function handleDragLeave(e) { if(!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over'); }
async function handleDrop(e) {
  e.preventDefault(); e.stopPropagation();
  _clearAllDragOver();
  if(!dragCardId) return;
  const colId = parseInt(e.currentTarget.dataset.columnId);
  const boardId = parseInt(e.currentTarget.dataset.boardId);
  const isHold = e.currentTarget.dataset.isHold === 'true';
  const cardId = dragCardId;
  dragCardId = null;
  _suppressWsRerender = Date.now() + 3000;
  try {
    await fetch('/api/cards/'+cardId+'/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({column_id:colId,board_id:boardId})});
    await fetch('/api/cards/'+cardId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_on_hold:isHold})});
    router();
  } catch { router(); }
}

// ==================== DASHBOARD DRAG & DROP ====================
function handleDashDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  dragCardId = null;
  _clearAllDragOver();
}
function handleDashDragOver(e) {
  if (!dragCardId) return;
  // Block drop on the on-hold section — only card page button can set on-hold
  if (e.target.closest && e.target.closest('.dash-on-hold-sep, .dash-card--hold, .dash-card--on-hold')) return;
  e.preventDefault();
  e.currentTarget.classList.add('dash-drop-over');
}
function handleDashDragLeave(e) {
  // Only remove if leaving to outside the drop zone (not into a child element)
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('dash-drop-over');
  }
}
async function handleDashDrop(e) {
  e.preventDefault(); e.stopPropagation();
  _clearAllDragOver(); // clean all highlighted zones, not just this one
  if (!dragCardId) return;
  // Block drop on the on-hold section
  if (e.target.closest && e.target.closest('.dash-on-hold-sep, .dash-card--hold, .dash-card--on-hold')) return;
  const colId   = parseInt(e.currentTarget.dataset.columnId);
  const boardId = parseInt(e.currentTarget.dataset.boardId);
  const cardId  = dragCardId;
  dragCardId = null;

  // Suppress WS re-render so the incoming card:moved broadcast doesn't re-render the dashboard
  _suppressWsRerender = Date.now() + 3000;

  // --- Optimistic DOM move (instant, no flicker) ---
  const cardEl   = document.querySelector('.dash-card[data-card-id="' + cardId + '"]');
  const targetZone = e.currentTarget;
  const sourceZone = cardEl ? cardEl.closest('.dash-subcol-cards') : null;
  if (cardEl) {
    // Insert BEFORE the on-hold separator so card lands in the regular area
    const holdSep = targetZone.querySelector('.dash-on-hold-sep');
    if (holdSep) targetZone.insertBefore(cardEl, holdSep);
    else targetZone.appendChild(cardEl);
  }

  // Update column counts in headers
  function updateSubcolCount(zone) {
    if (!zone) return;
    const header = zone.closest('.dash-subcol')?.querySelector('.dash-subcol-count');
    if (header) header.textContent = zone.querySelectorAll('.dash-card').length;
  }
  updateSubcolCount(sourceZone);
  updateSubcolCount(targetZone);

  try {
    await fetch('/api/cards/' + cardId + '/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column_id: colId, board_id: boardId })
    });
    // Silent data sync — no re-render, DOM is already correct
    const [boards, cards] = await Promise.all([
      fetch('/api/boards').then(r => r.json()),
      fetch('/api/cards').then(r => r.json())
    ]);
    _dashBoards = boards; _dashCards = cards;
    try {
      const timerRows = await (await fetch('/api/timers/boards')).json();
      _dashTimers = {};
      timerRows.forEach(function(t) { _dashTimers[t.board_id] = t; });
    } catch {}
  } catch(err) {
    console.error('Dashboard drop error:', err);
    // On API error — full re-render to restore correct state
    try {
      const [boards, cards] = await Promise.all([
        fetch('/api/boards').then(r => r.json()),
        fetch('/api/cards').then(r => r.json())
      ]);
      _dashBoards = boards; _dashCards = cards;
      renderDashboardBoard(boards, cards, _dashStageColors);
    } catch {}
  }
}

// ==================== ON HOLD ====================
function toggleHoldSection(colId) {
  const cards = document.getElementById('hold-cards-' + colId);
  const btn = document.querySelector('#hold-' + colId + ' .on-hold-toggle__icon');
  if (!cards) return;
  const open = cards.style.display !== 'none';
  cards.style.display = open ? 'none' : '';
  if (btn) btn.textContent = open ? '▸' : '▾';
}
function showKanbanCardMenu(e, cardId, isOnHold) {
  document.querySelectorAll('.kanban-card-context').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'kanban-card-context';
  const holdBtn = isOnHold
    ? `<button onclick="toggleCardHold(${cardId},false);this.parentElement.remove()">\u25b6 \u0412\u044a\u0440\u043d\u0438 \u0432 \u043a\u043e\u043b\u043e\u043d\u0430\u0442\u0430</button>`
    : `<button onclick="toggleCardHold(${cardId},true);this.parentElement.remove()">\u23f8 \u0421\u043b\u043e\u0436\u0438 \u043d\u0430 \u0438\u0437\u0447\u0430\u043a\u0432\u0430\u043d\u0435</button>`;
  menu.innerHTML =
    `<a class="kanban-card-context__link" href="#/card/${cardId}">\u270f\ufe0f \u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0430\u0439</a>` +
    `<div class="kanban-card-context__sep"></div>` +
    `<button onclick="setCardPriorityQuick(${cardId},'urgent');this.parentElement.remove()">\ud83d\udd34 \u0421\u043f\u0435\u0448\u043d\u043e</button>` +
    `<button onclick="setCardPriorityQuick(${cardId},'high');this.parentElement.remove()">\u2191 \u0412\u0438\u0441\u043e\u043a \u043f\u0440\u0438\u043e\u0440\u0438\u0442\u0435\u0442</button>` +
    `<button onclick="setCardPriorityQuick(${cardId},'normal');this.parentElement.remove()">\u2014 \u041d\u043e\u0440\u043c\u0430\u043b\u0435\u043d</button>` +
    `<div class="kanban-card-context__sep"></div>` +
    holdBtn;
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999`;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), {once:true}), 10);
}
async function setCardPriorityQuick(cardId, priority) {
  await updateField(cardId, 'priority', priority);
  router();
}
async function toggleCardHold(cardId, hold) {
  try {
    await fetch(`/api/cards/${cardId}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_on_hold:hold})});
    router();
  } catch {}
}

// ==================== COLUMN DRAG ====================
let dragColId = null, dragColEl = null;
function handleColDragStart(e) {
  if(dragCardId) return;
  dragColId = parseInt(e.currentTarget.dataset.colId);
  dragColEl = e.currentTarget;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('col-drag', dragColId);
  setTimeout(() => e.currentTarget.classList.add('col-dragging'), 0);
}
function handleColDragEnd(e) {
  e.currentTarget.classList.remove('col-dragging');
  document.querySelectorAll('.kanban-column').forEach(el => el.classList.remove('col-drag-over'));
  dragColId = null; dragColEl = null;
}
function handleColDragOver(e) {
  if(!dragColId || !dragColEl) return;
  e.preventDefault(); e.stopPropagation();
  const target = e.currentTarget;
  if(target === dragColEl) return;
  document.querySelectorAll('.kanban-column').forEach(el => el.classList.remove('col-drag-over'));
  target.classList.add('col-drag-over');
  const board = target.closest('.board-kanban');
  const cols = [...board.querySelectorAll('.kanban-column')];
  const fromIdx = cols.indexOf(dragColEl);
  const toIdx = cols.indexOf(target);
  if(fromIdx < toIdx) board.insertBefore(dragColEl, target.nextSibling);
  else board.insertBefore(dragColEl, target);
}
async function handleColDrop(e, boardId) {
  if(!dragColId) return;
  e.preventDefault(); e.stopPropagation();
  const board = e.currentTarget.closest('.board-kanban');
  const cols = [...board.querySelectorAll('.kanban-column')];
  try {
    await Promise.all(cols.map((el, i) => fetch(`/api/boards/${boardId}/columns/${parseInt(el.dataset.colId)}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({position: i})
    })));
  } catch(err) { console.error(err); }
}

// ==================== MENTION PICKER ====================
let _mentionState = null;
const _mentionCyrillic = /[@]([\w\u00C0-\u024F\u0400-\u04FF]*)$/;

function setupMentionPicker(trixEl, cardId) {
  trixEl.addEventListener('trix-change', function() {
    const editor = trixEl.editor;
    const pos = editor.getSelectedRange()[0];
    const text = editor.getDocument().toString();
    const textBefore = text.substring(0, pos);
    const atMatch = textBefore.match(_mentionCyrillic);
    if (atMatch) {
      const query = atMatch[1].toLowerCase();
      const atPos = pos - atMatch[0].length;
      _showMentionDropdown(trixEl, query, function(user) {
        editor.setSelectedRange([atPos, pos]);
        editor.insertString('@' + user.name + ' ');
        _hideMentionDropdown();
      });
    } else {
      _hideMentionDropdown();
    }
  });
  trixEl.addEventListener('keydown', function(e) {
    if (!_mentionState) return;
    if (e.key === 'Escape') { _hideMentionDropdown(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); _moveMention(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); _moveMention(-1); }
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); _selectCurrentMention(); }
  });
  trixEl.addEventListener('blur', function() { setTimeout(_hideMentionDropdown, 150); });
}
function _showMentionDropdown(anchorEl, query, onSelect) {
  _hideMentionDropdown();
  const avColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
  const users = allUsers.filter(u => !query || u.name.toLowerCase().includes(query)).slice(0, 8);
  if (!users.length) return;
  _mentionState = { users, selectedIdx: 0, onSelect };
  const dd = document.createElement('div');
  dd.id = 'mentionDropdown';
  dd.className = 'mention-dropdown';
  dd.innerHTML = users.map((u, i) =>
    `<div class="mention-item${i===0?' mention-item--active':''}" data-idx="${i}" onmousedown="event.preventDefault();_selectMentionByIdx(${i})">
      <div class="mention-av" style="background:${avColors[u.id%avColors.length]}">${initials(u.name)}</div>
      <span>${esc(u.name)}</span>
    </div>`
  ).join('');
  const rect = anchorEl.getBoundingClientRect();
  dd.style.cssText = `position:fixed;left:${rect.left}px;top:${Math.min(rect.bottom+4, window.innerHeight-260)}px;z-index:9999`;
  document.body.appendChild(dd);
  _mentionState.dd = dd;
}
function _hideMentionDropdown() {
  document.getElementById('mentionDropdown')?.remove();
  _mentionState = null;
}
function _moveMention(delta) {
  if (!_mentionState) return;
  const items = _mentionState.dd.querySelectorAll('.mention-item');
  items[_mentionState.selectedIdx].classList.remove('mention-item--active');
  _mentionState.selectedIdx = (_mentionState.selectedIdx + delta + items.length) % items.length;
  items[_mentionState.selectedIdx].classList.add('mention-item--active');
  items[_mentionState.selectedIdx].scrollIntoView({ block: 'nearest' });
}
function _selectCurrentMention() { if (_mentionState) _mentionState.onSelect(_mentionState.users[_mentionState.selectedIdx]); }
function _selectMentionByIdx(idx) { if (_mentionState) _mentionState.onSelect(_mentionState.users[idx]); }

// ==================== PROFILE ====================
async function openProfile() { const m=document.getElementById('profileModal'); m.style.display='flex'; try{ const u=await(await fetch('/api/profile')).json(); const av=document.getElementById('profileAvatar'); if(u.avatar_url)av.innerHTML=`<img src="${u.avatar_url}" style="width:100%;height:100%;object-fit:cover">`; else av.textContent=initials(u.name); document.getElementById('profileName').textContent=u.name; document.getElementById('profileEmail').textContent=u.email; document.getElementById('profileRole').innerHTML=u.role==='admin'?'<span class="badge badge-accent">АДМИН</span>':u.role==='moderator'?'<span class="badge badge-blue">МОДЕРАТОР</span>':'<span class="badge">ЧЛЕН</span>'; document.getElementById('profileNameInput').value=u.name; }catch{} }
function closeProfile() { document.getElementById('profileModal').style.display='none'; }
async function saveProfileName() { const n=document.getElementById('profileNameInput').value.trim(); if(!n)return; try{const u=await(await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n})})).json(); document.getElementById('profileName').textContent=u.name; document.getElementById('navAvatar').textContent=initials(u.name);}catch{} }
async function uploadAvatar(input) { if(!input.files[0])return; const f=new FormData(); f.append('avatar',input.files[0]); try{const u=await(await fetch('/api/profile/avatar',{method:'POST',body:f})).json(); document.getElementById('profileAvatar').innerHTML=`<img src="${u.avatar_url}" style="width:100%;height:100%;object-fit:cover">`;}catch{} }
async function changePassword() { const msg=document.getElementById('pwdMsg'),c=document.getElementById('currentPwd').value,n=document.getElementById('newPwd').value; if(!c||!n){msg.textContent='Попълни и двете полета';msg.style.color='var(--red)';return;} try{const r=await fetch('/api/profile/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:c,newPassword:n})}); const d=await r.json(); if(r.ok){msg.textContent='Сменена';msg.style.color='var(--green)';}else{msg.textContent=d.error;msg.style.color='var(--red)';}}catch{msg.textContent='Грешка';msg.style.color='var(--red)';} }
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeProfile();closeAddColumnModal();}});
document.getElementById('profileModal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeProfile()});

// ==================== WEBSOCKET ====================
function connectWS() { const p=location.protocol==='https:'?'wss':'ws'; ws=new WebSocket(`${p}://${location.host}/ws`); ws.onopen=()=>{wsReconnectDelay=1000;document.getElementById('wsStatusDot').className='status-dot online';document.getElementById('wsStatus').textContent='live'}; ws.onmessage=e=>{try{handleWSEvent(JSON.parse(e.data))}catch{}}; ws.onclose=()=>{document.getElementById('wsStatusDot').className='status-dot offline';document.getElementById('wsStatus').textContent='';setTimeout(connectWS,wsReconnectDelay);wsReconnectDelay=Math.min(wsReconnectDelay*2,30000)}; ws.onerror=()=>ws.close(); }
let _wsRouterTimeout = null;
let _suppressWsRerender = 0;
function wsRouter() {
  if (Date.now() < _suppressWsRerender) return;
  if (dragCardId) return; // never re-render while a drag is active
  clearTimeout(_wsRouterTimeout);
  _wsRouterTimeout = setTimeout(router, 150);
}
function handleWSEvent(ev) {
  const t = ev.type || '';
  // Card editing presence — handle without re-render
  if (t === 'card:editing') {
    cardEditingPresence.set(ev.cardId, { userId: ev.userId, userName: ev.userName });
    updateCardEditingBanner(ev.cardId);
    return;
  }
  if (t === 'card:editing:stop') {
    cardEditingPresence.delete(ev.cardId);
    updateCardEditingBanner(ev.cardId);
    return;
  }
  if (t === 'sos:alert') { showSosAlert(ev); return; }
  if (t === 'sos:resolved') { document.querySelectorAll('.sos-alert-banner[data-alert-id="' + ev.alertId + '"]').forEach(function(b) { b.remove(); }); return; }
  // Core data events — re-render current page
  if (t.startsWith('card:') || t.startsWith('board:') || t.startsWith('column:') || t.startsWith('step:') || t.startsWith('comment:')) wsRouter();
  if (t === 'chat:message' && location.hash.startsWith('#/chat/' + ev.channelId)) { if (ev.message) appendChatMsg(ev.message); return; }
  if (t === 'campfire:message' && location.hash.startsWith('#/campfire/')) { if (ev.message) appendCampfireMsg(ev.message); return; }
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

// ==================== TOAST NOTIFICATIONS ====================
function showToast(msg, type) {
  var t = type || 'info';
  var toast = document.createElement('div');
  toast.className = 'app-toast app-toast--' + t;
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(function() { toast.classList.add('app-toast--visible'); });
  setTimeout(function() {
    toast.classList.remove('app-toast--visible');
    setTimeout(function() { toast.remove(); }, 300);
  }, 3500);
}

// ==================== CONFIRM/PROMPT MODALS ====================
function showConfirmModal(msg, onConfirm, danger, okLabel) {
  var ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box">' +
    '<p class="confirm-modal-msg">' + esc(msg) + '</p>' +
    '<div class="confirm-modal-actions">' +
    '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" id="cmOkBtn">' + esc(okLabel || (danger ? '\u0418\u0437\u0442\u0440\u0438\u0439' : '\u041f\u043e\u0442\u0432\u044a\u0440\u0434\u0438')) + '</button>' +
    '<button class="btn btn-ghost" id="cmCancelBtn">\u041e\u0442\u043a\u0430\u0437</button>' +
    '</div></div>';
  document.body.appendChild(ov);
  function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  ov.querySelector('#cmOkBtn').onclick = function() { close(); onConfirm(); };
  ov.querySelector('#cmCancelBtn').onclick = close;
  ov.onclick = function(e) { if (e.target === ov) close(); };
  document.addEventListener('keydown', onKey);
}
function showPromptModal(title, placeholder, defaultVal, onConfirm, inputType) {
  var ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box">' +
    '<p class="confirm-modal-msg">' + esc(title) + '</p>' +
    '<input class="confirm-modal-input" type="' + (inputType || 'text') + '" id="pmInput" value="' + esc(defaultVal || '') + '" placeholder="' + esc(placeholder || '') + '">' +
    '<div class="confirm-modal-actions">' +
    '<button class="btn btn-primary" id="pmOkBtn">OK</button>' +
    '<button class="btn btn-ghost" id="pmCancelBtn">\u041e\u0442\u043a\u0430\u0437</button>' +
    '</div></div>';
  document.body.appendChild(ov);
  var inp = ov.querySelector('#pmInput');
  setTimeout(function() { inp.focus(); inp.select(); }, 50);
  function submit() { var v = inp.value.trim(); if (!v) { inp.focus(); return; } ov.remove(); onConfirm(v); }
  inp.onkeydown = function(e) { if (e.key === 'Enter') submit(); if (e.key === 'Escape') ov.remove(); };
  ov.querySelector('#pmOkBtn').onclick = submit;
  ov.querySelector('#pmCancelBtn').onclick = function() { ov.remove(); };
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
}

// ==================== CUSTOM DATE PICKER ====================
var _dpCurrentPicker = null;
function showDatePickerPopup(anchorEl, currentValue, onSelect) {
  if (_dpCurrentPicker) { _dpCurrentPicker.remove(); _dpCurrentPicker = null; }
  var today = new Date(); today.setHours(0,0,0,0);
  var selDate = currentValue ? new Date(currentValue.split('T')[0] + 'T12:00:00') : null;
  var viewYear = selDate ? selDate.getFullYear() : today.getFullYear();
  var viewMonth = selDate ? selDate.getMonth() : today.getMonth();
  var MN = ['\u042f\u043d\u0443\u0430\u0440\u0438','\u0424\u0435\u0432\u0440\u0443\u0430\u0440\u0438','\u041c\u0430\u0440\u0442','\u0410\u043f\u0440\u0438\u043b','\u041c\u0430\u0439','\u042e\u043d\u0438','\u042e\u043b\u0438','\u0410\u0432\u0433\u0443\u0441\u0442','\u0421\u0435\u043f\u0442\u0435\u043c\u0432\u0440\u0438','\u041e\u043a\u0442\u043e\u043c\u0432\u0440\u0438','\u041d\u043e\u0435\u043c\u0432\u0440\u0438','\u0414\u0435\u043a\u0435\u043c\u0432\u0440\u0438'];
  var popup = document.createElement('div');
  popup.className = 'date-picker-popup';
  _dpCurrentPicker = popup;
  function renderCal() {
    var first = new Date(viewYear, viewMonth, 1);
    var last = new Date(viewYear, viewMonth + 1, 0);
    var startDow = (first.getDay() + 6) % 7;
    var todayTs = today.getTime();
    var selTs = selDate ? new Date(selDate.getFullYear(), selDate.getMonth(), selDate.getDate()).getTime() : -1;
    var html = '';
    for (var i = 0; i < startDow; i++) html += '<div class="dp-day dp-day--empty"></div>';
    for (var d = 1; d <= last.getDate(); d++) {
      var ts = new Date(viewYear, viewMonth, d).getTime();
      var ds = viewYear + '-' + String(viewMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
      var cls = 'dp-day' + (ts===todayTs?' dp-day--today':'') + (ts===selTs?' dp-day--selected':'');
      html += '<div class="' + cls + '" data-date="' + ds + '">' + d + '</div>';
    }
    popup.innerHTML =
      '<div class="dp-header">' +
        '<button class="dp-nav" data-delta="-1">\u2039</button>' +
        '<span class="dp-month-year">' + MN[viewMonth] + ' ' + viewYear + '</span>' +
        '<button class="dp-nav" data-delta="1">\u203a</button>' +
      '</div>' +
      '<div class="dp-weekdays"><span>\u041f\u043d</span><span>\u0412\u0442</span><span>\u0421\u0440</span><span>\u0427\u0442</span><span>\u041f\u0442</span><span>\u0421\u0431</span><span>\u041d\u0434</span></div>' +
      '<div class="dp-days">' + html + '</div>' +
      '<div class="dp-footer"><button class="dp-clear">\u0418\u0437\u0447\u0438\u0441\u0442\u0438</button></div>';
    popup.querySelectorAll('.dp-nav').forEach(function(btn) {
      btn.onclick = function(e) {
        e.stopPropagation();
        viewMonth += parseInt(btn.dataset.delta);
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        renderCal();
      };
    });
    popup.querySelectorAll('.dp-day:not(.dp-day--empty)').forEach(function(dayEl) {
      dayEl.onclick = function(e) {
        e.stopPropagation();
        selDate = new Date(dayEl.dataset.date + 'T12:00:00');
        onSelect(dayEl.dataset.date);
        popup.remove(); _dpCurrentPicker = null;
      };
    });
    popup.querySelector('.dp-clear').onclick = function(e) {
      e.stopPropagation();
      onSelect(null);
      popup.remove(); _dpCurrentPicker = null;
    };
  }
  renderCal();
  document.body.appendChild(popup);
  var rect = anchorEl.getBoundingClientRect();
  var pw = 264;
  var left = Math.min(rect.left, window.innerWidth - pw - 8);
  var top = rect.bottom + 6;
  if (top + 330 > window.innerHeight) top = Math.max(8, rect.top - 334);
  popup.style.cssText = 'position:fixed;left:' + Math.max(8,left) + 'px;top:' + top + 'px;z-index:10001;width:' + pw + 'px';
  setTimeout(function() {
    function _dpClose(e) {
      if (_dpCurrentPicker && !_dpCurrentPicker.contains(e.target)) {
        _dpCurrentPicker.remove(); _dpCurrentPicker = null;
        document.removeEventListener('click', _dpClose);
      }
    }
    document.addEventListener('click', _dpClose);
  }, 10);
}
function openDueDatePicker(cardId, btn) {
  showDatePickerPopup(btn, btn.dataset.value || '', function(dateStr) {
    btn.dataset.value = dateStr || '';
    btn.textContent = dateStr ? formatDate(dateStr) : '\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026';
    btn.className = dateStr ? 'bc-date-btn' : 'bc-date-btn bc-date-btn--placeholder';
    if (dateStr) { saveDueDateField(cardId, dateStr); }
    else { btn.style.display = 'none'; var r = document.querySelector('[name="due_' + cardId + '"]'); if (r) r.checked = true; updateField(cardId, 'due_on', null); }
  });
}
function openPublishDatePicker(cardId, btn) {
  showDatePickerPopup(btn, btn.dataset.value || '', function(dateStr) {
    btn.dataset.value = dateStr || '';
    btn.textContent = dateStr ? formatDate(dateStr) : '\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026';
    btn.className = dateStr ? 'bc-date-btn' : 'bc-date-btn bc-date-btn--placeholder';
    savePublishDateField(cardId, dateStr || null);
    if (!dateStr) { btn.style.display = 'none'; var r = document.querySelectorAll('[name="pub_' + cardId + '"]')[0]; if (r) r.checked = true; }
  });
}
function openNewStepDatePicker(btn) {
  showDatePickerPopup(btn, btn.dataset.value || '', function(dateStr) {
    btn.dataset.value = dateStr || '';
    btn.textContent = dateStr ? formatDate(dateStr) : '\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026';
    btn.className = dateStr ? 'bc-date-btn' : 'bc-date-btn bc-date-btn--placeholder';
  });
}
function openEditStepDatePicker(stepId, btn) {
  showDatePickerPopup(btn, btn.dataset.value || '', function(dateStr) {
    btn.dataset.value = dateStr || '';
    btn.textContent = dateStr ? formatDate(dateStr) : '\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026';
    btn.className = dateStr ? 'bc-date-btn' : 'bc-date-btn bc-date-btn--placeholder';
  });
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
    document.getElementById('shortcutsModal')?.remove();
    document.querySelector('.modal-overlay')?.remove();
    document.querySelectorAll('.kanban-card-context,.board-context-menu,.bc-options-menu').forEach(function(m) { m.remove(); });
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

// ==================== CARD PAGE TOOLBAR ====================
function setupCardPageToolbar(card, col, editing) {
  var cardId = card.id;
  var cardTitle = card.title;
  var toolbar = document.getElementById('cardPageToolbar_' + cardId);
  if (!toolbar) return;

  // SOS button
  var sosBtn = document.createElement('button');
  sosBtn.className = 'btn btn-sm sos-card-btn';
  sosBtn.textContent = '🚨 Спешно';
  sosBtn.title = 'Спешен сигнал за тази карта';
  sosBtn.onclick = function() { openSosModal(cardId, cardTitle); };
  toolbar.appendChild(sosBtn);

  // Bookmark button
  var bookmarkBtn = document.createElement('button');
  bookmarkBtn.className = 'btn btn-sm btn-ghost';
  bookmarkBtn.textContent = '⚑ Запази';
  bookmarkBtn.onclick = function() { toggleBookmark('card', cardId, cardTitle); };
  toolbar.appendChild(bookmarkBtn);

  // Presentation button — only for cards in "Към клиент" column
  if (col && col.title && /\u043a\u044a\u043c \u043a\u043b\u0438\u0435\u043d\u0442/i.test(col.title)) {
    var presentBtn = document.createElement('button');
    presentBtn.className = 'btn btn-sm btn-ghost';
    presentBtn.textContent = '\ud83d\udc41 \u041f\u0440\u0435\u0437\u0435\u043d\u0442\u0430\u0446\u0438\u044f';
    presentBtn.title = '\u041e\u0442\u0432\u043e\u0440\u0438 \u043a\u0430\u0442\u043e \u043f\u0440\u0435\u0437\u0435\u043d\u0442\u0430\u0446\u0438\u044f \u0437\u0430 \u043a\u043b\u0438\u0435\u043d\u0442\u0430';
    presentBtn.onclick = function() { openPresentation(cardId); };
    toolbar.appendChild(presentBtn);
  }

  // Generate video tasks button — only for КП cards in "В продукция" column
  if (card.kp_number && col && col.title && /\u0432 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u044f/i.test(col.title)) {
    var generateBtn = document.createElement('button');
    generateBtn.className = 'btn btn-sm btn-ghost kp-generate-btn';
    generateBtn.textContent = '\u2699\ufe0f \u0413\u0435\u043d\u0435\u0440\u0438\u0440\u0430\u0439 \u0437\u0430\u0434\u0430\u0447\u0438';
    generateBtn.title = '\u0413\u0435\u043d\u0435\u0440\u0438\u0440\u0430\u0439 \u0432\u0438\u0434\u0435\u043e \u0437\u0430\u0434\u0430\u0447\u0438 \u043e\u0442 \u0441\u044a\u0434\u044a\u0440\u0436\u0430\u043d\u0438\u0435\u0442\u043e \u043d\u0430 \u043a\u0430\u0440\u0442\u0430\u0442\u0430';
    generateBtn.onclick = function() { generateVideoCards(cardId, cardTitle, generateBtn); };
    toolbar.appendChild(generateBtn);
  }
  // Right group: Edit + Options (moved here from bc-card-options)
  var rightGroup = document.createElement('div');
  rightGroup.style.cssText = 'display:flex;align-items:center;gap:4px;margin-left:auto';
  if (canEdit() && !editing) {
    var editBtn2 = document.createElement('button');
    editBtn2.className = 'btn btn-sm btn-ghost';
    editBtn2.textContent = '✏️ Редактирай';
    editBtn2.onclick = function() { enterCardEditMode(card.id); };
    rightGroup.appendChild(editBtn2);
  }
  var dotsBtn2 = document.createElement('button');
  dotsBtn2.className = 'btn btn-sm btn-ghost bc-card-options__dots';
  dotsBtn2.title = 'Опции';
  dotsBtn2.innerHTML = '⋯';
  dotsBtn2.onclick = function(e) { toggleCardOptionsMenu(e, card.id, esc(card.title).replace(/'/g, "\\'")); };
  rightGroup.appendChild(dotsBtn2);
  toolbar.appendChild(rightGroup);
}

function openPresentation(cardId) {
  window.open('/present/' + cardId, '_blank');
}

function generateVideoCards(cardId, cardTitle, btn) {
  showConfirmModal('\u0429\u0435 \u0431\u044a\u0434\u0430\u0442 \u0433\u0435\u043d\u0435\u0440\u0438\u0440\u0430\u043d\u0438 \u0432\u0438\u0434\u0435\u043e \u0437\u0430\u0434\u0430\u0447\u0438 \u0437\u0430 "' + cardTitle + '".\n\u041a\u0430\u0440\u0442\u0438\u0442\u0435 \u0449\u0435 \u0431\u044a\u0434\u0430\u0442 \u0441\u044a\u0437\u0434\u0430\u0434\u0435\u043d\u0438 \u0432 \u043a\u043e\u043b\u043e\u043d\u0430 "\u0420\u0430\u0437\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d\u0438\u0435". \u041f\u0440\u043e\u0434\u044a\u043b\u0436\u0430\u0432\u0430\u0448?', async function() {
    if (btn) { btn.disabled = true; btn.textContent = '\u23f3 \u0413\u0435\u043d\u0435\u0440\u0438\u0440\u0430\u043d\u0435...'; }
    try {
      var res = await fetch('/api/kp/generate-video-cards/' + cardId, { method: 'POST' });
      var data = await res.json();
      if (data.ok) {
        showToast('\u2705 \u0413\u0435\u043d\u0435\u0440\u0438\u0440\u0430\u043d\u0438 ' + data.count + ' \u0432\u0438\u0434\u0435\u043e \u0437\u0430\u0434\u0430\u0447\u0438 \u0443\u0441\u043f\u0435\u0448\u043d\u043e!', 'success');
      } else {
        showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + (data.error || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430 \u0433\u0440\u0435\u0448\u043a\u0430'), 'error');
      }
    } catch (err) {
      showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '\u2699\ufe0f \u0413\u0435\u043d\u0435\u0440\u0438\u0440\u0430\u0439 \u0437\u0430\u0434\u0430\u0447\u0438'; }
    }
  });
}

// ==================== SOS СИСТЕМА ====================
function openSosModal(cardId, cardTitle) {
  document.querySelectorAll('#sosModal').forEach(m => m.remove());
  fetch('/api/users').then(r => r.json()).then(function(users) {
    var userOpts = users.filter(function(u) { return u.id !== currentUser.id; }).map(function(u) {
      return '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer">' +
        '<input type="checkbox" value="' + u.id + '" style="accent-color:var(--red)"> ' + esc(u.name) + '</label>';
    }).join('');
    var modal = document.createElement('div');
    modal.id = 'sosModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = '<div class="modal-box sos-modal-box">' +
      '<div class="sos-modal-header">🚨 Спешен сигнал</div>' +
      '<div class="sos-modal-body">' +
        (cardId ? '<div class="sos-card-ref">Карта: <strong>' + esc(cardTitle || '') + '</strong></div>' : '') +
        '<div style="margin-bottom:12px">' +
          '<label class="kp-label">Съобщение <span style="opacity:.5">(по избор)</span></label>' +
          '<textarea id="sosMessage" class="input" rows="3" style="width:100%;resize:vertical" placeholder="Опиши какво е спешното..."></textarea>' +
        '</div>' +
        '<div style="margin-bottom:16px">' +
          '<label class="kp-label" style="margin-bottom:8px;display:block">Изпрати до:</label>' +
          '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer">' +
            '<input type="radio" name="sosTarget" value="all" checked style="accent-color:var(--red)"> <strong>Целия екип</strong>' +
          '</label>' +
          '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer">' +
            '<input type="radio" name="sosTarget" value="specific" style="accent-color:var(--red)"> Конкретни хора:' +
          '</label>' +
          '<div id="sosUserList" style="margin-left:24px;display:none">' + userOpts + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn sos-send-btn" onclick="sendSos(' + (cardId || 'null') + ')">🚨 Изпрати сигнал</button>' +
          '<button class="btn" onclick="document.getElementById(\'sosModal\').remove()">Отказ</button>' +
        '</div>' +
      '</div>' +
    '</div>';
    document.body.appendChild(modal);
    // Show/hide user list on radio change
    modal.querySelectorAll('input[name="sosTarget"]').forEach(function(r) {
      r.addEventListener('change', function() {
        document.getElementById('sosUserList').style.display = this.value === 'specific' ? 'block' : 'none';
      });
    });
    modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
  }).catch(function() { showToast('Грешка при зареждане', 'error'); });
}

async function sendSos(cardId) {
  var message = document.getElementById('sosMessage').value.trim();
  var targetRadio = document.querySelector('input[name="sosTarget"]:checked');
  var targetAll = !targetRadio || targetRadio.value === 'all';
  var targetUserIds = [];
  if (!targetAll) {
    document.querySelectorAll('#sosUserList input:checked').forEach(function(cb) {
      targetUserIds.push(parseInt(cb.value));
    });
    if (targetUserIds.length === 0) return showToast('Избери поне един човек', 'warn');
  }
  try {
    var res = await fetch('/api/sos', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ message, card_id: cardId || null, target_all: targetAll, target_user_ids: targetUserIds })
    });
    var data = await res.json();
    if (data.ok) {
      document.getElementById('sosModal').remove();
    } else {
      showToast('Грешка: ' + (data.error || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430'), 'error');
    }
  } catch (err) { showToast('Грешка: ' + err.message, 'error'); }
}

function showSosAlert(ev) {
  // Check if this alert is for current user
  if (!ev.targetAll && ev.targetUserIds && !ev.targetUserIds.includes(currentUser.id)) return;
  if (ev.senderId === currentUser.id) return; // Don't alert yourself

  // Play SOS sound
  playSosSound();

  // Browser notification
  if (Notification.permission === 'granted') {
    new Notification('🚨 Спешен сигнал от ' + ev.senderName, {
      body: ev.message || (ev.cardTitle ? 'Карта: ' + ev.cardTitle : 'Погледни платформата'),
      icon: '/img/logo-white.svg'
    });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission();
  }

  // Remove existing SOS banners
  document.querySelectorAll('.sos-alert-banner').forEach(function(b) { b.remove(); });

  var banner = document.createElement('div');
  banner.className = 'sos-alert-banner';
  banner.innerHTML =
    '<span class="sos-alert-icon">🚨</span>' +
    '<div class="sos-alert-content">' +
      '<strong>Спешен сигнал от ' + esc(ev.senderName) + '</strong>' +
      (ev.message ? '<span>' + esc(ev.message) + '</span>' : '') +
      (ev.cardTitle ? '<a href="#/card/' + ev.cardId + '" onclick="this.closest(\'.sos-alert-banner\').remove()">→ ' + esc(ev.cardTitle) + '</a>' : '') +
    '</div>' +
    '<button class="sos-alert-resolve" onclick="resolveSos(' + ev.alertId + ',this.closest(\'.sos-alert-banner\'))">✓ Видях</button>' +
    '<button class="sos-alert-close" onclick="this.closest(\'.sos-alert-banner\').remove()">✕</button>';
  document.body.insertBefore(banner, document.body.firstChild);

  // Auto-remove after 5 min
  setTimeout(function() { if (banner.parentNode) banner.remove(); }, 300000);
}

async function resolveSos(alertId, bannerEl) {
  try {
    await fetch('/api/sos/' + alertId + '/resolve', { method: 'PUT' });
    if (bannerEl) bannerEl.remove();
  } catch (err) {}
}

function playSosSound() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    function beep(freq, start, dur) {
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq;
      o.type = 'sine';
      g.gain.setValueAtTime(0.4, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + dur + 0.05);
    }
    beep(880, 0, 0.15);
    beep(880, 0.2, 0.15);
    beep(880, 0.4, 0.15);
    beep(660, 0.65, 0.4);
  } catch(e) {}
}

// ==================== DASHBOARD TIMER TICKER ====================
setInterval(function() {
  document.querySelectorAll('.dash-timer-bar--clean[data-since]').forEach(function(el) {
    var since = el.dataset.since;
    if (!since) return;
    var diff = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
    if (diff < 0) diff = 0;
    var days = Math.floor(diff / 86400);
    var hours = Math.floor((diff % 86400) / 3600);
    var mins = Math.floor((diff % 3600) / 60);
    var secs = diff % 60;
    var val = el.querySelector('.dash-timer-value');
    if (val) val.textContent = days + '\u0434, ' + hours + '\u0447, ' + mins + '\u043c, ' + secs + '\u0441';
  });
}, 1000);

// ==================== DRAG FAILSAFE CLEANUP ====================
// Runs whenever any drag ends on the document — covers cases where
// the card-level ondragend doesn't fire (element removed mid-drag, tab blur, etc.)
document.addEventListener('dragend', function() {
  if (dragCardId || document.querySelector('.dragging, .drag-over, .col-drag-over, .dash-drop-over')) {
    dragCardId = null;
    _clearAllDragOver();
  }
});
// Secondary failsafe: pointerup catches cancelled drags where dragend didn't fire
document.addEventListener('pointerup', function() {
  if (!dragCardId) return;
  setTimeout(function() {
    if (dragCardId) { dragCardId = null; _clearAllDragOver(); }
  }, 200);
});

// ==================== INIT ====================
(async function() {
  if (!await checkAuth()) return;
  if (!location.hash || location.hash === '#' || location.hash === '#/') location.hash = '#/home';
  router();
  connectWS();
  // Fetch online users
  try { const ids = await (await fetch('/api/users/online')).json(); ids.forEach(id => onlineUsers.add(id)); } catch {}
})();
