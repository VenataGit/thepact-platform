// ThePact Platform — Main Application (v2 — Basecamp-style)
let currentUser = null;
let ws = null;
let wsReconnectDelay = 1000;
let allUsers = [];
let allBoards = [];

// ==================== AUTH ====================

async function checkAuth() {
  try {
    const res = await fetch('/auth/status');
    if (!res.ok) throw new Error();
    const data = await res.json();
    currentUser = data.user;
    const initials = currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2);
    document.getElementById('topNavAvatar').textContent = initials;
    try { const r = await fetch('/api/users/team'); if (r.ok) allUsers = await r.json(); } catch {}
    try { const r = await fetch('/api/boards'); if (r.ok) allBoards = await r.json(); } catch {}
    updateNotifBadge();
    return true;
  } catch { window.location.href = '/login.html'; return false; }
}
function canManage() { return currentUser?.role === 'admin' || currentUser?.role === 'moderator'; }
async function logout() { await fetch('/auth/logout', { method: 'POST' }); window.location.href = '/login.html'; }

async function updateNotifBadge() {
  try {
    const r = await fetch('/api/notifications/unread-count');
    if (r.ok) {
      const { count } = await r.json();
      const b = document.getElementById('notifBadge');
      if (count > 0) { b.textContent = count; b.style.display = ''; }
      else b.style.display = 'none';
    }
  } catch {}
}

// ==================== ROUTER ====================

function router() {
  const hash = location.hash || '#/home';
  const parts = hash.replace('#/', '').split('/');
  const page = parts[0] || 'home';
  const id = parts[1] ? parseInt(parts[1]) : null;
  const sub = parts[2] || null;

  // Clear active states
  document.querySelectorAll('.top-nav-item, .top-nav-icon').forEach(el => el.classList.remove('active'));
  const activeNav = document.querySelector(`[data-tnav="${page}"]`);
  if (activeNav) activeNav.classList.add('active');

  const content = document.getElementById('pageContent');

  switch (page) {
    case 'home': return renderHome(content);
    case 'production': return id ? renderBoardDetail(content, id) : renderProduction(content);
    case 'card':
      if (sub === 'new') return renderCardCreate(content, id); // id = boardId from query
      return id ? renderCardPage(content, id) : renderHome(content);
    case 'activity': return renderActivity(content);
    case 'mystuff': return renderMyStuff(content);
    case 'find': return renderFind(content);
    case 'notifications': return renderNotifications(content);
    case 'chat': return id ? renderChatChannel(content, id) : renderChatList(content);
    case 'messages': return renderMessageBoard(content);
    case 'vault': return renderVault(content, id);
    default: return renderHome(content);
  }
}

window.addEventListener('hashchange', router);

function setBreadcrumb(items) {
  const bar = document.getElementById('breadcrumbBar');
  const bc = document.getElementById('breadcrumb');
  const main = document.getElementById('mainArea');
  if (!items || items.length === 0) {
    bar.style.display = 'none';
    main.classList.remove('with-breadcrumb');
    return;
  }
  bar.style.display = 'flex';
  main.classList.add('with-breadcrumb');
  bc.innerHTML = items.map((item, i) => {
    if (i === items.length - 1) return `<span class="current">${esc(item.label)}</span>`;
    return `<a href="${item.href}">${esc(item.label)}</a><span class="sep">›</span>`;
  }).join('');
}

// ==================== HOME (Overview / Табло) ====================

async function renderHome(el) {
  setBreadcrumb(null);
  el.innerHTML = '<div class="empty-state">Зареждане...</div>';

  try {
    const [cardsRes, boardsRes] = await Promise.all([
      fetch('/api/cards'), fetch('/api/boards')
    ]);
    const cards = await cardsRes.json();
    const boards = await boardsRes.json();
    allBoards = boards;

    const overdue = cards.filter(c => {
      if (c.is_on_hold || c.completed_at) return false;
      if (!c.due_on) return false;
      return new Date(c.due_on + 'T00:00:00') < new Date(new Date().toDateString());
    });
    const today = cards.filter(c => {
      if (c.is_on_hold || c.completed_at || !c.due_on) return false;
      return c.due_on === new Date().toISOString().split('T')[0];
    });
    const active = cards.filter(c => !c.completed_at && !c.is_on_hold);

    el.innerHTML = `
      <div class="page-header">
        <h1>Табло</h1>
        <p class="page-subtitle">Общ преглед на всички задачи</p>
      </div>

      <div class="home-stats">
        <div class="stat-card">
          <div class="stat-number">${active.length}</div>
          <div class="stat-label">Активни</div>
        </div>
        <div class="stat-card stat-warning">
          <div class="stat-number">${overdue.length}</div>
          <div class="stat-label">Просрочени</div>
        </div>
        <div class="stat-card stat-accent">
          <div class="stat-number">${today.length}</div>
          <div class="stat-label">Днес</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${boards.length}</div>
          <div class="stat-label">Борда</div>
        </div>
      </div>

      <div class="home-sections">
        <div class="home-section">
          <h2 class="section-title">🏭 Продукция</h2>
          <div class="boards-grid">
            ${boards.map(board => {
              const bc = cards.filter(c => c.board_id === board.id);
              return `
                <a class="board-box" href="#/production/${board.id}">
                  <div class="board-box-header">
                    <div class="board-box-title">${esc(board.title)}</div>
                    <div class="board-box-count">${bc.length} карти</div>
                  </div>
                  <div class="board-box-preview">
                    ${board.columns.filter(c => !c.is_done_column).map(col => {
                      const cc = bc.filter(c => c.column_id === col.id);
                      const h = Math.max(20, Math.min(100, cc.length * 18));
                      return `<div class="preview-col" title="${esc(col.title)} (${cc.length})"><div class="preview-bar" style="height:${h}%"></div><span class="preview-count">(${cc.length})</span><span class="preview-label">${esc(col.title)}</span></div>`;
                    }).join('')}
                  </div>
                </a>`;
            }).join('')}
          </div>
        </div>

        ${overdue.length > 0 ? `
        <div class="home-section">
          <h2 class="section-title">⚠️ Просрочени (${overdue.length})</h2>
          <div class="task-list">
            ${overdue.slice(0, 10).map(c => renderTaskRow(c)).join('')}
          </div>
        </div>
        ` : ''}

        ${today.length > 0 ? `
        <div class="home-section">
          <h2 class="section-title">📅 Днес (${today.length})</h2>
          <div class="task-list">
            ${today.map(c => renderTaskRow(c)).join('')}
          </div>
        </div>
        ` : ''}
      </div>
    `;
  } catch (err) {
    el.innerHTML = '<div class="empty-state">Грешка при зареждане</div>';
  }
}

