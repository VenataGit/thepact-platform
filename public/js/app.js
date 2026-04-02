// ThePact Platform — Main Application
let currentView = 'board';
let currentUser = null;
let ws = null;
let wsReconnectDelay = 1000;
let openBoardId = null;
let allUsers = [];

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
    // Load team members
    try {
      const teamRes = await fetch('/api/users/team');
      if (teamRes.ok) allUsers = await teamRes.json();
    } catch {}
    return true;
  } catch {
    window.location.href = '/login.html';
    return false;
  }
}

function canManage() {
  return currentUser?.role === 'admin' || currentUser?.role === 'moderator';
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  localStorage.removeItem('pact_user');
  window.location.href = '/login.html';
}

// ==================== ROUTER ====================

const VIEW_TITLES = {
  board: 'Табло', daily: 'Днес', overdue: 'Просрочени', people: 'По хора',
  clients: 'Клиенти', videos: 'Видеа', calendar: 'Календар',
  kp: 'КП Автоматизация', settings: 'Настройки', admin: 'Админ панел'
};

function navigate(hash) {
  if (location.hash === hash) router();
  else location.hash = hash;
}

function router() {
  const hash = location.hash || '#/board';
  const parts = hash.replace('#/', '').split('/');
  const view = parts[0] || 'board';
  const param = parts[1] ? parseInt(parts[1]) : null;

  if (view === 'board' && param) {
    activateView('board');
    openBoardId = param;
    loadBoardDetail(param);
    return;
  }

  openBoardId = null;
  activateView(view);
  if (view === 'board') loadBoardGrid();
}

function activateView(view) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const viewEl = document.getElementById('view-' + view);
  if (viewEl) viewEl.classList.add('active');

  const navEl = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (navEl) navEl.classList.add('active');

  document.getElementById('pageTitle').textContent = VIEW_TITLES[view] || view;
  currentView = view;
}

window.addEventListener('hashchange', router);

// ==================== BOARD GRID (HOME) ====================

async function loadBoardGrid() {
  document.getElementById('pageTitle').textContent = VIEW_TITLES.board;
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
        <a class="board-box" href="#/board/${board.id}">
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
        </a>
      `;
    }).join('')}</div>`;

  } catch (err) {
    console.error('Board grid load error:', err);
    document.getElementById('boardContainer').innerHTML = '<div class="empty-state">Грешка при зареждане</div>';
  }
}

// ==================== BOARD DETAIL (KANBAN) ====================

