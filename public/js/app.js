// ThePact Platform — Main Application
let currentView = 'board';
let currentUser = null;
let ws = null;
let wsReconnectDelay = 1000;
let openBoardId = null; // which board is open in detail view

// ==================== AUTH ====================

async function checkAuth() {
  try {
    const res = await fetch('/auth/status');
    if (!res.ok) throw new Error('Not authenticated');
    const data = await res.json();
    currentUser = data.user;
    document.getElementById('sidebarUserName').textContent = currentUser.name;
    const initials = currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2);
    document.getElementById('sidebarUserAvatar').textContent = initials;
    if (currentUser.role === 'admin') {
      document.getElementById('adminNavItem').style.display = '';
    }
    return true;
  } catch {
    window.location.href = '/login.html';
    return false;
  }
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  localStorage.removeItem('pact_user');
  window.location.href = '/login.html';
}

// ==================== VIEWS ====================

const VIEW_TITLES = {
  board: 'Табло', daily: 'Днес', overdue: 'Просрочени', people: 'По хора',
  clients: 'Клиенти', videos: 'Видеа', calendar: 'Календар',
  kp: 'КП Автоматизация', settings: 'Настройки', admin: 'Админ панел'
};

function switchView(view) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const viewEl = document.getElementById('view-' + view);
  if (viewEl) viewEl.classList.add('active');

  const navEl = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (navEl) navEl.classList.add('active');

  document.getElementById('pageTitle').textContent = VIEW_TITLES[view] || view;
  currentView = view;

  if (view === 'board') {
    openBoardId = null;
    loadBoardGrid();
  }
}

// ==================== BOARD GRID (HOME) ====================