function renderTaskRow(card) {
  const color = getCardColorClass(card);
  return `
    <a class="task-row ${color}" href="#/card/${card.id}">
      <span class="task-title">${esc(card.title)}</span>
      <span class="task-meta">
        ${card.client_name ? `<span class="task-client">${esc(card.client_name)}</span>` : ''}
        ${card.due_on ? `<span class="task-due">${formatDate(card.due_on)}</span>` : ''}
        ${card.board_title ? `<span class="task-board">${esc(card.board_title)}</span>` : ''}
      </span>
    </a>
  `;
}

// ==================== PRODUCTION (Board Grid) ====================

async function renderProduction(el) {
  setBreadcrumb([{ label: 'Продукция', href: '#/production' }]);

  try {
    const [boardsRes, cardsRes] = await Promise.all([
      fetch('/api/boards'), fetch('/api/cards')
    ]);
    const boards = await boardsRes.json();
    const cards = await cardsRes.json();
    allBoards = boards;

    el.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <h1>Продукция</h1>
          <p class="page-subtitle">Управление на борда и задачи</p>
        </div>
        ${canManage() ? '<button class="btn btn-primary" onclick="promptCreateBoard()">+ Нов борд</button>' : ''}
      </div>
      <div class="boards-grid">${boards.map(board => {
        const bc = cards.filter(c => c.board_id === board.id);
        const visibleCols = board.columns.filter(c => !c.is_done_column);
        const doneCol = board.columns.find(c => c.is_done_column);
        const doneCount = doneCol ? bc.filter(c => c.column_id === doneCol.id).length : 0;
        return `
          <a class="board-box" href="#/production/${board.id}">
            <div class="board-box-header">
              <div class="board-box-title">${esc(board.title)}</div>
              <div class="board-box-count">${bc.length} карти</div>
            </div>
            <div class="board-box-preview">
              ${visibleCols.map(col => {
                const cc = bc.filter(c => c.column_id === col.id);
                const h = Math.max(20, Math.min(100, cc.length * 18));
                return `<div class="preview-col" title="${esc(col.title)} (${cc.length})"><div class="preview-bar" style="height:${h}%"></div><span class="preview-count">(${cc.length})</span><span class="preview-label">${esc(col.title)}</span></div>`;
              }).join('')}
              ${doneCol ? `<div class="preview-col done" title="Done (${doneCount})"><div class="preview-bar" style="height:${Math.max(20, Math.min(100, doneCount * 10))}%"></div><span class="preview-count">(${doneCount})</span><span class="preview-label">DONE</span></div>` : ''}
            </div>
          </a>`;
      }).join('')}</div>
    `;
  } catch { el.innerHTML = '<div class="empty-state">Грешка</div>'; }
}

async function promptCreateBoard() {
  const title = prompt('Име на новия борд:');
  if (!title?.trim()) return;
  try {
    await fetch('/api/boards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }) });
    router();
  } catch {}
}

// ==================== BOARD DETAIL (Kanban) ====================

async function renderBoardDetail(el, boardId) {
  try {
    const [boardsRes, cardsRes] = await Promise.all([
      fetch('/api/boards'), fetch(`/api/cards?board_id=${boardId}`)
    ]);
    const boards = await boardsRes.json();
    const cards = await cardsRes.json();
    allBoards = boards;
    const board = boards.find(b => b.id === boardId);
    if (!board) { el.innerHTML = '<div class="empty-state">Борд не е намерен</div>'; return; }

    setBreadcrumb([
      { label: 'Продукция', href: '#/production' },
      { label: board.title, href: `#/production/${boardId}` }
    ]);

    const manage = canManage();

    el.innerHTML = `
      <div class="board-detail-header">
        <h1 style="font-size:20px;font-weight:700;color:#fff">${esc(board.title)}</h1>
        <span class="board-detail-count">${cards.length} карти</span>
        ${manage ? `
          <div class="board-detail-actions">
            <button class="btn btn-sm" onclick="promptAddColumn(${boardId})">+ Колона</button>
            <button class="btn btn-sm" onclick="promptRenameBoard(${boardId}, '${esc(board.title).replace(/'/g, "\\'")}')">✎ Преименувай</button>
          </div>
        ` : ''}
      </div>
      <div class="board-kanban">
        ${board.columns.filter(col => !col.is_done_column).map(col => {
          const colCards = cards.filter(c => c.column_id === col.id);
          return renderKanbanColumn(col, colCards, boardId, board.title, manage);
        }).join('')}
        ${(() => {
          const doneCol = board.columns.find(col => col.is_done_column);
          if (!doneCol) return '';
          const doneCards = cards.filter(c => c.column_id === doneCol.id);
          return `<div class="kanban-column done-column"><div class="column-header"><span>DONE</span><span class="col-count">${doneCards.length}</span></div><div class="column-cards" data-column-id="${doneCol.id}" data-board-id="${boardId}" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">${doneCards.map(c => renderBoardCard(c)).join('')}</div></div>`;
        })()}
      </div>
    `;
  } catch { el.innerHTML = '<div class="empty-state">Грешка</div>'; }
}

function renderKanbanColumn(col, colCards, boardId, boardTitle, manage) {
  return `
    <div class="kanban-column" data-col-id="${col.id}">
      <div class="column-header">
        <span class="column-title" ${manage ? `ondblclick="editColumnTitle(${boardId}, ${col.id}, this)"` : ''}>${esc(col.title)}</span>
        <div class="column-header-right">
          <span class="col-count">${colCards.length}</span>
          ${manage ? `<button class="col-menu-btn" onclick="showColMenu(event, ${boardId}, ${col.id})">⋮</button>` : ''}
        </div>
      </div>
      <div class="column-cards" data-column-id="${col.id}" data-board-id="${boardId}"
           ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
        ${colCards.map(c => renderBoardCard(c)).join('')}
      </div>
      ${manage ? `<a class="add-card-btn" href="#/card/new?board=${boardId}&column=${col.id}">+ Добави карта</a>` : ''}
    </div>`;
}

function renderBoardCard(card) {
  const colorClass = getCardColorClass(card);
  const dueStr = card.due_on ? formatDate(card.due_on) : '';
  const assigneeStr = card.assignees?.map(a => a.name?.split(' ')[0]).join(', ') || '';
  const stepsStr = card.steps_total > 0 ? `${card.steps_done}/${card.steps_total}` : '';

  return `
    <a class="board-card ${colorClass}" href="#/card/${card.id}" draggable="true" data-card-id="${card.id}"
       ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)"
       onmousedown="if(event.button===1){event.preventDefault();window.open('#/card/${card.id}','_blank')}">
      <div class="card-title">${esc(card.title)}</div>
      <div class="card-meta">
        ${dueStr ? `<span class="card-due">${dueStr}</span>` : ''}
        ${assigneeStr ? `<span class="card-assignee">${esc(assigneeStr)}</span>` : ''}
        ${stepsStr ? `<span class="card-steps">✓ ${stepsStr}</span>` : ''}
      </div>
    </a>`;
}

// ==================== CARD PAGE (Full Page) ====================

async function renderCardPage(el, cardId) {
  try {
    const res = await fetch(`/api/cards/${cardId}`);
    if (!res.ok) { el.innerHTML = '<div class="empty-state">Картата не е намерена</div>'; return; }
    const card = await res.json();

    // Load comments
    let comments = [];
    try { const cr = await fetch(`/api/cards/${cardId}/comments`); if (cr.ok) comments = await cr.json(); } catch {}

    const board = allBoards.find(b => b.id === card.board_id);
    const col = board?.columns?.find(c => c.id === card.column_id);

    setBreadcrumb([
      { label: 'Продукция', href: '#/production' },
      { label: board?.title || '—', href: `#/production/${card.board_id}` },
      { label: col?.title || '—', href: `#/production/${card.board_id}` },
      { label: card.title, href: `#/card/${cardId}` }
    ]);

    const assigneeNames = card.assignees?.map(a => esc(a.name)).join(', ') || 'Няма';
    const manage = canManage();

    el.innerHTML = `
      <div class="card-page">
        <div class="card-page-header">
          <h1 class="card-page-title" id="cardTitle">${esc(card.title)}</h1>
          ${manage ? `<button class="btn btn-ghost btn-sm" onclick="toggleCardEdit(${cardId})">✎ Редактирай</button>` : ''}
        </div>

        <div class="card-page-info">
          <div class="card-info-item">
            <label>Колона</label>
            <span class="badge">${esc(col?.title || '—')}</span>
          </div>
          <div class="card-info-item">
            <label>Назначени</label>
            <span>${assigneeNames}</span>
          </div>
          <div class="card-info-item">
            <label>Дедлайн</label>
            <span>${card.due_on ? formatDate(card.due_on) : '—'}</span>
          </div>
          ${card.priority !== 'normal' ? `<div class="card-info-item"><label>Приоритет</label><span class="badge badge-red">${card.priority === 'urgent' ? '⚡ Спешна' : '↑ Висок'}</span></div>` : ''}
          ${card.is_on_hold ? `<div class="card-info-item"><label>Статус</label><span class="badge">⏸ На пауза</span></div>` : ''}
          ${card.client_name ? `<div class="card-info-item"><label>Клиент</label><span>${esc(card.client_name)}</span></div>` : ''}
        </div>

        <!-- Edit form (hidden by default) -->
        <div id="cardEditForm" style="display:none" class="card-edit-form">
          <div class="edit-row"><label>Заглавие</label><input id="editTitle" value="${esc(card.title)}"></div>
          <div class="edit-row"><label>Дедлайн</label><input type="date" id="editDue" value="${card.due_on || ''}"></div>
          <div class="edit-row"><label>Публикуване</label><input type="date" id="editPub" value="${card.publish_date || ''}"></div>
          <div class="edit-row"><label>Приоритет</label><select id="editPriority"><option value="normal" ${card.priority === 'normal' ? 'selected' : ''}>Нормален</option><option value="high" ${card.priority === 'high' ? 'selected' : ''}>Висок</option><option value="urgent" ${card.priority === 'urgent' ? 'selected' : ''}>Спешен</option></select></div>
          <div class="edit-row"><label>Клиент</label><input id="editClient" value="${esc(card.client_name || '')}"></div>
          <div class="edit-row"><label>На пауза</label><label class="toggle-label"><input type="checkbox" id="editHold" ${card.is_on_hold ? 'checked' : ''}><span>Чакаме клиента</span></label></div>
          <div class="edit-row"><label>Назначени</label><select id="editAssignees" multiple>${allUsers.map(u => `<option value="${u.id}" ${card.assignees?.some(a => a.id === u.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
          <div class="edit-actions">
            <button class="btn btn-primary btn-sm" onclick="saveCardEdit(${cardId})">Запази</button>
            <button class="btn btn-sm" onclick="toggleCardEdit()">Откажи</button>
            ${manage ? `<button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="archiveCard(${cardId})">🗑 Архивирай</button>` : ''}
          </div>
        </div>

        <div class="card-page-content">
          <div class="section-subtitle">Описание</div>
          <div class="card-content-display" id="cardContent">${card.content ? esc(card.content).replace(/\n/g, '<br>') : '<span class="hint">Няма описание</span>'}</div>
          <textarea id="cardContentEdit" style="display:none" class="card-detail-content">${esc(card.content || '')}</textarea>
        </div>

        <!-- Steps -->
        <div class="card-page-section">
          <div class="section-subtitle">Стъпки (${card.steps?.filter(s => s.completed).length || 0}/${card.steps?.length || 0})</div>
          <div class="steps-list">
            ${(card.steps || []).map(s => `
              <div class="step-item ${s.completed ? 'completed' : ''}">
                <input type="checkbox" ${s.completed ? 'checked' : ''} onchange="toggleStep(${cardId}, ${s.id}, this.checked)">
                <span class="step-title">${esc(s.title)}</span>
                ${s.assignee_id ? `<span class="step-assignee">${esc(allUsers.find(u => u.id === s.assignee_id)?.name || '')}</span>` : ''}
                ${s.due_on ? `<span class="step-due">${formatDate(s.due_on)}</span>` : ''}
              </div>
            `).join('')}
          </div>
          <div class="add-step-row">
            <input class="add-step-input" id="newStepInput" placeholder="Нова стъпка..." onkeydown="if(event.key==='Enter')addStepFromPage(${cardId})">
            <select id="newStepAssignee" style="width:120px;font-size:12px"><option value="">Назначи...</option>${allUsers.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
            <input type="date" id="newStepDue" style="width:130px;font-size:12px">
            <button class="btn btn-sm" onclick="addStepFromPage(${cardId})">+</button>
          </div>
        </div>

        <!-- Comments -->
        <div class="card-page-section">
          <div class="section-subtitle">Коментари (${comments.length})</div>
          <div class="comments-list">
            ${comments.map(c => `
              <div class="comment-item">
                <div class="comment-avatar">${esc(c.user_name?.split(' ').map(n => n[0]).join('').substring(0, 2) || '?')}</div>
                <div class="comment-body">
                  <div class="comment-header"><strong>${esc(c.user_name)}</strong> <span class="hint">${new Date(c.created_at).toLocaleString('bg')}</span></div>
                  <div class="comment-text">${esc(c.content).replace(/\n/g, '<br>').replace(/@(\w+)/g, '<span class="mention">@$1</span>')}</div>
                </div>
              </div>
            `).join('')}
          </div>
          <div class="add-comment-row">
            <textarea id="newComment" class="add-note-input" placeholder="Напиши коментар... Използвай @име за споменаване" rows="3"></textarea>
            <button class="btn btn-primary btn-sm" onclick="addComment(${cardId})">Коментирай</button>
          </div>
        </div>
      </div>
    `;
  } catch { el.innerHTML = '<div class="empty-state">Грешка</div>'; }
}

function toggleCardEdit(cardId) {
  const form = document.getElementById('cardEditForm');
  const contentDisplay = document.getElementById('cardContent');
  const contentEdit = document.getElementById('cardContentEdit');
  if (form.style.display === 'none') {
    form.style.display = 'block';
    if (contentEdit) { contentEdit.style.display = 'block'; contentDisplay.style.display = 'none'; }
  } else {
    form.style.display = 'none';
    if (contentEdit) { contentEdit.style.display = 'none'; contentDisplay.style.display = 'block'; }
  }
}

async function saveCardEdit(cardId) {
  const data = {
    title: document.getElementById('editTitle').value.trim(),
    due_on: document.getElementById('editDue').value || null,
    publish_date: document.getElementById('editPub').value || null,
    priority: document.getElementById('editPriority').value,
    client_name: document.getElementById('editClient').value || null,
    is_on_hold: document.getElementById('editHold').checked,
    content: document.getElementById('cardContentEdit')?.value || null,
    assignee_ids: Array.from(document.getElementById('editAssignees').selectedOptions).map(o => parseInt(o.value))
  };
  try {
    await fetch(`/api/cards/${cardId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    router(); // reload page
  } catch {}
}

async function archiveCard(cardId) {
  if (!confirm('Сигурен ли си, че искаш да архивираш тази карта?')) return;
  try { await fetch(`/api/cards/${cardId}`, { method: 'DELETE' }); history.back(); } catch {}
}

async function toggleStep(cardId, stepId, completed) {
  try { await fetch(`/api/cards/${cardId}/steps/${stepId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed }) }); router(); } catch {}
}

async function addStepFromPage(cardId) {
  const input = document.getElementById('newStepInput');
  const title = input.value.trim();
  if (!title) return;
  const assignee_id = document.getElementById('newStepAssignee').value || null;
  const due_on = document.getElementById('newStepDue').value || null;
  try {
    await fetch(`/api/cards/${cardId}/steps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, assignee_id: assignee_id ? parseInt(assignee_id) : null, due_on }) });
    input.value = '';
    router();
  } catch {}
}

