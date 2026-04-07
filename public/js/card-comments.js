// ==================== CARD COMMENTS, REPLIES, FILTERS ====================
function replyToComment(cardId, commentId, userName) {
  _replyToComment = { id: commentId, userName: userName };
  expandCommentInput();
  var badge = document.getElementById('replyBadge');
  if (badge) {
    badge.style.display = 'flex';
    var nameEl = badge.querySelector('.bc-reply-badge__name');
    if (nameEl) nameEl.textContent = userName;
  }
  var wrap = document.getElementById('commentEditorWrap');
  if (wrap) setTimeout(function() { wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
}

function cancelReply() {
  _replyToComment = null;
  var badge = document.getElementById('replyBadge');
  if (badge) badge.style.display = 'none';
}

function scrollToComment(commentId) {
  var el = document.querySelector('[data-comment-id="' + commentId + '"]');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('bc-comment--highlight');
  setTimeout(function() { el.classList.remove('bc-comment--highlight'); }, 2000);
}

function setCommentSort(order) {
  _commentSortOrder = order;
  document.querySelectorAll('.bc-filter-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.sort === order);
  });
  applyCommentFilter();
}

function setCommentUser(userId) {
  _commentFilterUserId = userId || null;
  applyCommentFilter();
}

function applyCommentFilter() {
  var list = document.getElementById('commentsList');
  if (!list) return;
  // Move any hidden comments into the list first
  var hidden = document.getElementById('hiddenComments');
  if (hidden) {
    Array.from(hidden.querySelectorAll('.bc-comment')).forEach(function(el) { list.appendChild(el); });
    hidden.remove();
  }
  var moreBtn = document.getElementById('showMoreCommentsBtn');
  if (moreBtn) moreBtn.remove();
  var comments = Array.from(list.querySelectorAll('.bc-comment'));
  // Filter by user
  comments.forEach(function(el) {
    var show = !_commentFilterUserId || el.dataset.userId === String(_commentFilterUserId);
    el.style.display = show ? '' : 'none';
  });
  // Sort
  var visible = comments.filter(function(el) { return el.style.display !== 'none'; });
  visible.sort(function(a, b) {
    var ta = a.dataset.timestamp || '', tb = b.dataset.timestamp || '';
    return _commentSortOrder === 'asc' ? ta.localeCompare(tb) : tb.localeCompare(ta);
  });
  visible.forEach(function(el) { list.appendChild(el); });
}
async function addComment(cardId) {
  var input = document.getElementById('newCommentInput');
  var c = input ? input.value.trim() : '';
  if (!c || c === '<div><br></div>' || c === '<div></div>') return;
  var textContent = c.replace(/<[^>]*>/g, '');
  if (!textContent.trim()) return;
  var mentions = [];
  var mentionMatches = textContent.match(/@(\S+)/g);
  if (mentionMatches) {
    mentions = mentionMatches.map(function(m) { return m.substring(1).toLowerCase(); });
  }
  var mIds = allUsers.filter(function(u) { return mentions.some(function(n) { return u.name.toLowerCase().includes(n); }); }).map(function(u) { return u.id; });
  var btn = document.querySelector('.bc-btn-add-comment');
  if (btn) { btn.disabled = true; btn.textContent = 'Изпращане…'; }
  try {
    var r = await fetch('/api/cards/' + cardId + '/comments', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content:c,mentions:mIds,reply_to_id:_replyToComment?_replyToComment.id:null}) });
    if (!r.ok) { var d = await r.json(); showToast(d.error || 'Грешка', 'error'); if(btn){btn.disabled=false;btn.textContent='Добави коментар';} return; }
    router();
  } catch(e) { showToast('Грешка при изпращане', 'error'); if(btn){btn.disabled=false;btn.textContent='Добави коментар';} }
}

function showMoreComments() {
  var hidden = document.getElementById('hiddenComments');
  var btn = document.getElementById('showMoreCommentsBtn');
  if (!hidden || !btn) return;
  var BATCH = 10;
  var items = hidden.querySelectorAll('.bc-comment');
  var showing = 0;
  for (var i = 0; i < items.length && showing < BATCH; i++) {
    if (items[i].style.display === 'none' || items[i].parentElement === hidden) {
      items[i].style.display = '';
      hidden.parentElement.insertBefore(items[i], btn);
      showing++;
    }
  }
  if (hidden.querySelectorAll('.bc-comment').length === 0) {
    btn.style.display = 'none';
    hidden.remove();
  } else {
    btn.textContent = 'Покажи по-стари (' + hidden.querySelectorAll('.bc-comment').length + ')';
  }
}

// ==================== ACTIVITY ====================
let _activityItems = [];