async function loadBoardGrid() {
  try {
    const [boardsRes, cardsRes] = await Promise.all([
      fetch('/api/boards'),
      fetch('/api/cards')
    ]);
    const boards = await boardsRes.json();
    const cards = await cardsRes.json();

    const container = document.getElementById('boardContainer');
    if (boards.length === 0) {
      container.innerHTML = '<div class="empty-state">Няма създадени борда.</div>';
      return;
    }

    container.innerHTML = `<div class="boards-grid">${boards.map(board => {
      const boardCards = cards.filter(c => c.board_id === board.id);
      const visibleCols = board.columns.filter(col => !col.is_done_column);
      const doneCol = board.columns.find(col => col.is_done_column);
      const doneCount = doneCol ? boardCards.filter(c => c.column_id === doneCol.id).length : 0;

      return `
        <div class="board-box" onclick="openBoardDetail(${board.id})">
          <div class="board-box-header">
            <div class="board-box-title">${escapeHtml(board.title)}</div>
            <div class="board-box-count">${boardCards.length} карти</div>
          </div>
          <div class="board-box-preview">
            ${visibleCols.map(col => {
              const colCards = boardCards.filter(c => c.column_id === col.id);
              const height = Math.max(20, Math.min(100, colCards.length * 18));
              return `
                <div class="preview-col" title="${escapeHtml(col.title)} (${colCards.length})">
                  <div class="preview-bar" style="height:${height}%"></div>
                  <span class="preview-count">(${colCards.length})</span>
                  <span class="preview-label">${escapeHtml(col.title)}</span>
                </div>
              `;
            }).join('')}
            ${doneCol ? `
              <div class="preview-col done" title="Done (${doneCount})">
                <div class="preview-bar" style="height:${Math.max(20, Math.min(100, doneCount * 10))}%"></div>
                <span class="preview-count">(${doneCount})</span>
                <span class="preview-label">DONE</span>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('')}</div>`;

  } catch (err) {
    console.error('Board grid load error:', err);
    document.getElementById('boardContainer').innerHTML = '<div class="empty-state">Грешка при зареждане</div>';
  }
}

// ==================== BOARD DETAIL (KANBAN) ====================

async function openBoardDetail(boardId) {
  openBoardId = boardId;
  try {
    const [boardsRes, cardsRes] = await Promise.all([
      fetch('/api/boards'),
      fetch('/api/cards')
    ]);
    const boards = await boardsRes.json();
    const cards = await cardsRes.json();

    const board = boards.find(b => b.id === boardId);
    if (!board) return;

    const boardCards = cards.filter(c => c.board_id === boardId);
    const container = document.getElementById('boardContainer');

    document.getElementById('pageTitle').textContent = board.title;

    container.innerHTML = `
      <div class="board-detail-header">
        <button class="btn btn-ghost btn-sm" onclick="goBackToGrid()">&#8592; Всички борда</button>
        <span class="board-detail-count">${boardCards.length} карти</span>
      </div>
      <div class="board-kanban">
        ${board.columns.filter(col => !col.is_done_column).map(col => {
          const colCards = boardCards.filter(c => c.column_id === col.id);
          return `
            <div class="kanban-column">
              <div class="column-header">
                ${escapeHtml(col.title)} <span class="col-count">${colCards.length}</span>
              </div>
              <div class="column-cards" data-column-id="${col.id}" data-board-id="${boardId}"
                   ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
                ${colCards.map(card => renderCard(card)).join('')}
              </div>
            </div>
          `;
        }).join('')}
        ${(() => {
          const doneCol = board.columns.find(col => col.is_done_column);
          if (!doneCol) return '';
          const doneCards = boardCards.filter(c => c.column_id === doneCol.id);
          return `
            <div class="kanban-column done-column">
              <div class="column-header">
                DONE <span class="col-count">${doneCards.length}</span>
              </div>
              <div class="column-cards" data-column-id="${doneCol.id}" data-board-id="${boardId}"
                   ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
                ${doneCards.map(card => renderCard(card)).join('')}
              </div>
            </div>
          `;
        })()}
      </div>
    `;

  } catch (err) {
    console.error('Board detail error:', err);
  }
}

function goBackToGrid() {
  openBoardId = null;
  document.getElementById('pageTitle').textContent = VIEW_TITLES.board;
  loadBoardGrid();
}

// ==================== CARD RENDERING ====================

function renderCard(card) {
  const colorClass = getCardColorClass(card);
  const dueStr = card.due_on ? formatDate(card.due_on) : '';
  const assigneeStr = card.assignees?.map(a => a.name?.split(' ')[0]).join(', ') || '';
  const stepsStr = card.steps_total > 0 ? `${card.steps_done}/${card.steps_total}` : '';

  return `
    <div class="board-card ${colorClass}" draggable="true" data-card-id="${card.id}"
         ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)"
         onclick="openCard(${card.id})">
      <div class="card-title">${escapeHtml(card.title)}</div>
      <div class="card-meta">
        ${dueStr ? `<span class="card-due">${dueStr}</span>` : ''}
        ${assigneeStr ? `<span class="card-assignee">${escapeHtml(assigneeStr)}</span>` : ''}
        ${stepsStr ? `<span class="card-steps">✓ ${stepsStr}</span>` : ''}
      </div>
    </div>
  `;
}

function getCardColorClass(card) {
  if (card.is_on_hold) return 'on-hold';
  if (card.priority === 'urgent') return 'priority';
  if (!card.due_on) return '';
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(card.due_on + 'T00:00:00');
  const diff = Math.ceil((due - now) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'deadline-today';
  if (diff <= 4) return 'deadline-soon';
  return 'deadline-ok';
}

// ==================== PROFILE ====================

async function openProfile() {
  const modal = document.getElementById('profileModal');
  modal.style.display = 'flex';

  try {
    const res = await fetch('/api/profile');
    const user = await res.json();

    const initials = user.name.split(' ').map(n => n[0]).join('').substring(0, 2);
    const avatar = document.getElementById('profileAvatar');
    if (user.avatar_url) {
      avatar.innerHTML = `<img src="${user.avatar_url}" style="width:100%;height:100%;object-fit:cover">`;
    } else {
      avatar.textContent = initials;
    }

    document.getElementById('profileName').textContent = user.name;
    document.getElementById('profileEmail').textContent = user.email;
    document.getElementById('profileRole').innerHTML = user.role === 'admin'
      ? '<span class="badge badge-accent">ADMIN</span>'
      : '<span class="badge" style="background:var(--bg-hover);color:var(--text-dim)">MEMBER</span>';
    document.getElementById('profileNameInput').value = user.name;
  } catch {}
}

function closeProfile() {
  document.getElementById('profileModal').style.display = 'none';
}

async function saveProfileName() {
  const name = document.getElementById('profileNameInput').value.trim();
  if (!name) return;
  try {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      const user = await res.json();
      document.getElementById('profileName').textContent = user.name;
      document.getElementById('sidebarUserName').textContent = user.name;
      const initials = user.name.split(' ').map(n => n[0]).join('').substring(0, 2);
      document.getElementById('sidebarUserAvatar').textContent = initials;
    }
  } catch {}
}

async function uploadAvatar(input) {
  if (!input.files[0]) return;
  const form = new FormData();
  form.append('avatar', input.files[0]);
  try {
    const res = await fetch('/api/profile/avatar', { method: 'POST', body: form });
    if (res.ok) {
      const user = await res.json();
      document.getElementById('profileAvatar').innerHTML = `<img src="${user.avatar_url}" style="width:100%;height:100%;object-fit:cover">`;
      currentUser.avatar_url = user.avatar_url;
    }
  } catch {}
}

async function changePassword() {
  const msg = document.getElementById('pwdMsg');
  const curr = document.getElementById('currentPwd').value;
  const newP = document.getElementById('newPwd').value;
  if (!curr || !newP) { msg.textContent = 'Попълни и двете полета'; msg.style.color = 'var(--red)'; return; }
  try {
    const res = await fetch('/api/profile/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: curr, newPassword: newP })
    });
    const data = await res.json();
    if (res.ok) {
      msg.textContent = 'Паролата е сменена'; msg.style.color = 'var(--green)';
      document.getElementById('currentPwd').value = '';
      document.getElementById('newPwd').value = '';
    } else {
      msg.textContent = data.error; msg.style.color = 'var(--red)';
    }
  } catch { msg.textContent = 'Грешка'; msg.style.color = 'var(--red)'; }
}