async function addComment(cardId) {
  const textarea = document.getElementById('newComment');
  const content = textarea.value.trim();
  if (!content) return;
  // Extract @mentions
  const mentionNames = [...content.matchAll(/@(\S+)/g)].map(m => m[1].toLowerCase());
  const mentionIds = allUsers.filter(u => mentionNames.some(n => u.name.toLowerCase().includes(n))).map(u => u.id);
  try {
    await fetch(`/api/cards/${cardId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, mentions: mentionIds }) });
    textarea.value = '';
    router();
  } catch {}
}

// ==================== CARD CREATE PAGE ====================

async function renderCardCreate(el, _) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const boardId = parseInt(params.get('board')) || null;
  const columnId = parseInt(params.get('column')) || null;

  const board = allBoards.find(b => b.id === boardId);
  const col = board?.columns?.find(c => c.id === columnId);

  setBreadcrumb([
    { label: 'Продукция', href: '#/production' },
    ...(board ? [{ label: board.title, href: `#/production/${boardId}` }] : []),
    { label: 'Нова карта', href: '#' }
  ]);

  el.innerHTML = `
    <div class="card-page">
      <div class="page-header"><h1>Нова карта</h1></div>
      <div class="card-create-form">
        <div class="edit-row"><label>Заглавие *</label><input id="createTitle" placeholder="Заглавие на задачата" autofocus></div>
        <div class="edit-row"><label>Борд</label><select id="createBoard" onchange="updateCreateColumns()">
          ${allBoards.map(b => `<option value="${b.id}" ${b.id === boardId ? 'selected' : ''}>${esc(b.title)}</option>`).join('')}
        </select></div>
        <div class="edit-row"><label>Колона</label><select id="createColumn">
          ${(board?.columns || allBoards[0]?.columns || []).filter(c => !c.is_done_column).map(c => `<option value="${c.id}" ${c.id === columnId ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}
        </select></div>
        <div class="edit-row"><label>Описание</label><textarea id="createContent" class="card-detail-content" rows="6" placeholder="Описание на задачата..."></textarea></div>
        <div class="edit-row"><label>Дедлайн</label><input type="date" id="createDue"></div>
        <div class="edit-row"><label>Дата на публикуване</label><input type="date" id="createPub"></div>
        <div class="edit-row"><label>Клиент</label><input id="createClient" placeholder="Име на клиент"></div>
        <div class="edit-row"><label>КП №</label><input type="number" id="createKP" placeholder="—"></div>
        <div class="edit-row"><label>Приоритет</label><select id="createPriority"><option value="normal">Нормален</option><option value="high">Висок</option><option value="urgent">Спешен</option></select></div>
        <div class="edit-row"><label>Назначени</label><select id="createAssignees" multiple style="min-height:80px">${allUsers.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>
        <div class="edit-actions">
          <button class="btn btn-primary" onclick="submitCreateCard()">Създай карта</button>
          <button class="btn" onclick="history.back()">Откажи</button>
        </div>
      </div>
    </div>
  `;
}

function updateCreateColumns() {
  const boardId = parseInt(document.getElementById('createBoard').value);
  const board = allBoards.find(b => b.id === boardId);
  const sel = document.getElementById('createColumn');
  sel.innerHTML = (board?.columns || []).filter(c => !c.is_done_column).map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('');
}

async function submitCreateCard() {
  const title = document.getElementById('createTitle').value.trim();
  if (!title) { alert('Заглавието е задължително'); return; }
  const data = {
    title,
    board_id: parseInt(document.getElementById('createBoard').value),
    column_id: parseInt(document.getElementById('createColumn').value),
    content: document.getElementById('createContent').value || null,
    due_on: document.getElementById('createDue').value || null,
    publish_date: document.getElementById('createPub').value || null,
    client_name: document.getElementById('createClient').value || null,
    kp_number: document.getElementById('createKP').value ? parseInt(document.getElementById('createKP').value) : null,
    priority: document.getElementById('createPriority').value,
    assignee_ids: Array.from(document.getElementById('createAssignees').selectedOptions).map(o => parseInt(o.value))
  };
  try {
    const res = await fetch('/api/cards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) {
      const card = await res.json();
      location.hash = `#/card/${card.id}`;
    }
  } catch {}
}

