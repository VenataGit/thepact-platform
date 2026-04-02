// ThePact Platform — Basecamp Clone (v3)
let currentUser = null, ws = null, wsReconnectDelay = 1000;
let allUsers = [], allBoards = [];

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
    </div>
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

  switch (page) {
    case 'home': return renderHome(el);
    case 'project': return renderProject(el, id);
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
          <img src="/img/logo.png" alt="" onerror="this.style.display='none'" style="height:40px;margin-bottom:12px">
          <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px">ThePact Tasks</div>
          <h1 style="font-size:36px;letter-spacing:-0.03em">THEPACT™</h1>
        </div>

        <div style="text-align:center;margin-bottom:32px">
          <a href="#/project/1" style="color:var(--accent);font-size:13px;text-decoration:underline">Виж всички проекти в списък</a>
          <span style="color:var(--text-dim);font-size:13px"> · Натисни <kbd style="background:var(--bg-hover);padding:2px 6px;border-radius:4px;font-size:11px;border:1px solid var(--border)">Ctrl+J</kbd> за бързо търсене</span>
        </div>

        <div style="text-align:center;margin-bottom:16px">
          <span class="section-pill">Последни проекти</span>
        </div>

        <a href="#/project/1" class="project-card-home">
          <div class="project-card-home__pin" title="Закачен проект">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
          </div>
          <div class="project-card-home__above">ThePact Tasks</div>
          <div class="project-card-home__title">Video Production</div>
          <div class="project-card-home__avatars">${teamAvatars}</div>
        </a>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:32px">
          <div>
            <div style="text-align:center;margin-bottom:12px"><span class="section-pill section-pill--blue">Твоят график</span></div>
            <div class="home-panel">
              ${renderMiniCalendar()}
              <div style="margin-top:16px;font-size:13px;color:var(--text-dim);display:flex;align-items:center;gap:8px">
                <span>📅</span>
                <span>${new Date().toLocaleDateString('bg', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}</span>
                <span style="margin-left:4px">Нищо планирано за днес</span>
              </div>
            </div>
          </div>
          <div>
            <div style="text-align:center;margin-bottom:12px"><span class="section-pill section-pill--green">Твоите задачи</span></div>
            <div class="home-panel" style="min-height:200px;display:flex;align-items:center;justify-content:center">
              ${myCards.length === 0
                ? '<div style="text-align:center;color:var(--text-dim)"><svg viewBox="0 0 24 24" width="64" height="64" style="opacity:0.2;margin-bottom:8px"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" fill="none" stroke-width="1.5"/></svg><p style="font-size:13px">Нямаш задачи в момента.<br>Възложените ти карти ще се появят тук.</p></div>'
                : `<div style="width:100%">${myCards.slice(0,8).map(c => `<a href="#/card/${c.id}" class="assignment-row"><span class="assignment-title">${esc(c.title)}</span><span class="assignment-board">${esc(c.board_title || '')}</span></a>`).join('')}</div>`
              }
            </div>
          </div>
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

    const avatarColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
    el.innerHTML = `
      <div class="page-header">
        <div class="page-above">ThePact Tasks</div>
        <h1>Video Production</h1>
        <div class="avatar-group" style="display:flex;justify-content:center;margin-top:12px">
          ${allUsers.slice(0, 8).map((u, i) => `<div style="width:32px;height:32px;border-radius:50%;background:${avatarColors[i % avatarColors.length]};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;border:2px solid var(--bg);margin-left:${i > 0 ? '-4px' : '0'};position:relative;z-index:${10-i}">${initials(u.name)}</div>`).join('')}
        </div>
      </div>

      <div class="project-tools">
        ${boards.map((board, bi) => {
          const bc = cards.filter(c => c.board_id === board.id);
          const barColors = ['orange','blue','yellow','purple','teal','red'];
          const colorBar = barColors[bi % barColors.length];
          const activeCols = board.columns.filter(c => !c.is_done_column);
          const activeCards = bc.filter(c => !c.is_on_hold);
          return `
            <a class="tool-card" href="#/board/${board.id}">
              <div class="tool-card__color-bar tool-card__color-bar--${colorBar}"></div>
              <div class="tool-card__header">
                <h2 class="tool-card__title">${esc(board.title)}</h2>
                <p class="tool-card__desc">${activeCols.length} колони · ${activeCards.length} активни карти</p>
              </div>
              <div class="tool-card__body">
                <div class="board-preview-list">
                  ${activeCols.map((col, ci) => {
                    const cc = bc.filter(c => c.column_id === col.id);
                    return `<span class="board-preview-item">${esc(col.title)} <span class="board-preview-count">(${cc.length})</span></span>`;
                  }).join('<span class="board-preview-sep">&middot;</span>')}
                </div>
              </div>
            </a>`;
        }).join('')}

        <a class="tool-card" href="#/chat">
          <div class="tool-card__color-bar tool-card__color-bar--teal"></div>
          <div class="tool-card__header"><h2 class="tool-card__title">Pings</h2></div>
          <div class="tool-card__body">
            <div class="tool-card__empty-state">
              <div class="tool-card__empty-icon">💬</div>
              <div class="tool-card__empty-text">Изпрати лично съобщение до един или повече хора.</div>
              <div class="tool-card__empty-cta">Започни разговор &rarr;</div>
            </div>
          </div>
        </a>

        <a class="tool-card" href="#/messages">
          <div class="tool-card__color-bar tool-card__color-bar--blue"></div>
          <div class="tool-card__header"><h2 class="tool-card__title">Известия</h2></div>
          <div class="tool-card__body">
            <div class="tool-card__empty-state">
              <div class="tool-card__empty-icon">📢</div>
              <div class="tool-card__empty-text">Публикувай съобщения, споделяй идеи и поддържай дискусии по темата.</div>
              <div class="tool-card__empty-cta">Публикувай съобщение &rarr;</div>
            </div>
          </div>
        </a>

        <a class="tool-card" href="#/vault">
          <div class="tool-card__color-bar tool-card__color-bar--yellow"></div>
          <div class="tool-card__header"><h2 class="tool-card__title">Документи</h2></div>
          <div class="tool-card__body">
            <div class="tool-card__empty-state">
              <div class="tool-card__empty-icon">📁</div>
              <div class="tool-card__empty-text">Споделяй и организирай документи, таблици, снимки и други файлове.</div>
              <div class="tool-card__empty-cta">Качи файл &rarr;</div>
            </div>
          </div>
        </a>

        ${canManage() ? `
        <div class="tool-card" style="cursor:pointer;border-style:dashed" onclick="promptCreateBoard()">
          <div class="tool-card__body">
            <div class="tool-card__blank">
              <div class="tool-card__icon" style="opacity:0.3">+</div>
              <div class="tool-card__desc">Добави нов инструмент</div>
            </div>
          </div>
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

    el.innerHTML = `
      <div style="padding:0 16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid var(--border)">
          <div></div>
          <h1 style="font-size:22px;font-weight:800;color:#fff;text-align:center;flex:1;letter-spacing:-0.02em">${esc(board.title)}</h1>
          <div style="display:flex;gap:8px;align-items:center">
            <div class="board-watching">
              <span class="board-watching__label">Наблюдават</span>
              <div class="board-watching__avatars">
                ${allUsers.slice(0,6).map((u,i) => {
                  const wc = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308'];
                  return `<div class="board-watching__avatar" style="background:${wc[i%wc.length]}">${initials(u.name)}</div>`;
                }).join('')}
              </div>
            </div>
            ${manage ? `<button class="btn btn-sm" onclick="promptAddColumn(${boardId})">+ Колона</button>` : ''}
            <button class="btn btn-sm" onclick="toggleBoardMenu(event, ${boardId})">⋯</button>
          </div>
        </div>

        <div class="board-kanban">
          ${visibleCols.map((col, i) => {
            const colCards = cards.filter(c => c.column_id === col.id && !c.is_on_hold);
            const holdCards = cards.filter(c => c.column_id === col.id && c.is_on_hold);
            const isFirst = i === 0;
            return `
              <div class="kanban-column" data-col-id="${col.id}">
                <div class="column-header">
                  <h2 class="column-title-link">
                    <span ${manage ? `ondblclick="editColumnTitle(${boardId}, ${col.id}, this)"` : ''}>${esc(col.title)}</span>
                    <span class="col-count">(${colCards.length + holdCards.length})</span>
                  </h2>
                  <div class="column-header-right">
                    ${manage ? `<button class="col-menu-btn" onclick="showColMenu(event, ${boardId}, ${col.id})">⋮</button>` : ''}
                  </div>
                </div>
                <div class="column-cards ${isFirst ? 'column-cards--grid' : ''}" data-column-id="${col.id}" data-board-id="${boardId}"
                     ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
                  ${colCards.map(c => renderKanbanCard(c)).join('')}
                </div>
                ${holdCards.length > 0 ? `
                  <div class="on-hold-section">
                    <div class="on-hold-label">ИЗЧАКВАНЕ (${holdCards.length})</div>
                    <div class="column-cards" data-column-id="${col.id}" data-board-id="${boardId}"
                         ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
                      ${holdCards.map(c => renderKanbanCard(c)).join('')}
                    </div>
                  </div>` : ''}
                ${manage ? `<a class="add-card-btn" href="#/card/0/new?board=${boardId}&column=${col.id}">+ Добави карта</a>` : ''}
              </div>`;
          }).join('')}

          ${doneCol ? `
          <div class="kanban-sidebar">
            <div class="kanban-sidebar-tab done-tab" onclick="alert('Завършени: ${doneCards.length} карти')">
              <span class="sidebar-count">(${doneCards.length})</span>
              <span class="sidebar-label">ГОТОВО</span>
            </div>
          </div>` : ''}
        </div>
      </div>
    `;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

function renderKanbanCard(card) {
  const color = getCardColorClass(card);
  const dueStr = card.due_on ? formatDate(card.due_on) : '';
  const authorName = card.assignees?.[0]?.name?.split(' ')[0] || card.creator_name?.split(' ')[0] || '';
  const createdDate = card.created_at ? new Date(card.created_at).toLocaleDateString('bg', { month: 'short', day: 'numeric' }) : '';
  const stepsStr = card.steps_total > 0 ? `${card.steps_done}/${card.steps_total}` : '';

  return `
    <a class="kanban-card ${color}" href="#/card/${card.id}" draggable="true" data-card-id="${card.id}"
       ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)"
       onauxclick="if(event.button===1){event.preventDefault();window.open('#/card/${card.id}','_blank')}">
      <div class="kanban-card__content">
        <h3 class="kanban-card__title">${esc(card.title)}</h3>
        <div class="kanban-card__meta">
          <span class="kanban-card__author">от ${esc(authorName)}${createdDate ? ' \u00b7 ' + createdDate : ''}</span>
        </div>
        <div class="kanban-card__badges">
          ${dueStr ? `<span class="kanban-card__due">\ud83d\udcc5 ${dueStr}</span>` : ''}
          ${stepsStr ? `<span class="kanban-card__steps">\u2713 ${stepsStr}</span>` : ''}
          ${card.comment_count ? `<span class="kanban-card__comments">\ud83d\udcac ${card.comment_count}</span>` : ''}
        </div>
      </div>
      <div class="kanban-card__avatar">${card.assignees?.length ? initials(card.assignees[0].name || '') : '\ud83d\udc64'}</div>
    </a>`;
}

// ==================== CARD PAGE ====================
async function renderCardPage(el, cardId) {
  el.className = '';
  try {
    const card = await (await fetch(`/api/cards/${cardId}`)).json();
    let comments = [];
    try { comments = await (await fetch(`/api/cards/${cardId}/comments`)).json(); } catch {}

    const board = allBoards.find(b => b.id === card.board_id);
    const col = board?.columns?.find(c => c.id === card.column_id);

    setBreadcrumb([
      { label: 'Video Production', href: '#/project/1' },
      { label: board?.title || '—', href: `#/board/${card.board_id}` },
      { label: col?.title || '—', href: `#/board/${card.board_id}` }
    ]);

    const manage = canManage();

    el.innerHTML = `
      <div class="card-page">
        <div class="card-page__toolbar">
          <button class="btn btn-sm" onclick="toggleBoardMenu(event, ${card.board_id}, ${cardId})">⋯</button>
        </div>

        <article class="card-perma">
          <header class="card-perma__header">
            <h1 class="card-perma__title">
              ${manage ? `<a href="#/card/${cardId}/edit" class="card-perma__title-link">${esc(card.title)}</a>` : esc(card.title)}
            </h1>
          </header>

          <section class="card-perma__details">
            <div class="card-field">
              <strong>Колона</strong>
              <div class="card-field__value">
                <span class="column-badge">${esc(col?.title || '—')}</span>
                ${manage ? `<select class="input input-sm" onchange="moveCard(${cardId}, this.value)" style="margin-left:8px;width:auto">
                  <option value="">Премести в...</option>
                  ${(board?.columns || []).filter(c => c.id !== card.column_id).map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}
                </select>` : ''}
              </div>
            </div>
            <div class="card-field">
              <strong>Възложено на</strong>
              <div class="card-field__value">
                ${card.assignees?.length > 0
                  ? card.assignees.map(a => `<span class="assignee-tag">${esc(a.name)}</span>`).join(' ')
                  : `<span style="color:var(--text-dim)">Възложи на...</span>`}
                ${manage ? `<select class="input input-sm" style="margin-left:8px;width:auto" onchange="addAssignee(${cardId}, this.value)">
                  <option value="">+ Добави...</option>
                  ${allUsers.filter(u => !card.assignees?.some(a => a.id === u.id)).map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}
                </select>` : ''}
              </div>
            </div>
            <div class="card-field">
              <strong>Краен срок</strong>
              <div class="card-field__value">
                ${manage ? `<input type="date" lang="bg" class="input input-sm" value="${card.due_on || ''}" onchange="updateField(${cardId},'due_on',this.value||null)" style="width:auto" title="дд.мм.гггг">` : `<span>${card.due_on ? formatDate(card.due_on) : '—'}</span>`}
              </div>
            </div>
            <div class="card-field card-field--notes">
              <strong>Бележки</strong>
              <div class="card-field__value card-content-area">
                ${manage ? `
                  <input id="cardNotesInput" type="hidden" value="${esc(card.content || '')}">
                  <trix-editor input="cardNotesInput" class="trix-dark" placeholder="Добави бележки..."></trix-editor>
                  <button class="btn btn-sm btn-save-notes" onclick="saveCardNotes(${cardId})">Запази бележки</button>
                ` : (card.content ? `<div class="rich-content">${card.content}</div>` : '<span style="color:var(--text-dim)">Добави бележки...</span>')}
              </div>
            </div>
          </section>

          <!-- Steps -->
          <section class="card-perma__steps">
            <div class="steps-header">
              <span style="font-weight:600;color:var(--text)">Стъпки</span>
              <span style="color:var(--text-dim);font-size:12px">(${card.steps?.filter(s=>s.completed).length||0}/${card.steps?.length||0})</span>
              ${card.steps?.length ? `<div class="steps-progress"><div class="steps-progress__fill" style="width:${Math.round((card.steps.filter(s=>s.completed).length/card.steps.length)*100)}%"></div></div>` : ''}
            </div>
            <div class="steps-list">
              ${(card.steps||[]).map(s => `
                <div class="step-item ${s.completed ? 'completed' : ''}">
                  <input type="checkbox" ${s.completed?'checked':''} onchange="toggleStep(${cardId},${s.id},this.checked)">
                  <span class="step-title">${esc(s.title)}</span>
                  ${s.assignee_id ? `<span class="step-assignee">${esc(allUsers.find(u=>u.id===s.assignee_id)?.name||'')}</span>` : ''}
                  ${s.due_on ? `<span class="step-due">${formatDate(s.due_on)}</span>` : ''}
                </div>`).join('')}
            </div>
            <div class="add-step-row">
              <input id="newStepInput" placeholder="Добави стъпка..." onkeydown="if(event.key==='Enter')addStepFromPage(${cardId})">
              <select id="newStepAssignee" style="width:120px"><option value="">Възложи...</option>${allUsers.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
              <input type="date" id="newStepDue" style="width:130px">
              <button class="btn btn-sm" onclick="addStepFromPage(${cardId})">+</button>
            </div>
          </section>

          <!-- Comments -->
          <section class="card-perma__comments">
            ${comments.map((c, ci) => {
              const commentColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
              const cc = commentColors[(c.user_name||'').length % commentColors.length];
              return `
              <div class="comment-item">
                <div class="comment-avatar" style="background:${cc};color:#fff">${initials(c.user_name)}</div>
                <div class="comment-body">
                  <div class="comment-header">
                    <strong>${esc(c.user_name)}</strong>
                    <span class="hint">${timeAgo(c.created_at)}</span>
                  </div>
                  <div class="comment-text">${esc(c.content).replace(/\n/g,'<br>').replace(/@(\w+)/g,'<span class="mention">@$1</span>')}</div>
                </div>
              </div>`;
            }).join('')}

            <div class="add-comment-row">
              <textarea id="newComment" placeholder="Добави коментар..." rows="3"></textarea>
              <button class="btn btn-primary btn-sm" onclick="addComment(${cardId})">Публикувай</button>
            </div>
          </section>
        </article>
      </div>
    `;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Картата не е намерена</div>'; }
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
  const c = document.getElementById('newComment')?.value?.trim(); if (!c) return;
  const mentions = [...c.matchAll(/@(\S+)/g)].map(m=>m[1].toLowerCase());
  const mIds = allUsers.filter(u=>mentions.some(n=>u.name.toLowerCase().includes(n))).map(u=>u.id);
  try { await fetch(`/api/cards/${cardId}/comments`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content:c,mentions:mIds}) }); document.getElementById('newComment').value=''; router(); } catch {}
}

