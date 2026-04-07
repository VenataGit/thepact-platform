// ==================== CARD FIELDS (assignees, dates, steps, comments menu, attachments, create, toolbar, mentions) ====================
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
function toggleCommentMenu(e, cardId, commentId, isOwn, isPinned) {
  e.stopPropagation();
  document.querySelectorAll('.bc-comment-ctx-menu').forEach(function(m) { m.remove(); });
  var menu = document.createElement('div');
  menu.className = 'bc-comment-ctx-menu';
  function addItem(label, fn, danger) {
    var btn = document.createElement('button');
    btn.className = 'bc-comment-ctx-item' + (danger ? ' bc-comment-ctx-item--danger' : '');
    btn.textContent = label;
    btn.onclick = function(ev) { ev.stopPropagation(); menu.remove(); fn(); };
    menu.appendChild(btn);
  }
  addItem('↩ Отговори', function() { var nm = ''; var cd = document.querySelector('[data-comment-id="' + commentId + '"]'); if (cd) { var st = cd.querySelector('.bc-comment-meta strong'); if (st) nm = st.textContent; } replyToComment(cardId, commentId, nm); });
  addItem('📌 ' + (isPinned ? 'Откачи' : 'Закачи'), function() { pinComment(cardId, commentId); });
  if (isOwn) {
    var sep = document.createElement('div'); sep.className = 'bc-comment-ctx-sep'; menu.appendChild(sep);
    addItem('Редактирай', function() { editComment(cardId, commentId, null); });
    addItem('Изтрий', function() { deleteComment(cardId, commentId); }, true);
  }
  document.body.appendChild(menu);
  var rect = e.currentTarget.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.left = Math.max(8, rect.right - 180) + 'px';
  menu.style.zIndex = '9999';
  setTimeout(function() { document.addEventListener('click', function cl() { menu.remove(); document.removeEventListener('click', cl); }); }, 0);
}

function editComment(cardId, commentId, btn) {
  var commentDiv = (btn && btn.closest) ? btn.closest('.bc-comment') : document.querySelector('[data-comment-id="' + commentId + '"]');
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
  try { await fetch(`/api/cards/${cardId}/attachments`, {method:'POST',body:f}); showToast('\u0424\u0430\u0439\u043b\u044a\u0442 \u0435 \u043a\u0430\u0447\u0435\u043d', 'success'); loadCardAttachments(cardId); } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u043a\u0430\u0447\u0432\u0430\u043d\u0435 \u043d\u0430 \u0444\u0430\u0439\u043b', 'error'); }
}
function deleteAttachment(cardId, attachId) {
  showConfirmModal('\u0418\u0437\u0442\u0440\u0438\u0439 \u0444\u0430\u0439\u043b\u0430?', async function() {
    try { await fetch(`/api/cards/${cardId}/attachments/${attachId}`, {method:'DELETE'}); showToast('\u0424\u0430\u0439\u043b\u044a\u0442 \u0435 \u0438\u0437\u0442\u0440\u0438\u0442', 'success'); loadCardAttachments(cardId); } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0438\u0437\u0442\u0440\u0438\u0432\u0430\u043d\u0435', 'error'); }
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
    showToast('\u041a\u0430\u0440\u0442\u0430\u0442\u0430 \u0435 \u0441\u044a\u0437\u0434\u0430\u0434\u0435\u043d\u0430', 'success');
    location.hash = `#/card/${card.id}`;
  } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0441\u044a\u0437\u0434\u0430\u0432\u0430\u043d\u0435 \u043d\u0430 \u043a\u0430\u0440\u0442\u0430', 'error'); }
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
  const users = allUsers.filter(u => !query || u.name.toLowerCase().includes(query)).slice(0, 8);
  if (!users.length) return;
  _mentionState = { users, selectedIdx: 0, onSelect };
  const dd = document.createElement('div');
  dd.id = 'mentionDropdown';
  dd.className = 'mention-dropdown';
  dd.innerHTML = users.map((u, i) =>
    `<div class="mention-item${i===0?' mention-item--active':''}" data-idx="${i}" onmousedown="event.preventDefault();_selectMentionByIdx(${i})">
      <div class="mention-av" style="background:${u.avatar_url ? 'none' : _avColors[u.id%_avColors.length]}">${_avInner(u.name, u.avatar_url)}</div>
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


