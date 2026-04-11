// ==================== CARD PAGE RENDERING ====================
// ==================== CARD PAGE (detail, edit, options, dates, steps, attachments, create) ====================
var _cardPinnedComment = null;
var _commentSortOrder = 'desc';
var _commentFilterUserId = null;
var _replyToComment = null; // { id, userName }
var _pendingScrollCommentId = null;
var _pinnedSidebarScrollTop = 0;
var _heyAllItems = [];

var _cardEditMode = false;
const cardEditingPresence = new Map(); // cardId -> { userId, userName }

async function renderCardPage(el, cardId) {
  el.className = 'page-card';
  try {
    const card = await (await fetch('/api/cards/' + cardId)).json();
    var comments = [];
    try { comments = await (await fetch('/api/cards/' + cardId + '/comments')).json(); } catch(e) {}

    // Load pinned comment from API
    _cardPinnedComment = card.pinned_comment || null;
    if (_cardPinnedComment) el.className = 'page-card card-sidebar';

    var board = allBoards.find(function(b) { return b.id === card.board_id; });
    var col = board && board.columns ? board.columns.find(function(c) { return c.id === card.column_id; }) : null;

    setBreadcrumb([
      { label: board ? board.title : 'Борд', href: '#/board/' + card.board_id },
      { label: col ? col.title : '\u2014' }
    ]);

    var manage = canManage();
    var editing = _cardEditMode && canEdit();
    var creatorName = card.creator_name || (allUsers.find(function(u) { return u.id === card.creator_id; }) || {}).name || '';
    var createdAgo = card.created_at ? timeAgo(card.created_at) : '';
    var getAC = _avColor;

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
      var dueDateObj = _parseDateMidnight(card.due_on);
      var nowDay2 = new Date(); nowDay2.setHours(0,0,0,0);
      var dueIsOverdue = dueDateObj && dueDateObj < nowDay2 && !card.completed_at;
      var dueIsToday = dueDateObj && dueDateObj >= nowDay2 && dueDateObj < new Date(nowDay2.getTime() + 86400000);
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
      '<div class="bc-comment-avatar" style="background:' + (currentUser?.avatar_url ? 'none' : getAC(currentUser ? currentUser.name : '')) + '">' + _avInner(currentUser ? currentUser.name : '', currentUser?.avatar_url) + '</div>' +
      '<div class="bc-comment-input-wrap">' +
      '<div id="replyBadge" class="bc-reply-badge" style="display:none"><span>↩ Отговаряш на <strong class="bc-reply-badge__name"></strong></span><button class="bc-reply-badge__cancel" onclick="cancelReply()">✕</button></div>' +
      '<div class="bc-comment-placeholder" onclick="expandCommentInput()">Добави коментар тук…</div>' +
      '<div class="bc-comment-editor-wrap" id="commentEditorWrap">' +
      '<div class="bc-editor"><input id="newCommentInput" type="hidden" value=""><trix-editor input="newCommentInput" class="trix-dark" placeholder="Написвай коментар тук\u2026" style="min-height:80px"></trix-editor></div>' +
      '<div style="display:flex;gap:8px;margin-top:8px"><button class="bc-btn-save bc-btn-add-comment" onclick="addComment(' + cardId + ')">Добави този коментар</button><button class="bc-btn-discard" onclick="collapseCommentInput()">Отказ</button></div>' +
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
          '<div class="bc-comment-date">' + fmtDate(c.created_at) + '</div>' +
          '<div class="bc-comment-avatar" style="background:' + (c.user_avatar ? 'none' : cc) + '">' + _avInner(c.user_name, c.user_avatar) + '</div>' +
          '<div class="bc-comment-body">' +
          '<div class="bc-comment-meta"><strong>' + esc(c.user_name) + '</strong></div>' +
          (c.reply_to_id && c.parent_user_name ? '<div class="bc-reply-preview" onclick="scrollToComment(' + c.reply_to_id + ')" title="Премини към оригиналния коментар"><span class="bc-reply-preview__author">↩ ' + esc(c.parent_user_name) + ':</span> <span class="bc-reply-preview__text">' + esc((c.parent_content||'').replace(/<[^>]*>/g,'').slice(0,120)) + ((c.parent_content||'').replace(/<[^>]*>/g,'').length>120?'…':'') + '</span></div>' : '') +
          '<div class="bc-comment-text">' + (c.content || '').replace(/\n/g, '<br>') + '</div>' +
          '<button class="bc-reply-btn" onclick="replyToComment(' + cardId + ',' + c.id + ',\'' + esc(c.user_name) + '\')">\u21a9 Отговори</button>' +
          '</div>' +
          '<div class="bc-comment-dots">' +
          '<button class="bc-comment-dots-btn" onclick="toggleCommentMenu(event,' + cardId + ',' + c.id + ',' + isOwn + ',' + isPinned + ')">\u22ef</button>' +
          '</div>' +
          '</div>';
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

    // Trash banner
    var trashBannerHtml = '';
    if (card.trashed_at) {
      var _td = new Date(card.trashed_at);
      var _dd = new Date(_td.getTime() + 30 * 24 * 60 * 60 * 1000);
      var _dl = _dd.toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' });
      trashBannerHtml = '<div class="card-trash-banner">🗑️ Тази карта е в кошчето — ще бъде изтрита на <strong>' + _dl + '</strong>. ' +
        '<button class="card-trash-banner__restore" onclick="restoreCard(' + cardId + ')">↩ Възстанови</button>' +
      '</div>';
    }

    el.innerHTML = wrapperStart +
      '<div class="' + (pinnedSidebarHtml ? 'card-page-main' : 'card-page') + '">' +
        '<div class="card-page__toolbar" id="cardPageToolbar_' + cardId + '"></div>' +
        '<div id="cardEditingBanner" class="card-editing-banner" style="display:none"></div>' +
        trashBannerHtml +
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
  } catch(e) { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u043a\u0430\u0447\u0432\u0430\u043d\u0435 \u043d\u0430 \u0444\u0430\u0439\u043b', 'error'); }
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
  btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M8.37868 2.59294C7.98816 2.20242 7.35499 2.20242 6.96447 2.59294C6.57394 2.98347 6.57394 3.61663 6.96447 4.00716L9.25736 6.30005L4.37868 11.1787C3.20711 12.3503 3.2071 14.2498 4.37868 15.4214L8.55025 19.5929C9.72182 20.7645 11.6213 20.7645 12.7929 19.5929L18.3787 14.0072C18.7692 13.6166 18.7692 12.9835 18.3787 12.5929L11.8788 6.09305L11.8787 6.09294L11.3787 5.59294L8.37868 2.59294ZM5.79289 12.5929L10.6716 7.71426L16.2574 13.3L5.5 13.3C5.5 13.0441 5.59763 12.7882 5.79289 12.5929ZM21.6716 19.3C21.6716 20.4046 20.7761 21.3 19.6716 21.3C18.567 21.3 17.6716 20.4046 17.6716 19.3C17.6716 18.284 18.5178 17.4449 19.4318 16.5385C19.5114 16.4596 19.5915 16.3802 19.6716 16.3C19.7517 16.3802 19.8318 16.4596 19.9114 16.5385C20.8254 17.4449 21.6716 18.284 21.6716 19.3Z" fill="black"/></svg>';
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