// ==================== ACTIVITY ====================
async function renderActivity(el) {
  setBreadcrumb(null); el.className = '';
  try {
    const items = await (await fetch('/api/activity?limit=50')).json();
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
function handleWSEvent(ev) { const t=ev.type||''; if(t.startsWith('card:')||t.startsWith('board:')||t.startsWith('column:')||t.startsWith('step:')||t.startsWith('comment:'))router(); if(t==='chat:message'&&location.hash.startsWith(`#/chat/${ev.channelId}`))router(); updateHeyBadge(); }

// ==================== UTILS ====================
function esc(s) { if(!s)return''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatDate(d) { if(!d)return''; const s=d.split('T')[0]; const[y,m,dd]=s.split('-'); return`${dd}.${m}.${y}`; }
function getCardColorClass(c) { if(c.is_on_hold)return'on-hold'; if(c.priority==='urgent')return'priority'; if(!c.due_on)return''; const n=new Date();n.setHours(0,0,0,0); const due=new Date(c.due_on+'T00:00:00'); const diff=Math.ceil((due-n)/86400000); if(diff<0)return'overdue'; if(diff===0)return'deadline-today'; if(diff<=4)return'deadline-soon'; return'deadline-ok'; }
function timeAgo(d) { const s=Math.floor((Date.now()-new Date(d))/1000); if(s<60)return'сега'; if(s<3600)return Math.floor(s/60)+'м'; if(s<86400)return Math.floor(s/3600)+'ч'; return Math.floor(s/86400)+'д назад'; }

// ==================== INIT ====================
(async function() { if(!await checkAuth())return; if(!location.hash||location.hash==='#'||location.hash==='#/')location.hash='#/home'; router(); connectWS(); })();