// ==================== ACTIVITY FEED ====================

async function renderActivity(el) {
  setBreadcrumb(null);
  try {
    const res = await fetch('/api/activity?limit=50');
    const items = await res.json();
    el.innerHTML = `
      <div class="page-header"><h1>📋 Activity</h1><p class="page-subtitle">Последна активност в платформата</p></div>
      <div class="activity-list">
        ${items.length === 0 ? '<div class="empty-state">Няма активност</div>' :
          items.map(a => `
            <div class="activity-item">
              <div class="activity-avatar">${esc(a.user_name?.split(' ').map(n => n[0]).join('').substring(0, 2) || '?')}</div>
              <div class="activity-body">
                <strong>${esc(a.user_name || 'Unknown')}</strong>
                ${a.action === 'created' ? 'създаде' : a.action === 'moved' ? 'премести' : a.action === 'commented' ? 'коментира' : a.action}
                ${a.target_type === 'card' ? `<a href="#/card/${a.target_id}">${esc(a.target_title || '')}</a>` : esc(a.target_title || '')}
                <span class="hint">${timeAgo(a.created_at)}</span>
              </div>
            </div>
          `).join('')}
      </div>
    `;
  } catch { el.innerHTML = '<div class="empty-state">Грешка</div>'; }
}

// ==================== MY STUFF ====================