async function loadBoardDetail(boardId) {
  try {
    const [boardsRes, cardsRes] = await Promise.all([
      fetch('/api/boards'),
      fetch(`/api/cards?board_id=${boardId}`)
    ]);
    const boards = await boardsRes.json();
    const cards = await cardsRes.json();

    const board = boards.find(b => b.id === boardId);
    if (!board) return;

    const container = document.getElementById('boardContainer');
    document.getElementById('pageTitle').textContent = board.title;

    const manage = canManage();

    container.innerHTML = `
      <div class="board-detail-header">
        <a class="btn btn-ghost btn-sm" href="#/board">&#8592; Всички борда</a>
        <span class="board-detail-count">${cards.length} карти</span>
        ${manage ? `
          <div class="board-detail-actions">
            <button class="btn btn-sm" onclick="promptAddColumn(${boardId})">+ Колона</button>
            <button class="btn btn-sm" onclick="promptRenameBoard(${boardId}, '${escapeHtml(board.title).replace(/'/g, "\\'")}')">&#9998; Преименувай</button>
          </div>
        ` : ''}
      </div>
      <div class="board-kanban">
        ${board.columns.filter(col => !col.is_done_column).map(col => {
          const colCards = cards.filter(c => c.column_id === col.id);
          return renderKanbanColumn(col, colCards, boardId, manage);
        }).join('')}
        ${(() => {
          const doneCol = board.columns.find(col => col.is_done_column);
          if (!doneCol) return '';
          const doneCards = cards.filter(c => c.column_id === doneCol.id);
          return `
            <div class="kanban-column done-column">
              <div class="column-header">
                <span>DONE</span>
                <span class="col-count">${doneCards.length}</span>
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

function renderKanbanColumn(col, colCards, boardId, manage) {
  return `
    <div class="kanban-column" data-col-id="${col.id}">
      <div class="column-header">
        <span class="column-title" ${manage ? `ondblclick="editColumnTitle(${boardId}, ${col.id}, this)"` : ''}>${escapeHtml(col.title)}</span>
        <div class="column-header-right">
          <span class="col-count">${colCards.length}</span>
          ${manage ? `<button class="col-menu-btn" onclick="showColMenu(event, ${boardId}, ${col.id})">&#8942;</button>` : ''}
        </div>
      </div>
      <div class="column-cards" data-column-id="${col.id}" data-board-id="${boardId}"
           ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
        ${colCards.map(card => renderCard(card)).join('')}
      </div>
      ${manage ? `
        <button class="add-card-btn" onclick="promptAddCard(${boardId}, ${col.id})">+ Добави карта</button>
      ` : ''}
    </div>
  `;
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
         onclick="openCardModal(${card.id})">
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

// ==================== CARD CRUD ====================

async function promptAddCard(boardId, columnId) {
  const title = prompt('Заглавие на картата:');
  if (!title?.trim()) return;

  try {
    const res = await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: boardId, column_id: columnId, title: title.trim() })
    });
    if (res.ok) loadBoardDetail(boardId);
  } catch (err) {
    console.error('Add card error:', err);
  }
}

// ==================== CARD DETAIL MODAL ====================

async function openCardModal(cardId) {
  try {
    const res = await fetch(`/api/cards/${cardId}`);
    if (!res.ok) return;
    const card = await res.json();
    showCardModal(card);
  } catch (err) {
    console.error('Open card error:', err);
  }
}

function showCardModal(card) {
  const manage = canManage();
  const modal = document.getElementById('cardModal');

  const assigneeNames = card.assignees?.map(a => escapeHtml(a.name)).join(', ') || 'Няма';
  const stepsHtml = card.steps?.length > 0 ? card.steps.map(s => `
    <div class="step-item ${s.completed ? 'completed' : ''}" data-step-id="${s.id}">
      <input type="checkbox" ${s.completed ? 'checked' : ''} onchange="toggleStep(${card.id}, ${s.id}, this.checked)">
      <span class="step-title">${escapeHtml(s.title)}</span>
      ${s.due_on ? `<span class="step-due">${formatDate(s.due_on)}</span>` : ''}
    </div>
  `).join('') : '<div class="hint">Няма стъпки</div>';

  const notesHtml = card.notes?.length > 0 ? card.notes.map(n => `
    <div class="note-item">
      <div class="note-header"><strong>${escapeHtml(n.author_name || 'Unknown')}</strong> <span class="hint">${new Date(n.created_at).toLocaleString('bg')}</span></div>
      <div class="note-content">${escapeHtml(n.content)}</div>
    </div>
  `).join('') : '';

  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeCardModal()">
      <div class="modal-content" onclick="event.stopPropagation()">
        <button class="modal-close" onclick="closeCardModal()">&times;</button>

        <div class="modal-body">
          <div class="modal-main">
            <div class="card-detail-title-row">
              ${manage ? `<input class="card-detail-title" value="${escapeHtml(card.title)}" onchange="updateCardField(${card.id}, 'title', this.value)">` : `<h2 class="card-detail-title-ro">${escapeHtml(card.title)}</h2>`}
            </div>

            <div class="card-detail-section">
              <div class="section-subtitle">Описание</div>
              <textarea class="card-detail-content" placeholder="Добави описание..." onchange="updateCardField(${card.id}, 'content', this.value)">${escapeHtml(card.content || '')}</textarea>
            </div>

            <div class="card-detail-section">
              <div class="section-subtitle">Стъпки (${card.steps?.filter(s => s.completed).length || 0}/${card.steps?.length || 0})</div>
              <div class="steps-list">${stepsHtml}</div>
              <div class="add-step-row">
                <input class="add-step-input" placeholder="Нова стъпка..." onkeydown="if(event.key==='Enter')addStep(${card.id}, this)">
                <button class="btn btn-sm" onclick="addStep(${card.id}, this.previousElementSibling)">+</button>
              </div>
            </div>

            <div class="card-detail-section">
              <div class="section-subtitle">Бележки</div>
              ${notesHtml}
              <div class="add-note-row">
                <textarea class="add-note-input" placeholder="Добави бележка..." rows="2"></textarea>
                <button class="btn btn-sm" onclick="addNote(${card.id}, this.previousElementSibling)">Запази</button>
              </div>
            </div>
          </div>

          <div class="modal-sidebar">
            <div class="card-detail-field">
              <label>Статус</label>
              <div class="card-status-badges">
                ${card.is_on_hold ? '<span class="badge">⏸ На пауза</span>' : ''}
                ${card.priority === 'urgent' ? '<span class="badge badge-red">⚡ Спешна</span>' : ''}
                ${card.priority === 'high' ? '<span class="badge badge-accent">↑ Висок</span>' : ''}
                ${!card.is_on_hold && card.priority === 'normal' ? '<span class="badge badge-green">Активна</span>' : ''}
              </div>
            </div>

            <div class="card-detail-field">
              <label>Дедлайн</label>
              <input type="date" value="${card.due_on || ''}" onchange="updateCardField(${card.id}, 'due_on', this.value || null)">
            </div>

            <div class="card-detail-field">
              <label>Дата на публикуване</label>
              <input type="date" value="${card.publish_date || ''}" onchange="updateCardField(${card.id}, 'publish_date', this.value || null)">
            </div>

            <div class="card-detail-field">
              <label>Приоритет</label>
              <select onchange="updateCardField(${card.id}, 'priority', this.value)">
                <option value="normal" ${card.priority === 'normal' ? 'selected' : ''}>Нормален</option>
                <option value="high" ${card.priority === 'high' ? 'selected' : ''}>Висок</option>
                <option value="urgent" ${card.priority === 'urgent' ? 'selected' : ''}>Спешен</option>
              </select>
            </div>

            <div class="card-detail-field">
              <label>На пауза</label>
              <label class="toggle-label">
                <input type="checkbox" ${card.is_on_hold ? 'checked' : ''} onchange="updateCardField(${card.id}, 'is_on_hold', this.checked)">
                <span>Чакаме клиента</span>
              </label>
            </div>

            <div class="card-detail-field">
              <label>Назначени</label>
              <div class="assignee-list">${assigneeNames}</div>
              ${manage ? `<select class="assignee-select" multiple onchange="updateAssignees(${card.id}, this)">
                ${allUsers.map(u => `<option value="${u.id}" ${card.assignees?.some(a => a.id === u.id) ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
              </select>` : ''}
            </div>

            <div class="card-detail-field">
              <label>Клиент</label>
              <input value="${escapeHtml(card.client_name || '')}" placeholder="Име на клиент" onchange="updateCardField(${card.id}, 'client_name', this.value || null)">
            </div>

            <div class="card-detail-field">
              <label>КП №</label>
              <input type="number" value="${card.kp_number || ''}" placeholder="—" onchange="updateCardField(${card.id}, 'kp_number', this.value ? parseInt(this.value) : null)">
            </div>

            <div class="card-detail-field">
              <label>Видео №</label>
              <input type="number" value="${card.video_number || ''}" placeholder="—" onchange="updateCardField(${card.id}, 'video_number', this.value ? parseInt(this.value) : null)">
            </div>

            ${manage ? `<div class="card-detail-field danger-zone">
              <button class="btn btn-danger btn-sm" onclick="archiveCard(${card.id})">🗑 Архивирай</button>
            </div>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'block';
}

function closeCardModal() {
  document.getElementById('cardModal').style.display = 'none';
  if (openBoardId) loadBoardDetail(openBoardId);
}

async function updateCardField(cardId, field, value) {
  try {
    await fetch(`/api/cards/${cardId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value })
    });
  } catch (err) {
    console.error('Update card error:', err);
  }
}

