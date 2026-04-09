// ==================== KANBAN BOARD + KANBAN CARD + COL/BOARD MENUS + DRAG&DROP ====================
async function renderBoard(el, boardId) {
  el.className = 'full-width page-board';
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
    const nowB = new Date(); nowB.setHours(0,0,0,0);
    const boardOverdueCount = cards.filter(c => isCardOverdue(c, nowB)).length;

    el.innerHTML = `
      <h1 class="board-title">${esc(board.title)}</h1>
      <div class="board-toolbar">
        <input id="boardFilterInput" type="search" placeholder="Филтрирай карти..." oninput="filterBoardCards(this.value)">
        ${boardOverdueCount > 0 ? `<button class="btn btn-sm btn-ghost" id="overdueFilterBtn" onclick="toggleOverdueFilter(this)" title="\u041f\u043e\u043a\u0430\u0436\u0438 \u0441\u0430\u043c\u043e \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u0438">\u26a0 ${boardOverdueCount}</button>` : ''}
        ${edit ? `<a class="btn btn-sm" href="#/card/0/new?board=${boardId}">+ Нова карта</a>` : ''}
        ${manage ? `<button class="btn btn-sm btn-ghost" onclick="showAddColumnModal(${boardId})">+ Колона</button>` : ''}
        ${manage ? `<button class="btn btn-sm btn-ghost" onclick="toggleBoardMenu(event, ${boardId})">⋯</button>` : ''}
      </div>

      <div class="board-kanban">
        ${visibleCols.map((col, i) => {
          const colColor = COLUMN_COLORS[i % COLUMN_COLORS.length];
          const _dlSort = (a, b) => { var da=getCardDeadlineDate(a),db=getCardDeadlineDate(b); if(!da&&!db)return 0; if(!da)return 1; if(!db)return -1; return da<db?-1:da>db?1:0; };
          const colCards = cards.filter(c => c.column_id === col.id && !c.is_on_hold).sort(_dlSort);
          const holdCards = cards.filter(c => c.column_id === col.id && c.is_on_hold).sort(_dlSort);
          return `
            <div class="kanban-column" data-col-id="${col.id}" style="--col-color:${colColor}"
                 ${manage ? `draggable="true" ondragstart="handleColDragStart(event)" ondragend="handleColDragEnd(event)" ondragover="handleColDragOver(event)" ondrop="handleColDrop(event,${boardId})"` : ''}>
              <div class="kanban-column__inner">
                <div class="column-header">
                  <div class="column-title-wrap">
                    ${manage ? `<span class="col-drag-handle" title="Премести колона">⠿</span>` : ''}
                    <h2 class="column-title-link">
                      <a href="#/column/${col.id}" title="Отвори само тази колона">${esc(col.title)}</a>
                      <span class="col-count">${colCards.length + holdCards.length}</span>
                    </h2>
                  </div>
                  <div class="column-header-right">
                    ${manage ? `<button class="col-menu-btn" onclick="showColMenu(event, ${boardId}, ${col.id})" title="Опции на колоната">⋯</button>` : ''}
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
      countEl.textContent = visible;
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
  const dlClass = getDeadlineClass(card);
  const dlDate = getCardDeadlineDate(card);
  const dlDateStr = dlDate ? formatDate(dlDate) : '';
  const nowDay = new Date(); nowDay.setHours(0,0,0,0);
  const dueDate = _parseDateMidnight(card.due_on);
  const isDueOverdue = dueDate && dueDate < nowDay;
  const isDueToday = dueDate && dueDate >= nowDay && dueDate < new Date(nowDay.getTime() + 86400000);
  const dueClass = isDueOverdue ? ' kanban-card__due--overdue' : isDueToday ? ' kanban-card__due--today' : '';
  const dueStr = card.due_on ? formatDate(card.due_on) : '';
  const publishStr = card.publish_date ? formatDate(card.publish_date) : '';
  const stepsStr = card.steps_total > 0 ? `${card.steps_done}/${card.steps_total}` : '';
  const assignees = card.assignees || [];
  const shown = assignees.slice(0, 4);
  const extra = assignees.length - shown.length;
  const avatarsHtml = assignees.length
    ? shown.map(a => `<div class="kanban-card__av" style="background:${a.avatar_url ? 'none' : _avColor(a.name)}" title="${esc(a.name)}">${_avInner(a.name, a.avatar_url)}</div>`).join('')
      + (extra > 0 ? `<div class="kanban-card__av kanban-card__av--more">+${extra}</div>` : '')
    : '';

  const holdLabel = card.is_on_hold ? `<span class="kanban-card__hold-badge">⏸ На изчакване</span>` : '';
  const priorityBadge = card.priority === 'urgent' ? '<span class="kanban-card__priority-badge kanban-card__priority-badge--urgent">\ud83d\udd34 \u0421\u043f\u0435\u0448\u043d\u043e</span>' : card.priority === 'high' ? '<span class="kanban-card__priority-badge kanban-card__priority-badge--high">\u2191 \u0412\u0438\u0441\u043e\u043a</span>' : '';
  return `
    <div class="kanban-card-wrap">
      <a class="kanban-card ${color} ${dlClass}" href="#/card/${card.id}" draggable="true" data-card-id="${card.id}"
         ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)"
         onauxclick="if(event.button===1){event.preventDefault();window.open('#/card/${card.id}','_blank')}">
        <div class="kanban-card__content">
          ${holdLabel}${priorityBadge}
          <h3 class="kanban-card__title">${esc(card.title)}</h3>
          <div class="kanban-card__footer">
            <div class="kanban-card__avatars">${avatarsHtml}</div>
            <div class="kanban-card__badges">
              ${stepsStr ? `<span class="kanban-card__steps">✓ ${stepsStr}</span>` : ''}
              ${dlDateStr ? `<span class="kanban-card__dl-badge ${dlClass}">${dlDateStr}</span>` : publishStr ? `<span class="kanban-card__publish">📅 ${publishStr}</span>` : dueStr ? `<span class="kanban-card__due${dueClass}">${isDueOverdue ? '⚠ ' : isDueToday ? '⏰ ' : ''}${dueStr}</span>` : ''}
              ${card.comment_count ? `<span class="kanban-card__comments">💬 ${card.comment_count}</span>` : ''}
            </div>
          </div>
        </div>
      </a>
      <button class="kanban-card__menu-btn" onclick="event.preventDefault();event.stopPropagation();showKanbanCardMenu(event,${card.id},${card.is_on_hold?'true':'false'})" title="Опции">⋮</button>
    </div>`;
}