async function renderMyStuff(el) {
  setBreadcrumb(null);
  try {
    const res = await fetch(`/api/cards?assignee_id=${currentUser.userId}`);
    const cards = await res.json();
    el.innerHTML = `
      <div class="page-header"><h1>📌 My Stuff</h1><p class="page-subtitle">Твоите назначени задачи</p></div>
      <div class="task-list">
        ${cards.length === 0 ? '<div class="empty-state">Нямаш назначени задачи</div>' :
          cards.map(c => renderTaskRow(c)).join('')}
      </div>
    `;
  } catch { el.innerHTML = '<div class="empty-state">Грешка</div>'; }
}

// ==================== FIND/SEARCH ====================

async function renderFind(el) {
  setBreadcrumb(null);
  el.innerHTML = `
    <div class="page-header"><h1>🔍 Търсене</h1></div>
    <div class="search-box">
      <input id="searchInput" placeholder="Търси задачи, клиенти, хора..." autofocus oninput="doSearch()">
    </div>
    <div id="searchResults"></div>
  `;
}

async function doSearch() {
  const q = document.getElementById('searchInput')?.value?.trim();
  const container = document.getElementById('searchResults');
  if (!q || q.length < 2) { container.innerHTML = ''; return; }
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const { cards, users } = await res.json();
    container.innerHTML = `
      ${cards.length > 0 ? `
        <div class="section-subtitle" style="margin-top:16px">Задачи (${cards.length})</div>
        <div class="task-list">${cards.map(c => `
          <a class="task-row" href="#/card/${c.id}">
            <span class="task-title">${esc(c.title)}</span>
            <span class="task-meta">
              ${c.client_name ? `<span class="task-client">${esc(c.client_name)}</span>` : ''}
              <span class="task-board">${esc(c.board_title)} › ${esc(c.column_title)}</span>
            </span>
          </a>
        `).join('')}</div>` : ''}
      ${users.length > 0 ? `
        <div class="section-subtitle" style="margin-top:16px">Хора (${users.length})</div>
        <div class="task-list">${users.map(u => `
          <div class="task-row"><span class="task-title">${esc(u.name)}</span><span class="task-meta"><span class="task-client">${esc(u.email)}</span><span class="badge">${u.role}</span></span></div>
        `).join('')}</div>` : ''}
      ${cards.length === 0 && users.length === 0 ? '<div class="empty-state">Няма резултати</div>' : ''}
    `;
  } catch {}
}

