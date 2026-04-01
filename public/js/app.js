// ThePact Platform — Main Application
let currentView = 'board';
let currentUser = null;
let ws = null;
let wsReconnectDelay = 1000;

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

  // Load view data
  if (view === 'board') loadBoard();
}

// ==================== BOARD ====================

async function loadBoard() {
  try {
    const [boardsRes, cardsRes] = await Promise.all([
      fetch('/api/boards'),
      fetch('/api/cards')
    ]);
    const boards = await boardsRes.json();
    const cards = await cardsRes.json();

    const container = document.getElementById('boardContainer');
    if (boards.length === 0) {
      container.innerHTML = '<div class="empty-state">Няма создадени борда.</div>';
      return;
    }

    container.innerHTML = boards.map(board => {
      const boardCards = cards.filter(c => c.board_id === board.id);
      return `
        <div class="board-section" data-board-id="${board.id}">
          <div class="board-title">${escapeHtml(board.title)} <span class="card-count">(${boardCards.length})</span></div>
          ${board.columns.filter(col => !col.is_done_column).map(col => {
            const colCards = boardCards.filter(c => c.column_id === col.id);
            return `
              <div class="column-group">
                <div class="column-header">
                  ${escapeHtml(col.title)} <span class="col-count">${colCards.length}</span>
                </div>
                <div class="column-cards" data-column-id="${col.id}" data-board-id="${board.id}"
                     ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
                  ${colCards.map(card => renderCard(card)).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Board load error:', err);
    document.getElementById('boardContainer').innerHTML = '<div class="empty-state">Грешка при зареждане</div>';
  }
}

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
    if (res.ok) loadBoard();
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
  // Refresh board on any card mutation
  if (event.type?.startsWith('card:') || event.type?.startsWith('step:')) {
    if (currentView === 'board') loadBoard();
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
  loadBoard();
  connectWS();
})();
