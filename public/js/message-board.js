// ==================== MESSAGE BOARD (per-board) ====================

// Render message board — list of messages for a specific board
async function renderMsgBoard(el, boardId) {
  el.className = 'page-card';
  try {
    var boardsData = await (await fetch('/api/boards')).json();
    var board = boardsData.find(function(b) { return b.id === boardId; });
    if (!board) { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Бордът не е намерен</div>'; return; }
    setBreadcrumb([{ label: board.title }]);

    var msgs = await (await fetch('/api/messageboard?board_id=' + boardId)).json();

    var isAdmin = currentUser && currentUser.role === 'admin';
    var boardMenuBtn = canManage()
      ? '<div style="position:relative;display:inline-block">' +
          '<button class="btn btn-sm btn-ghost" onclick="toggleBoardMenu(event,' + boardId + ')" title="Настройки" style="font-size:18px;padding:2px 8px">\u22ef</button>' +
        '</div>'
      : '';

    el.innerHTML =
      '<div class="card-page">' +
        '<div class="msgboard-header">' +
          '<div style="display:flex;align-items:center;justify-content:center;gap:12px">' +
            '<h1 class="msgboard-title">' + esc(board.title) + '</h1>' +
            boardMenuBtn +
          '</div>' +
          '<p class="msgboard-subtitle">Публикувай обявления, предложи идеи и води дискусии</p>' +
        '</div>' +
        '<div style="text-align:center;margin-bottom:24px">' +
          '<button class="btn btn-primary" onclick="msgCreatePost(' + boardId + ')">+ Ново съобщение</button>' +
        '</div>' +
        '<div class="msgboard-list" id="msgboardList">' +
          (msgs.length === 0
            ? '<div class="msgboard-empty">Няма съобщения все още.<br>Създай първото!</div>'
            : msgs.map(function(m) { return _renderMsgCard(m); }).join('')) +
        '</div>' +
      '</div>';
  } catch (e) {
    console.error('[msgboard] render error:', e);
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка при зареждане</div>';
  }
}

// Render single message card in list
function _renderMsgCard(m) {
  var initials = (m.user_name || '?').split(' ').map(function(w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
  var pinHtml = m.pinned ? '<span class="msgboard-pin">📌</span>' : '';
  var catHtml = m.category && m.category !== 'general' ? '<span class="msgboard-cat">' + esc(m.category) + '</span>' : '';
  var commentLabel = (m.comment_count || 0) > 0 ? '<span class="msgboard-comments">💬 ' + m.comment_count + '</span>' : '';
  var preview = '';
  if (m.content) {
    var plain = m.content.replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim();
    if (plain.length > 150) plain = plain.substring(0, 150) + '…';
    preview = '<p class="msgboard-card__preview">' + esc(plain) + '</p>';
  }
  return '<a class="msgboard-card" href="#/msg/' + m.id + '">' +
    '<div class="msgboard-card__left">' +
      '<div class="msgboard-card__avatar" style="background:' + _avatarColor(m.user_name) + '">' + initials + '</div>' +
    '</div>' +
    '<div class="msgboard-card__body">' +
      '<div class="msgboard-card__top">' + pinHtml + '<h3 class="msgboard-card__title">' + esc(m.title) + '</h3>' + catHtml + '</div>' +
      preview +
      '<div class="msgboard-card__meta">' +
        '<span>' + esc(m.user_name || 'Анонимен') + '</span>' +
        '<span class="msgboard-card__dot">·</span>' +
        '<span>' + timeAgo(m.created_at) + '</span>' +
        commentLabel +
      '</div>' +
    '</div>' +
  '</a>';
}

// Render single message page with comments
async function renderMsgPage(el, msgId) {
  el.className = 'page-card';
  try {
    var msg = await (await fetch('/api/messageboard/' + msgId)).json();
    if (!msg || msg.error) { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Съобщението не е намерено</div>'; return; }

    // Find board for breadcrumb
    var boardHref = msg.board_id ? '#/msgboard/' + msg.board_id : '#/messages';
    var boardsData = await (await fetch('/api/boards')).json();
    var board = msg.board_id ? boardsData.find(function(b) { return b.id === msg.board_id; }) : null;
    setBreadcrumb([
      { label: board ? board.title : 'Съобщения', href: boardHref },
      { label: msg.title }
    ]);

    var initials = (msg.user_name || '?').split(' ').map(function(w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
    var isOwner = currentUser && msg.user_id === currentUser.id;
    var isMod = currentUser && (currentUser.role === 'admin' || currentUser.role === 'moderator');
    var canEdit = isOwner || isMod;

    var contentHtml = '';
    if (msg.content) {
      // If content has HTML tags use as-is, otherwise convert newlines
      if (/<[a-z][\s\S]*>/i.test(msg.content)) {
        contentHtml = msg.content;
      } else {
        contentHtml = esc(msg.content).replace(/\n/g, '<br>');
      }
    }

    var commentsHtml = (msg.comments || []).map(function(c) {
      var cInit = (c.user_name || '?').split(' ').map(function(w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
      var cOwner = currentUser && c.user_id === currentUser.id;
      var canEditComment = cOwner || isMod;
      var cActions = canEditComment
        ? '<button class="msgboard-comment__action" onclick="msgEditComment(' + msg.id + ',' + c.id + ')" title="Редактирай">✏️</button>' +
          '<button class="msgboard-comment__action msgboard-comment__action--del" onclick="msgDeleteComment(' + msg.id + ',' + c.id + ')" title="Изтрий">&times;</button>'
        : '';
      var cContent = /<[a-z][\s\S]*>/i.test(c.content) ? c.content : esc(c.content).replace(/\n/g, '<br>');
      var editedTag = c.updated_at && c.updated_at !== c.created_at ? '<span class="msgboard-comment__edited">(редактирано)</span>' : '';
      return '<div class="msgboard-comment" id="msgComment_' + c.id + '">' +
        '<div class="msgboard-comment__avatar" style="background:' + _avatarColor(c.user_name) + '">' + cInit + '</div>' +
        '<div class="msgboard-comment__body">' +
          '<div class="msgboard-comment__header">' +
            '<strong>' + esc(c.user_name || 'Анонимен') + '</strong>' +
            '<span class="msgboard-comment__time">' + timeAgo(c.created_at) + editedTag + '</span>' +
            '<span class="msgboard-comment__actions">' + cActions + '</span>' +
          '</div>' +
          '<div class="msgboard-comment__content" id="msgCommentContent_' + c.id + '">' + cContent + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    el.innerHTML =
      '<div class="card-page">' +
        '<div style="margin-bottom:16px">' +
          '<a href="' + boardHref + '" class="btn btn-sm btn-ghost">\u2190 Назад</a>' +
          (canEdit ? '<button class="btn btn-sm btn-ghost" style="margin-left:8px" onclick="msgEditPost(' + msg.id + ')">Редактирай</button>' +
            '<button class="btn btn-sm btn-ghost" style="margin-left:4px;color:var(--red)" onclick="msgDeletePost(' + msg.id + ',' + (msg.board_id || 'null') + ')">Изтрий</button>' : '') +
        '</div>' +
        '<article class="msgboard-post">' +
          '<div class="msgboard-post__header">' +
            '<div class="msgboard-post__avatar" style="background:' + _avatarColor(msg.user_name) + '">' + initials + '</div>' +
            '<div>' +
              '<strong class="msgboard-post__author">' + esc(msg.user_name || 'Анонимен') + '</strong>' +
              '<div class="msgboard-post__date">' + timeAgo(msg.created_at) + (msg.pinned ? ' · 📌 Закачено' : '') + '</div>' +
            '</div>' +
          '</div>' +
          '<h1 class="msgboard-post__title">' + esc(msg.title) + '</h1>' +
          (contentHtml ? '<div class="msgboard-post__content">' + contentHtml + '</div>' : '') +
        '</article>' +
        '<div class="msgboard-comments-section">' +
          '<h3 class="msgboard-comments-title">Коментари (' + (msg.comments || []).length + ')</h3>' +
          '<div id="msgCommentsList">' + commentsHtml + '</div>' +
          '<div class="msgboard-comment-form">' +
            '<div class="bc-editor msgboard-comment-editor">' +
              '<input id="msgCommentInput" type="hidden" value="">' +
              '<trix-editor input="msgCommentInput" class="trix-dark" placeholder="Напиши коментар\u2026"></trix-editor>' +
            '</div>' +
            '<button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="msgPostComment(' + msg.id + ')">Коментирай</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Setup Trix
    setTimeout(function() {
      var trixEl = document.querySelector('trix-editor[input="msgCommentInput"]');
      if (trixEl) {
        trixEl.addEventListener('trix-attachment-add', function(e) {
          if (e.attachment.file) uploadTrixAttachment(null, e.attachment);
        });
      }
    }, 200);
  } catch (e) {
    console.error('[msgboard] renderMsg error:', e);
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка при зареждане</div>';
  }
}

// Create new message post
function msgCreatePost(boardId) {
  var ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box" style="max-width:840px">' +
    '<p class="confirm-modal-msg" style="margin-bottom:16px">Ново съобщение</p>' +
    '<input class="confirm-modal-input" id="msgNewTitle" placeholder="Заглавие\u2026" style="margin-bottom:10px">' +
    '<div class="msgboard-modal-editor" style="margin-bottom:10px">' +
      '<input id="msgNewContent" type="hidden" value="">' +
      '<trix-editor input="msgNewContent" class="trix-dark" placeholder="Съдържание\u2026"></trix-editor>' +
    '</div>' +
    '<div class="confirm-modal-actions">' +
      '<button class="btn btn-primary" id="msgNewOk">Публикувай</button>' +
      '<button class="btn btn-ghost" onclick="this.closest(\'.modal-overlay\').remove()">Отказ</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(ov);
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
  setTimeout(function() { document.getElementById('msgNewTitle').focus(); }, 50);

  ov.querySelector('#msgNewOk').onclick = async function() {
    var title = document.getElementById('msgNewTitle').value.trim();
    if (!title) { document.getElementById('msgNewTitle').focus(); return; }
    var content = document.getElementById('msgNewContent').value || '';
    ov.remove();
    try {
      await fetch('/api/messageboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title, content: content, board_id: boardId })
      });
      showToast('Съобщението е публикувано', 'success');
      router();
    } catch { showToast('Грешка при публикуване', 'error'); }
  };
}

// Edit message
async function msgEditPost(msgId) {
  try {
    var msg = await (await fetch('/api/messageboard/' + msgId)).json();
    var ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = '<div class="confirm-modal-box" style="max-width:840px">' +
      '<p class="confirm-modal-msg" style="margin-bottom:16px">Редактирай съобщение</p>' +
      '<input class="confirm-modal-input" id="msgEditTitle" placeholder="Заглавие\u2026" value="' + esc(msg.title).replace(/"/g, '&quot;') + '" style="margin-bottom:10px">' +
      '<div class="msgboard-modal-editor" style="margin-bottom:10px">' +
        '<input id="msgEditContent" type="hidden" value="' + (msg.content || '').replace(/"/g, '&quot;') + '">' +
        '<trix-editor input="msgEditContent" class="trix-dark" placeholder="Съдържание\u2026"></trix-editor>' +
      '</div>' +
      '<div class="confirm-modal-actions">' +
        '<button class="btn btn-primary" id="msgEditOk">Запази</button>' +
        '<button class="btn btn-ghost" onclick="this.closest(\'.modal-overlay\').remove()">Отказ</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(ov);
    ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
    setTimeout(function() { document.getElementById('msgEditTitle').focus(); }, 50);

    ov.querySelector('#msgEditOk').onclick = async function() {
      var title = document.getElementById('msgEditTitle').value.trim();
      if (!title) { document.getElementById('msgEditTitle').focus(); return; }
      var content = document.getElementById('msgEditContent').value || '';
      ov.remove();
      try {
        await fetch('/api/messageboard/' + msgId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title, content: content })
        });
        showToast('Съобщението е обновено', 'success');
        router();
      } catch { showToast('Грешка', 'error'); }
    };
  } catch { showToast('Грешка при зареждане', 'error'); }
}

// Delete message
async function msgDeletePost(msgId, boardId) {
  showConfirmModal('Сигурен ли си, че искаш да изтриеш това съобщение?', async function() {
    try {
      await fetch('/api/messageboard/' + msgId, { method: 'DELETE' });
      showToast('Съобщението е изтрито', 'success');
      location.hash = boardId ? '#/msgboard/' + boardId : '#/messages';
    } catch { showToast('Грешка при изтриване', 'error'); }
  }, true);
}

// Post comment on message
async function msgPostComment(msgId) {
  var input = document.getElementById('msgCommentInput');
  var content = input ? input.value.trim() : '';
  if (!content) return;
  try {
    await fetch('/api/messageboard/' + msgId + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    });
    showToast('Коментарът е добавен', 'success');
    router();
  } catch { showToast('Грешка', 'error'); }
}

// Delete comment
async function msgDeleteComment(msgId, commentId) {
  showConfirmModal('Изтрий този коментар?', async function() {
    try {
      await fetch('/api/messageboard/' + msgId + '/comments/' + commentId, { method: 'DELETE' });
      showToast('Коментарът е изтрит', 'success');
      router();
    } catch { showToast('Грешка', 'error'); }
  }, true);
}

// Edit comment — inline replace with Trix editor
async function msgEditComment(msgId, commentId) {
  try {
    // Fetch current comment content
    var msg = await (await fetch('/api/messageboard/' + msgId)).json();
    var comment = (msg.comments || []).find(function(c) { return c.id === commentId; });
    if (!comment) { showToast('Коментарът не е намерен', 'error'); return; }

    var container = document.getElementById('msgComment_' + commentId);
    var contentEl = document.getElementById('msgCommentContent_' + commentId);
    if (!container || !contentEl) return;

    // Replace content with edit form
    var editId = 'msgCommentEdit_' + commentId;
    contentEl.innerHTML =
      '<div class="msgboard-comment-editor" style="margin-top:6px">' +
        '<input id="' + editId + '" type="hidden" value="' + (comment.content || '').replace(/"/g, '&quot;') + '">' +
        '<trix-editor input="' + editId + '" class="trix-dark" placeholder="Редактирай коментар\u2026"></trix-editor>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px">' +
        '<button class="btn btn-primary btn-sm" onclick="msgSaveComment(' + msgId + ',' + commentId + ',\'' + editId + '\')">Запази</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="router()">Отказ</button>' +
      '</div>';
  } catch { showToast('Грешка', 'error'); }
}

// Save edited comment
async function msgSaveComment(msgId, commentId, inputId) {
  var input = document.getElementById(inputId);
  var content = input ? input.value.trim() : '';
  if (!content) return;
  try {
    await fetch('/api/messageboard/' + msgId + '/comments/' + commentId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    });
    showToast('Коментарът е обновен', 'success');
    router();
  } catch { showToast('Грешка при запис', 'error'); }
}

// Avatar color helper
function _avatarColor(name) {
  if (!name) return '#566d7a';
  var hash = 0;
  for (var i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  var hue = Math.abs(hash) % 360;
  return 'hsl(' + hue + ', 40%, 35%)';
}