// ==================== NOTIFICATIONS ====================

async function renderNotifications(el) {
  setBreadcrumb(null);
  try {
    const res = await fetch('/api/notifications');
    const items = await res.json();
    // Mark all as read
    fetch('/api/notifications/read-all', { method: 'PUT' });
    updateNotifBadge();

    el.innerHTML = `
      <div class="page-header"><h1>🔔 Известия</h1></div>
      <div class="notif-list">
        ${items.length === 0 ? '<div class="empty-state">Няма известия</div>' :
          items.map(n => `
            <a class="notif-item ${n.is_read ? '' : 'unread'}" href="${n.reference_type === 'card' ? `#/card/${n.reference_id}` : '#'}">
              <div class="notif-title">${esc(n.title)}</div>
              <div class="notif-body">${esc(n.body || '')}</div>
              <div class="hint">${timeAgo(n.created_at)}</div>
            </a>
          `).join('')}
      </div>
    `;
  } catch { el.innerHTML = '<div class="empty-state">Грешка</div>'; }
}

// ==================== CHAT ====================

async function renderChatList(el) {
  setBreadcrumb(null);
  try {
    const res = await fetch('/api/chat/channels');
    const channels = await res.json();
    el.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
        <div><h1>💬 Чат</h1><p class="page-subtitle">Лични съобщения и групи</p></div>
        <button class="btn btn-primary btn-sm" onclick="createChatChannel()">+ Нов чат</button>
      </div>
      <div class="chat-channel-list">
        ${channels.length === 0 ? '<div class="empty-state">Няма чатове</div>' :
          channels.map(ch => {
            const memberNames = ch.members?.map(m => m.name?.split(' ')[0]).join(', ') || '';
            return `
              <a class="chat-channel-item" href="#/chat/${ch.id}">
                <div class="chat-channel-name">${esc(ch.name || memberNames)}</div>
                <div class="chat-channel-preview">${esc(ch.last_message?.substring(0, 60) || 'Няма съобщения')}</div>
                ${ch.last_message_at ? `<div class="hint">${timeAgo(ch.last_message_at)}</div>` : ''}
              </a>`;
          }).join('')}
      </div>
    `;
  } catch { el.innerHTML = '<div class="empty-state">Грешка</div>'; }
}

async function renderChatChannel(el, channelId) {
  setBreadcrumb([{ label: 'Чат', href: '#/chat' }, { label: 'Канал', href: `#/chat/${channelId}` }]);
  try {
    const [msgsRes, chRes] = await Promise.all([
      fetch(`/api/chat/channels/${channelId}/messages`),
      fetch('/api/chat/channels')
    ]);
    const messages = await msgsRes.json();
    const channels = await chRes.json();
    const channel = channels.find(c => c.id === channelId);
    const memberNames = channel?.members?.map(m => m.name).join(', ') || '';

    el.innerHTML = `
      <div class="chat-page">
        <div class="chat-header">
          <a href="#/chat" class="btn btn-ghost btn-sm">← Назад</a>
          <h2>${esc(channel?.name || memberNames)}</h2>
        </div>
        <div class="chat-messages" id="chatMessages">
          ${messages.map(m => `
            <div class="chat-msg ${m.user_id === currentUser.userId ? 'mine' : ''}">
              <div class="chat-msg-avatar">${esc(m.user_name?.split(' ').map(n => n[0]).join('').substring(0, 2) || '?')}</div>
              <div class="chat-msg-body">
                <div class="chat-msg-name">${esc(m.user_name)} <span class="hint">${new Date(m.created_at).toLocaleTimeString('bg', { hour: '2-digit', minute: '2-digit' })}</span></div>
                <div class="chat-msg-text">${esc(m.content).replace(/\n/g, '<br>')}</div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="chat-input-row">
          <textarea id="chatInput" placeholder="Напиши съобщение..." rows="2" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMsg(${channelId})}"></textarea>
          <button class="btn btn-primary" onclick="sendChatMsg(${channelId})">Изпрати</button>
        </div>
      </div>
    `;
    // Scroll to bottom
    const msgs = document.getElementById('chatMessages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  } catch { el.innerHTML = '<div class="empty-state">Грешка</div>'; }
}

async function sendChatMsg(channelId) {
  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  if (!content) return;
  try {
    await fetch(`/api/chat/channels/${channelId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
    input.value = '';
    router();
  } catch {}
}

async function createChatChannel() {
  const name = prompt('Име на групата (или остави празно за DM):');
  const memberSelect = prompt('ID-та на членове (разделени с запетая):');
  if (!memberSelect) return;
  const member_ids = memberSelect.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
  try {
    const res = await fetch('/api/chat/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type: name ? 'group' : 'dm', member_ids }) });
    if (res.ok) { const ch = await res.json(); location.hash = `#/chat/${ch.id}`; }
  } catch {}
}

// ==================== MESSAGE BOARD ====================

async function renderMessageBoard(el) {
  setBreadcrumb(null);
  try {
    const res = await fetch('/api/messageboard');
    const messages = await res.json();
    el.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
        <div><h1>📢 Съобщения</h1><p class="page-subtitle">Обяви и дневни отчети</p></div>
        <div style="display:flex;gap:8px">
          ${canManage() ? '<button class="btn btn-sm" onclick="generateDailyReport()">📊 Дневен отчет</button>' : ''}
          <button class="btn btn-primary btn-sm" onclick="createMessage()">+ Ново съобщение</button>
        </div>
      </div>
      <div class="message-list">
        ${messages.length === 0 ? '<div class="empty-state">Няма съобщения</div>' :
          messages.map(m => `
            <div class="message-item ${m.pinned ? 'pinned' : ''}">
              <div class="message-header">
                <strong>${esc(m.user_name || 'System')}</strong>
                <span class="badge">${esc(m.category)}</span>
                ${m.pinned ? '<span class="badge badge-accent">📌 Закачено</span>' : ''}
                <span class="hint">${timeAgo(m.created_at)}</span>
              </div>
              <h3>${esc(m.title)}</h3>
              <div class="message-content">${esc(m.content || '').replace(/\n/g, '<br>')}</div>
            </div>
          `).join('')}
      </div>
    `;
  } catch { el.innerHTML = '<div class="empty-state">Грешка</div>'; }
}

async function createMessage() {
  const title = prompt('Заглавие:');
  if (!title?.trim()) return;
  const content = prompt('Съдържание:');
  try {
    await fetch('/api/messageboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, content }) });
    router();
  } catch {}
}

async function generateDailyReport() {
  try {
    await fetch('/api/messageboard/daily-report', { method: 'POST' });
    router();
  } catch {}
}

// ==================== VAULT ====================

async function renderVault(el, folderId) {
  setBreadcrumb([{ label: 'Файлове', href: '#/vault' }]);
  try {
    const url = folderId ? `/api/vault/folders?parent_id=${folderId}` : '/api/vault/folders';
    const res = await fetch(url);
    const { folders, files } = await res.json();
    el.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
        <div><h1>📁 Файлове</h1></div>
        <div style="display:flex;gap:8px">
          ${canManage() ? `<button class="btn btn-sm" onclick="createVaultFolder(${folderId || 'null'})">+ Папка</button>` : ''}
          <label class="btn btn-primary btn-sm" style="cursor:pointer">
            📎 Качи файл
            <input type="file" style="display:none" onchange="uploadVaultFile(this, ${folderId || 'null'})">
          </label>
        </div>
      </div>
      ${folderId ? '<a href="#/vault" class="btn btn-ghost btn-sm" style="margin-bottom:16px;display:inline-flex">← Назад</a>' : ''}
      <div class="vault-grid">
        ${folders.map(f => `
          <a class="vault-item folder" href="#/vault/${f.id}">
            <span class="vault-icon">📁</span>
            <span class="vault-name">${esc(f.name)}</span>
          </a>
        `).join('')}
        ${files.map(f => `
          <div class="vault-item file">
            <a href="${f.storage_path}" target="_blank" class="vault-icon">${getFileIcon(f.mime_type)}</a>
            <span class="vault-name">${esc(f.original_name)}</span>
            <span class="hint">${formatFileSize(f.size_bytes)}</span>
          </div>
        `).join('')}
        ${folders.length === 0 && files.length === 0 ? '<div class="empty-state">Празна папка</div>' : ''}
      </div>
    `;
  } catch { el.innerHTML = '<div class="empty-state">Грешка</div>'; }
}

async function createVaultFolder(parentId) {
  const name = prompt('Име на папката:');
  if (!name?.trim()) return;
  try {
    await fetch('/api/vault/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parent_id: parentId }) });
    router();
  } catch {}
}

async function uploadVaultFile(input, folderId) {
  if (!input.files[0]) return;
  const form = new FormData();
  form.append('file', input.files[0]);
  if (folderId) form.append('folder_id', folderId);
  try {
    await fetch('/api/vault/upload', { method: 'POST', body: form });
    router();
  } catch {}
}

function getFileIcon(mime) {
  if (mime?.startsWith('image/')) return '🖼️';
  if (mime?.startsWith('video/')) return '🎬';
  if (mime?.includes('pdf')) return '📄';
  if (mime?.includes('spreadsheet') || mime?.includes('excel')) return '📊';
  if (mime?.includes('document') || mime?.includes('word')) return '📝';
  return '📎';
}
function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ==================== COLUMN/BOARD MANAGEMENT ====================

async function promptAddColumn(boardId) {
  const title = prompt('Име на новата колона:');
  if (!title?.trim()) return;
  try { await fetch(`/api/boards/${boardId}/columns`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }) }); router(); } catch {}
}