async function updateAssignees(cardId, select) {
  const ids = Array.from(select.selectedOptions).map(o => parseInt(o.value));
  try {
    await fetch(`/api/cards/${cardId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_ids: ids })
    });
  } catch (err) {
    console.error('Update assignees error:', err);
  }
}

async function archiveCard(cardId) {
  if (!confirm('Сигурен ли си, че искаш да архивираш тази карта?')) return;
  try {
    const res = await fetch(`/api/cards/${cardId}`, { method: 'DELETE' });
    if (res.ok) {
      closeCardModal();
    }
  } catch (err) {
    console.error('Archive card error:', err);
  }
}

// ==================== STEPS ====================

async function toggleStep(cardId, stepId, completed) {
  try {
    await fetch(`/api/cards/${cardId}/steps/${stepId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed })
    });
    openCardModal(cardId); // refresh
  } catch (err) {
    console.error('Toggle step error:', err);
  }
}

async function addStep(cardId, input) {
  const title = input.value.trim();
  if (!title) return;
  try {
    await fetch(`/api/cards/${cardId}/steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    input.value = '';
    openCardModal(cardId); // refresh
  } catch (err) {
    console.error('Add step error:', err);
  }
}

// ==================== NOTES ====================

async function addNote(cardId, textarea) {
  const content = textarea.value.trim();
  if (!content) return;
  try {
    await fetch(`/api/cards/${cardId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    textarea.value = '';
    openCardModal(cardId); // refresh
  } catch (err) {
    console.error('Add note error:', err);
  }
}

// ==================== COLUMN MANAGEMENT ====================

async function promptAddColumn(boardId) {
  const title = prompt('Име на новата колона:');
  if (!title?.trim()) return;
  try {
    await fetch(`/api/boards/${boardId}/columns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim() })
    });
    loadBoardDetail(boardId);
  } catch (err) {
    console.error('Add column error:', err);
  }
}

function editColumnTitle(boardId, colId, el) {
  const current = el.textContent;
  el.contentEditable = true;
  el.focus();

  const save = async () => {
    el.contentEditable = false;
    const newTitle = el.textContent.trim();
    if (newTitle && newTitle !== current) {
      try {
        await fetch(`/api/boards/${boardId}/columns/${colId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle })
        });
      } catch {}
    } else {
      el.textContent = current;
    }
  };

  el.onblur = save;
  el.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { el.textContent = current; el.blur(); }
  };
}