// ==================== CARD PAGE ====================
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
async function submitAddColumn() { const t=document.getElementById('addColumnInput').value.trim(); if(!t)return; closeAddColumnModal(); try{await fetch(`/api/boards/${_addColumnBoardId}/columns`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t})}); allBoards=await(await fetch('/api/boards')).json(); showToast('\u041a\u043e\u043b\u043e\u043d\u0430\u0442\u0430 \u0435 \u0434\u043e\u0431\u0430\u0432\u0435\u043d\u0430', 'success'); router();}catch{ showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0434\u043e\u0431\u0430\u0432\u044f\u043d\u0435 \u043d\u0430 \u043a\u043e\u043b\u043e\u043d\u0430', 'error'); } }
async function promptAddColumn(bid) { showAddColumnModal(bid); }
function editColumnTitle(bid,cid,el) { const cur=el.textContent; el.contentEditable=true; el.focus(); const save=async()=>{ el.contentEditable=false; const t=el.textContent.trim(); if(t&&t!==cur){ try{await fetch(`/api/boards/${bid}/columns/${cid}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t})})}catch{} } else el.textContent=cur; }; el.onblur=save; el.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();el.blur()}if(e.key==='Escape'){el.textContent=cur;el.blur()}}; }
function showColMenu(e,bid,cid) {
  e.stopPropagation();
  document.querySelectorAll('.col-context-menu').forEach(m=>m.remove());
  const menu=document.createElement('div');
  menu.className='col-context-menu';
  const board = allBoards.find(b=>b.id===bid);
  const col = board && board.columns ? board.columns.find(c=>c.id===cid) : null;
  menu.innerHTML = '<button onclick="promptRenameColumn(' + bid + ',' + cid + ');this.parentElement.remove()">\u270e Преименувай</button>' +
    '<button style="color:var(--red)" onclick="deleteColumn(' + bid + ',' + cid + ');this.parentElement.remove()">\ud83d\uddd1 Изтрий</button>';
  e.target.closest('.column-header-right').appendChild(menu);
  setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),10);
}

function promptRenameColumn(bid,cid) { showPromptModal('\u041f\u0440\u0435\u0438\u043c\u0435\u043d\u0443\u0432\u0430\u0439 \u043a\u043e\u043b\u043e\u043d\u0430', '\u041d\u043e\u0432\u043e \u0438\u043c\u0435\u2026', '', async function(t) { try{await fetch(`/api/boards/${bid}/columns/${cid}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t})}); allBoards=await(await fetch('/api/boards')).json(); router();}catch{} }); }
function deleteColumn(bid,cid) { showConfirmModal('\u0418\u0437\u0442\u0440\u0438\u0439 \u043a\u043e\u043b\u043e\u043d\u0430 \u0438 \u0432\u0441\u0438\u0447\u043a\u0438 \u043a\u0430\u0440\u0442\u0438 \u0432 \u043d\u0435\u044f?', async function() { try{const r=await fetch(`/api/boards/${bid}/columns/${cid}`,{method:'DELETE'}); if(!r.ok){const d=await r.json();showToast(d.error||'\u0413\u0440\u0435\u0448\u043a\u0430','error');return;} allBoards=await(await fetch('/api/boards')).json(); router();}catch{showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0438\u0437\u0442\u0440\u0438\u0432\u0430\u043d\u0435','error');} }, true); }
function toggleBoardMenu(e, bid) {
  e.stopPropagation();
  document.querySelectorAll('.board-context-menu').forEach(m => m.remove());
  const isAdmin = currentUser && currentUser.role === 'admin';
  const menu = document.createElement('div');
  menu.className = 'col-context-menu board-context-menu';
  menu.style.cssText = 'right:0;left:auto;min-width:190px;top:100%';
  let html = '';
  html += '<button onclick="promptRenameBoard(' + bid + ');document.querySelectorAll(\'.board-context-menu\').forEach(m=>m.remove())">\u270f\ufe0f \u041f\u0440\u0435\u0438\u043c\u0435\u043d\u0443\u0432\u0430\u0439 \u0431\u043e\u0440\u0434</button>';
  html += '<button onclick="archiveBoardConfirm(' + bid + ');document.querySelectorAll(\'.board-context-menu\').forEach(m=>m.remove())">\ud83d\udce6 \u0410\u0440\u0445\u0438\u0432\u0438\u0440\u0430\u0439</button>';
  if (isAdmin) html += '<div style="border-top:1px solid var(--border);margin:4px 0"></div><button style="color:var(--red)" onclick="deleteBoardConfirm(' + bid + ');document.querySelectorAll(\'.board-context-menu\').forEach(m=>m.remove())">\ud83d\uddd1 \u0418\u0437\u0442\u0440\u0438\u0439 \u0431\u043e\u0440\u0434</button>';
  menu.innerHTML = html;
  // Prefer the board header container; fall back to a positioned wrapper around the button.
  // The fallback keeps the menu working on the docs page (renderDocs) and any future page
  // that hosts the ⋯ button without the kanban-specific .board-page-header__actions wrapper.
  let anchor = e.target.closest('.board-toolbar') || e.target.closest('.board-page-header__actions');
  if (!anchor) {
    const btn = e.target.closest('button');
    if (btn) {
      // Wrap the button in a relative positioning context so the menu's absolute positioning works
      if (getComputedStyle(btn.parentElement).position === 'static') {
        btn.parentElement.style.position = 'relative';
      }
      anchor = btn.parentElement;
    }
  }
  if (anchor) anchor.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
}
function archiveBoardConfirm(bid) {
  const board = allBoards.find(b => b.id === bid);
  showConfirmModal('\u0410\u0440\u0445\u0438\u0432\u0438\u0440\u0430\u0439 \u0431\u043e\u0440\u0434 "' + (board ? esc(board.title) : '') + '"?\n\u0411\u043e\u0440\u0434\u044a\u0442 \u0449\u0435 \u0431\u044a\u0434\u0435 \u0441\u043a\u0440\u0438\u0442 \u043e\u0442 Dashboard \u0438 Home.', async function() {
    try {
      const r = await fetch('/api/boards/' + bid + '/archive', { method: 'PUT' });
      if (!r.ok) { const d = await r.json(); showToast(d.error || '\u0413\u0440\u0435\u0448\u043a\u0430', 'error'); return; }
      allBoards = await (await fetch('/api/boards')).json();
      showToast('\u0411\u043e\u0440\u0434\u044a\u0442 \u0435 \u0430\u0440\u0445\u0438\u0432\u0438\u0440\u0430\u043d', 'success');
      location.hash = '#/home';
      router();
    } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0430\u0440\u0445\u0438\u0432\u0438\u0440\u0430\u043d\u0435', 'error'); }
  });
}
function promptRenameBoard(bid) {
  const board = allBoards.find(b => b.id === bid);
  showPromptModal('\u041f\u0440\u0435\u0438\u043c\u0435\u043d\u0443\u0432\u0430\u0439 \u0431\u043e\u0440\u0434', '\u041d\u043e\u0432\u043e \u0438\u043c\u0435\u2026', board ? board.title : '', async function(t) {
    try { await fetch('/api/boards/' + bid, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t})}); allBoards = await (await fetch('/api/boards')).json(); router(); } catch {}
  });
}
function deleteBoardConfirm(bid) {
  const board = allBoards.find(b => b.id === bid);
  const isDocs = board && board.type === 'docs';
  const warning = isDocs
    ? 'Всички документи, файлове и папки в него ще бъдат изтрити за постоянно!'
    : 'Всички карти и колони ще бъдат изтрити!';
  showConfirmModal('Изтрий борд "' + (board ? board.title : '') + '"?\n' + warning, async function() {
    try {
      const r = await fetch('/api/boards/' + bid, { method: 'DELETE' });
      if (!r.ok) { const d = await r.json(); showToast(d.error || 'Грешка', 'error'); return; }
      allBoards = await (await fetch('/api/boards')).json();
      showToast('Бордът е изтрит', 'success');
      location.hash = '#/home';
      router();
    } catch { showToast('Грешка при изтриване', 'error'); }
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
function _dashSortZoneByDeadline(zone) {
  var holdSep = zone.querySelector('.dash-on-hold-sep');
  var regularEls = Array.from(zone.querySelectorAll('.dash-card:not(.dash-card--hold)'));
  if (regularEls.length < 2) return;
  regularEls.sort(function(a, b) {
    var ca = _dashCards.find(function(c) { return c.id == a.dataset.cardId; });
    var cb = _dashCards.find(function(c) { return c.id == b.dataset.cardId; });
    var da = ca ? getCardDeadlineDate(ca) : null;
    var db = cb ? getCardDeadlineDate(cb) : null;
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? -1 : da > db ? 1 : 0;
  });
  regularEls.forEach(function(el) {
    if (holdSep) zone.insertBefore(el, holdSep);
    else zone.appendChild(el);
  });
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

    // Re-sort all regular cards in target zone by deadline (earliest first)
    _dashSortZoneByDeadline(targetZone);
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
  } catch(err) {
    console.error('Dashboard drop error:', err);
  }
  // Full refresh: re-fetch data, re-sync timers, re-render (card colors, timer bars, stats)
  await _dashRefresh();
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