function editColumnTitle(boardId, colId, el) {
  const current = el.textContent;
  el.contentEditable = true; el.focus();
  const save = async () => {
    el.contentEditable = false;
    const t = el.textContent.trim();
    if (t && t !== current) { try { await fetch(`/api/boards/${boardId}/columns/${colId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) }); } catch {} }
    else el.textContent = current;
  };
  el.onblur = save;
  el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } if (e.key === 'Escape') { el.textContent = current; el.blur(); } };
}

function showColMenu(e, boardId, colId) {
  e.stopPropagation(); e.preventDefault();
  document.querySelectorAll('.col-context-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'col-context-menu';
  menu.innerHTML = `<button onclick="promptRenameColumn(${boardId}, ${colId}); this.parentElement.remove()">✎ Преименувай</button><button onclick="deleteColumn(${boardId}, ${colId}); this.parentElement.remove()">🗑 Изтрий</button>`;
  e.target.closest('.column-header-right').appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}

async function promptRenameColumn(boardId, colId) {
  const title = prompt('Ново име:');
  if (!title?.trim()) return;
  try { await fetch(`/api/boards/${boardId}/columns/${colId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }) }); router(); } catch {}
}

async function deleteColumn(boardId, colId) {
  if (!confirm('Сигурен ли си? Всички карти ще бъдат изтрити!')) return;
  try { await fetch(`/api/boards/${boardId}/columns/${colId}`, { method: 'DELETE' }); router(); } catch {}
}