function showColMenu(e, boardId, colId) {
  e.stopPropagation();
  // Remove any existing menu
  document.querySelectorAll('.col-context-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'col-context-menu';
  menu.innerHTML = `
    <button onclick="promptRenameColumn(${boardId}, ${colId}); this.parentElement.remove()">&#9998; Преименувай</button>
    <button onclick="deleteColumn(${boardId}, ${colId}); this.parentElement.remove()">&#128465; Изтрий</button>
  `;
  e.target.parentElement.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}

async function promptRenameColumn(boardId, colId) {
  const title = prompt('Ново име на колоната:');
  if (!title?.trim()) return;
  try {
    await fetch(`/api/boards/${boardId}/columns/${colId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim() })
    });
    loadBoardDetail(boardId);
  } catch {}
}

async function deleteColumn(boardId, colId) {
  if (!confirm('Сигурен ли си? Всички карти в тази колона ще бъдат изтрити!')) return;
  try {
    await fetch(`/api/boards/${boardId}/columns/${colId}`, { method: 'DELETE' });
    loadBoardDetail(boardId);
  } catch {}
}

// ==================== BOARD MANAGEMENT ====================

async function promptRenameBoard(boardId, currentTitle) {
  const title = prompt('Ново име на борда:', currentTitle);
  if (!title?.trim() || title.trim() === currentTitle) return;
  try {
    await fetch(`/api/boards/${boardId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim() })
    });
    loadBoardDetail(boardId);
  } catch {}
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
      : user.role === 'moderator'
      ? '<span class="badge badge-blue">MODERATOR</span>'
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeCardModal();
    closeProfile();
  }
});
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
    if (res.ok && openBoardId) loadBoardDetail(openBoardId);
  } catch (err) {
    console.error('Move error:', err);
  }
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
  const t = event.type || '';
  if (t.startsWith('card:') || t.startsWith('step:') || t.startsWith('board:') || t.startsWith('column:')) {
    if (currentView === 'board') {
      if (openBoardId) loadBoardDetail(openBoardId);
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
  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    location.hash = '#/board';
  }
  router();
  connectWS();
})();