// Close profile modal on escape or outside click
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeProfile(); });
document.getElementById('profileModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeProfile();
});

// ==================== DRAG & DROP ====================

let dragCardId = null;

function handleDragStart(e) {
  dragCardId = e.target.dataset.cardId;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  dragCardId = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!dragCardId) return;

  const columnId = parseInt(e.currentTarget.dataset.columnId);
  const boardId = parseInt(e.currentTarget.dataset.boardId);

  try {
    const res = await fetch(`/api/cards/${dragCardId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column_id: columnId, board_id: boardId })
    });
    if (res.ok && openBoardId) openBoardDetail(openBoardId);
  } catch (err) {
    console.error('Move error:', err);
  }
}

function openCard(cardId) {
  // TODO: card detail modal
  console.log('Open card:', cardId);
}

// ==================== WEBSOCKET ====================

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    wsReconnectDelay = 1000;
    document.getElementById('wsStatusDot').className = 'status-dot online';
    document.getElementById('wsStatus').textContent = 'на живо';
  };

  ws.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      handleWSEvent(event);
    } catch {}
  };

  ws.onclose = () => {
    document.getElementById('wsStatusDot').className = 'status-dot offline';
    document.getElementById('wsStatus').textContent = '';
    setTimeout(connectWS, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);
  };

  ws.onerror = () => ws.close();
}

function handleWSEvent(event) {
  if (event.type?.startsWith('card:') || event.type?.startsWith('step:')) {
    if (currentView === 'board') {
      if (openBoardId) openBoardDetail(openBoardId);
      else loadBoardGrid();
    }
  }
}

// ==================== UTILS ====================

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}`;
}

// ==================== INIT ====================

(async function init() {
  const ok = await checkAuth();
  if (!ok) return;
  loadBoardGrid();
  connectWS();
})();
