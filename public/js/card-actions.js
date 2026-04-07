// ==================== CARD ACTIONS (title edit, options, move/trash/restore, renderTrash) ====================
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
async function toggleCardOptionsMenu(e, cardId, cardTitle) {
  e.stopPropagation();
  var existing = document.querySelector('.bc-options-menu');
  if (existing) { existing.remove(); return; }

  var reminderIds = [];
  try { reminderIds = await (await fetch('/api/notifications/reminders')).json(); } catch {}
  var hasReminder = reminderIds.includes(cardId);
  var safeTitle = cardTitle.replace(/'/g, "\\'");

  var menu = document.createElement('div');
  menu.className = 'bc-options-menu';
  menu.innerHTML =
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();document.querySelector(\'.bc-card__title\').click()">\u270f\ufe0f Редактирай</button>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();showMoveCardPicker(' + cardId + ')">\u2197\ufe0f Премести</button>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();copyCardLink(' + cardId + ')">\ud83d\udccb Копирай линк</button>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();archiveCard(' + cardId + ')">\ud83d\udce6 Архивирай</button>' +
    '<button class="bc-options-menu__item bc-options-menu__item--danger" onclick="document.querySelector(\'.bc-options-menu\').remove();trashCard(' + cardId + ')">\ud83d\uddd1\ufe0f В кошчето</button>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();toggleBookmark(\'card\',' + cardId + ',\'' + safeTitle + '\')">\ud83d\udd16 Отметка</button>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();toggleCardReminder(' + cardId + ',\'' + safeTitle + '\')"><img src="/img/icon-bookmark.png" alt="" width="14" height="14" style="vertical-align:-2px"> ' + (hasReminder ? 'Махни от Не забравяй' : 'Не забравяй') + '</button>' +
    '<div class="bc-options-menu__sep"></div>' +
    '<div class="bc-options-menu__heading">История</div>' +
    '<button class="bc-options-menu__item" onclick="document.querySelector(\'.bc-options-menu\').remove();showCardHistory(' + cardId + ')">\ud83d\udd50 История на промените</button>' +
    '<button class="bc-options-menu__item" style="opacity:0.5;cursor:default">\ud83d\udc65 Уведомени хора</button>';

  // Position fixed near the button
  var btn = e.currentTarget || e.target;
  var rect = btn.getBoundingClientRect();
  menu.style.cssText = 'position:fixed;right:' + (window.innerWidth - rect.right) + 'px;top:' + (rect.bottom + 4) + 'px;z-index:9999';
  document.body.appendChild(menu);

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

// Trash card — moves to trash bin (30-day retention)
function trashCard(cardId) {
  showConfirmModal('Премести тази карта в кошчето?', async function() {
    try {
      var res = await fetch('/api/cards/' + cardId, { method: 'DELETE' });
      if (res.ok) {
        showToast('Картата е преместена в кошчето', 'success');
        setTimeout(function() { history.back(); }, 800);
      } else {
        showToast('Грешка при изтриване', 'error');
      }
    } catch(e) { showToast('Грешка при изтриване', 'error'); }
  }, true, 'В кошчето');
}

// Restore card from trash
async function restoreCard(cardId) {
  try {
    var res = await fetch('/api/trash/' + cardId + '/restore', { method: 'POST' });
    if (res.ok) {
      showToast('Картата е възстановена', 'success');
      renderTrash(document.getElementById('pageContent'));
    } else {
      showToast('Грешка при възстановяване', 'error');
    }
  } catch(e) { showToast('Грешка при възстановяване', 'error'); }
}

// Permanently delete card from trash
function permanentlyDeleteCard(cardId) {
  showConfirmModal('Изтрий завинаги тази карта? Това не може да се върне назад.', async function() {
    try {
      var res = await fetch('/api/trash/' + cardId, { method: 'DELETE' });
      if (res.ok) {
        showToast('Картата е изтрита завинаги', 'success');
        renderTrash(document.getElementById('pageContent'));
      } else {
        showToast('Грешка при изтриване', 'error');
      }
    } catch(e) { showToast('Грешка при изтриване', 'error'); }
  }, true, 'Изтрий завинаги');
}

// Render trash view
async function renderTrash(el) {
  setBreadcrumb([{ label: 'Кошче' }]);
  el.className = '';
  el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Зареждане...</div>';
  try {
    var cards = await (await fetch('/api/trash')).json();
    if (!Array.isArray(cards)) cards = [];
    var now = new Date();
    var html = '<div class="trash-view">' +
      '<div class="trash-view__header">' +
        '<h2 class="trash-view__title">🗑️ Кошче</h2>' +
        '<p class="trash-view__subtitle">Картите тук ще бъдат изтрити завинаги след 30 дни.</p>' +
      '</div>';
    if (cards.length === 0) {
      html += '<div class="trash-view__empty">Кошчето е празно.</div>';
    } else {
      html += '<div class="trash-view__list">';
      cards.forEach(function(c) {
        var trashedDate = new Date(c.trashed_at);
        var deleteDate = new Date(trashedDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        var daysLeft = Math.max(0, Math.ceil((deleteDate - now) / (1000 * 60 * 60 * 24)));
        var urgentClass = daysLeft <= 3 ? ' trash-card--urgent' : daysLeft <= 7 ? ' trash-card--warning' : '';
        var assigneesHtml = (c.assignees || []).map(function(a) { return '<span class="trash-card__assignee">' + esc(a.name) + '</span>'; }).join('');
        html += '<div class="trash-card' + urgentClass + '">' +
          '<div class="trash-card__main">' +
            '<a class="trash-card__title" href="#/card/' + c.id + '">' + esc(c.title) + '</a>' +
            '<div class="trash-card__meta">' +
              '<span class="trash-card__board">' + esc(c.board_title || '') + '</span>' +
              (c.column_title ? '<span class="trash-card__sep">›</span><span>' + esc(c.column_title) + '</span>' : '') +
              (c.client_name ? '<span class="trash-card__sep">·</span><span>' + esc(c.client_name) + '</span>' : '') +
              (assigneesHtml ? '<span class="trash-card__sep">·</span>' + assigneesHtml : '') +
            '</div>' +
          '</div>' +
          '<div class="trash-card__right">' +
            '<span class="trash-card__days' + urgentClass + '">' + (daysLeft === 0 ? 'Изтрива се днес' : 'Изтрива се след ' + daysLeft + ' дни') + '</span>' +
            '<div class="trash-card__actions">' +
              '<button class="btn btn-sm btn-ghost" onclick="restoreCard(' + c.id + ')">↩ Възстанови</button>' +
              '<button class="btn btn-sm btn-danger" onclick="permanentlyDeleteCard(' + c.id + ')">Изтрий завинаги</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка при зареждане на кошчето</div>';
  }
}

// Remove assignee