async function promptRenameBoard(boardId, currentTitle) {
  const title = prompt('Ново име:', currentTitle);
  if (!title?.trim() || title.trim() === currentTitle) return;
  try { await fetch(`/api/boards/${boardId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }) }); router(); } catch {}
}

// ==================== DRAG & DROP ====================

let dragCardId = null;
function handleDragStart(e) { dragCardId = e.target.dataset.cardId; e.target.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
function handleDragEnd(e) { e.target.classList.remove('dragging'); dragCardId = null; }
function handleDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
async function handleDrop(e) {
  e.preventDefault(); e.currentTarget.classList.remove('drag-over');
  if (!dragCardId) return;
  const columnId = parseInt(e.currentTarget.dataset.columnId);
  const boardId = parseInt(e.currentTarget.dataset.boardId);
  try { const res = await fetch(`/api/cards/${dragCardId}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ column_id: columnId, board_id: boardId }) }); if (res.ok) router(); } catch {}
}

// ==================== PROFILE ====================

async function openProfile() {
  const modal = document.getElementById('profileModal'); modal.style.display = 'flex';
  try {
    const res = await fetch('/api/profile'); const user = await res.json();
    const initials = user.name.split(' ').map(n => n[0]).join('').substring(0, 2);
    const av = document.getElementById('profileAvatar');
    if (user.avatar_url) av.innerHTML = `<img src="${user.avatar_url}" style="width:100%;height:100%;object-fit:cover">`;
    else av.textContent = initials;
    document.getElementById('profileName').textContent = user.name;
    document.getElementById('profileEmail').textContent = user.email;
    document.getElementById('profileRole').innerHTML = user.role === 'admin' ? '<span class="badge badge-accent">ADMIN</span>' : user.role === 'moderator' ? '<span class="badge badge-blue">MODERATOR</span>' : '<span class="badge">MEMBER</span>';
    document.getElementById('profileNameInput').value = user.name;
  } catch {}
}
function closeProfile() { document.getElementById('profileModal').style.display = 'none'; }
async function saveProfileName() {
  const name = document.getElementById('profileNameInput').value.trim(); if (!name) return;
  try { const res = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); if (res.ok) { const u = await res.json(); document.getElementById('profileName').textContent = u.name; document.getElementById('topNavAvatar').textContent = u.name.split(' ').map(n => n[0]).join('').substring(0, 2); } } catch {}
}
async function uploadAvatar(input) {
  if (!input.files[0]) return; const form = new FormData(); form.append('avatar', input.files[0]);
  try { const res = await fetch('/api/profile/avatar', { method: 'POST', body: form }); if (res.ok) { const u = await res.json(); document.getElementById('profileAvatar').innerHTML = `<img src="${u.avatar_url}" style="width:100%;height:100%;object-fit:cover">`; } } catch {}
}
async function changePassword() {
  const msg = document.getElementById('pwdMsg'); const curr = document.getElementById('currentPwd').value; const newP = document.getElementById('newPwd').value;
  if (!curr || !newP) { msg.textContent = 'Попълни и двете полета'; msg.style.color = 'var(--red)'; return; }
  try { const res = await fetch('/api/profile/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: curr, newPassword: newP }) }); const d = await res.json(); if (res.ok) { msg.textContent = 'Сменена'; msg.style.color = 'var(--green)'; } else { msg.textContent = d.error; msg.style.color = 'var(--red)'; } } catch { msg.textContent = 'Грешка'; msg.style.color = 'var(--red)'; }
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeProfile(); });
document.getElementById('profileModal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeProfile(); });

// ==================== WEBSOCKET ====================

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { wsReconnectDelay = 1000; document.getElementById('wsStatusDot').className = 'status-dot online'; document.getElementById('wsStatus').textContent = 'на живо'; };
  ws.onmessage = (e) => { try { handleWSEvent(JSON.parse(e.data)); } catch {} };
  ws.onclose = () => { document.getElementById('wsStatusDot').className = 'status-dot offline'; document.getElementById('wsStatus').textContent = ''; setTimeout(connectWS, wsReconnectDelay); wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000); };
  ws.onerror = () => ws.close();
}
function handleWSEvent(event) {
  const t = event.type || '';
  if (t.startsWith('card:') || t.startsWith('board:') || t.startsWith('column:') || t.startsWith('step:') || t.startsWith('comment:')) router();
  if (t === 'chat:message') { if (location.hash.startsWith(`#/chat/${event.channelId}`)) router(); }
  updateNotifBadge();
}

// ==================== UTILS ====================

function esc(str) { if (!str) return ''; return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function formatDate(d) { if (!d) return ''; const s = d.split('T')[0]; const [y, m, dd] = s.split('-'); return `${dd}.${m}.${y}`; }
function getCardColorClass(card) {
  if (card.is_on_hold) return 'on-hold'; if (card.priority === 'urgent') return 'priority';
  if (!card.due_on) return ''; const now = new Date(); now.setHours(0,0,0,0); const due = new Date(card.due_on + 'T00:00:00'); const diff = Math.ceil((due - now) / 86400000);
  if (diff < 0) return 'overdue'; if (diff === 0) return 'deadline-today'; if (diff <= 4) return 'deadline-soon'; return 'deadline-ok';
}
function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return 'току-що'; if (s < 3600) return Math.floor(s / 60) + ' мин'; if (s < 86400) return Math.floor(s / 3600) + ' ч';
  return Math.floor(s / 86400) + ' дни';
}

// ==================== INIT ====================

(async function init() {
  const ok = await checkAuth();
  if (!ok) return;
  if (!location.hash || location.hash === '#' || location.hash === '#/') location.hash = '#/home';
  router();
  connectWS();
})();
