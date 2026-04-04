// Batch 27 patch script
'use strict';
const fs = require('fs');
const path = require('path');
const appPath = path.join(__dirname, '..', 'public', 'js', 'app.js');
let c = fs.readFileSync(appPath, 'utf8');

function must(idx, label) {
  if (idx === -1) { console.error('NOT FOUND:', label); process.exit(1); }
  return idx;
}

// ── 1. SOS text: "SOS" → "Спешно" ──────────────────────────────────────────
{
  const old = "sosBtn.textContent = '\ud83d\udea8 SOS';";
  const neu = "sosBtn.textContent = '\ud83d\udea8 \u0421\u043f\u0435\u0448\u043d\u043e';";
  must(c.indexOf(old), 'SOS text');
  c = c.replace(old, neu);
  console.log('1. SOS text done');
}

// ── 2. setupCardPageToolbar: accept editing param, add right group ───────────
{
  const old_sig = 'function setupCardPageToolbar(card, col) {';
  const new_sig = 'function setupCardPageToolbar(card, col, editing) {';
  must(c.indexOf(old_sig), 'toolbar signature');
  c = c.replace(old_sig, new_sig);

  // Find end of function (closing brace after last toolbar.appendChild)
  const fnStart = c.indexOf('function setupCardPageToolbar(card, col, editing)');
  const fnEnd   = c.indexOf('\r\n}\r\n', fnStart);
  must(fnEnd, 'toolbar fn end');

  // Insert right group before closing brace
  const rightGroup = [
    '',
    '  // Right group: Edit + Options (moved here from bc-card-options)',
    '  var rightGroup = document.createElement(\'div\');',
    '  rightGroup.style.cssText = \'display:flex;align-items:center;gap:4px;margin-left:auto\';',
    '  if (canEdit() && !editing) {',
    '    var editBtn2 = document.createElement(\'button\');',
    '    editBtn2.className = \'btn btn-sm btn-ghost\';',
    '    editBtn2.textContent = \'\u270f\ufe0f \u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0430\u0439\';',
    '    editBtn2.onclick = function() { enterCardEditMode(card.id); };',
    '    rightGroup.appendChild(editBtn2);',
    '  }',
    '  var dotsBtn2 = document.createElement(\'button\');',
    '  dotsBtn2.className = \'btn btn-sm btn-ghost bc-card-options__dots\';',
    '  dotsBtn2.title = \'\u041e\u043f\u0446\u0438\u0438\';',
    '  dotsBtn2.innerHTML = \'\u22ef\';',
    '  dotsBtn2.onclick = function(e) { toggleCardOptionsMenu(e, card.id, esc(card.title).replace(/\'/g, "\\\\\'")); };',
    '  rightGroup.appendChild(dotsBtn2);',
    '  toolbar.appendChild(rightGroup);'
  ].join('\r\n');

  c = c.slice(0, fnEnd) + rightGroup + c.slice(fnEnd);
  console.log('2. toolbar right group done');
}

// ── 3. Call site: add editing as third arg ───────────────────────────────────
{
  const old_call = 'setupCardPageToolbar(card, col);';
  must(c.indexOf(old_call), 'toolbar call');
  c = c.replace(old_call, 'setupCardPageToolbar(card, col, editing);');
  console.log('3. toolbar call updated');
}

// ── 4. Remove bc-card-options from article HTML, remove editBtnHtml ──────────
{
  // Remove: var editBtnHtml = ...
  const ebStart = c.indexOf('\r\n    var editBtnHtml = ');
  const ebEnd   = c.indexOf('\r\n', ebStart + 1);
  must(ebStart, 'editBtnHtml declaration');
  c = c.slice(0, ebStart) + c.slice(ebEnd);

  // Remove bc-card-options div from innerHTML string
  const boStart = c.indexOf("'<div class=\"bc-card-options\">' +\r\n            editBtnHtml +\r\n            '<button class=\"btn btn-sm btn-ghost bc-card-options__dots\"");
  if (boStart === -1) {
    // Try different whitespace
    const boStart2 = c.indexOf("'<div class=\"bc-card-options\">'");
    must(boStart2, 'bc-card-options div');
    const boEnd2 = c.indexOf("'</div>' +\r\n          '<header", boStart2);
    must(boEnd2, 'bc-card-options end');
    c = c.slice(0, boStart2) + c.slice(boEnd2 + "'</div>' +\r\n".length);
  } else {
    const boEnd = c.indexOf("'</div>' +\r\n          '<header", boStart);
    must(boEnd, 'bc-card-options end');
    c = c.slice(0, boStart) + c.slice(boEnd + "'</div>' +\r\n".length);
  }
  console.log('4. bc-card-options removed from HTML');
}

// ── 5. State variables: add comment filter/reply state ───────────────────────
{
  const anchor = 'var _cardPinnedComment = null;';
  must(c.indexOf(anchor), 'state anchor');
  const addition = [
    'var _commentSortOrder = \'desc\';',
    'var _commentFilterUserId = null;',
    'var _replyToComment = null; // { id, userName }'
  ].join('\r\n');
  c = c.replace(anchor, anchor + '\r\n' + addition);
  console.log('5. state vars added');
}

// ── 6. Comment add form: add reply badge ─────────────────────────────────────
{
  const anchor = "'<div class=\"bc-comment-placeholder\" onclick=\"expandCommentInput()\">";
  must(c.indexOf(anchor), 'comment placeholder');
  const replyBadge =
    "'<div id=\"replyBadge\" class=\"bc-reply-badge\" style=\"display:none\">" +
    "<span>\u21a9 \u041e\u0442\u0433\u043e\u0432\u0430\u0440\u044f\u0448 \u043d\u0430 <strong class=\"bc-reply-badge__name\"></strong></span>" +
    "<button class=\"bc-reply-badge__cancel\" onclick=\"cancelReply()\">\u2715</button>" +
    "</div>' +\r\n      ";
  c = c.replace(anchor, replyBadge + anchor);
  console.log('6. reply badge added');
}

// ── 7. Comments rendering: add filter bar + reply preview + reply btn ─────────
// Find the renderComment function block and the filter bar insertion point
{
  // Add data attrs to bc-comment div
  const old_div = "'<div class=\"bc-comment\" data-comment-id=\"' + c.id + '\">'";
  const new_div = "'<div class=\"bc-comment\" data-comment-id=\"' + c.id + '\" data-user-id=\"' + c.user_id + '\" data-timestamp=\"' + (c.created_at||'') + '\">'";
  must(c.indexOf(old_div), 'comment div');
  c = c.replace(old_div, new_div);

  // Add reply preview before meta + add reply button after meta
  const old_meta = "'<div class=\"bc-comment-meta\"><strong>' + esc(c.user_name) + '</strong> <span>' + timeAgo(c.created_at) + '</span></div>' +\r\n          '<div class=\"bc-comment-text\">' + (c.content || '').replace(/\\n/g, '<br>') + '</div>' +";
  const new_meta =
    "(c.reply_to_id && c.parent_user_name ? '<div class=\"bc-reply-preview\" onclick=\"scrollToComment(' + c.reply_to_id + ')\" title=\"\u041f\u0440\u0435\u043c\u0438\u043d\u0438 \u043a\u044a\u043c \u043e\u0440\u0438\u0433\u0438\u043d\u0430\u043b\u043d\u0438\u044f \u043a\u043e\u043c\u0435\u043d\u0442\u0430\u0440\"><span class=\"bc-reply-preview__author\">\u21a9 ' + esc(c.parent_user_name) + ':</span> <span class=\"bc-reply-preview__text\">' + esc((c.parent_content||'').replace(/<[^>]*>/g,'').slice(0,120)) + (((c.parent_content||'').replace(/<[^>]*>/g,'').length>120)?'\u2026':'') + '</span></div>' : '') +\r\n          '<div class=\"bc-comment-meta\"><strong>' + esc(c.user_name) + '</strong> <span>' + timeAgo(c.created_at) + '</span>" +
    "(canEdit() ? '<button class=\"bc-reply-btn\" onclick=\"replyToComment(' + cardId + ',' + c.id + ',\\'' + esc(c.user_name).replace(/\\'/g,\"\\\\\\\\'\")+\\'\\')\">\u21a9 \u041e\u0442\u0433\u043e\u0432\u043e\u0440\u0438</button>' : '') +" +
    "'</div>' +\r\n          '<div class=\"bc-comment-text\">' + (c.content || '').replace(/\\n/g, '<br>') + '</div>' +";

  // This is getting complex - let me use a simpler approach
  // Instead, find the exact region and replace
  const regionStart = c.indexOf("'<div class=\"bc-comment-meta\"><strong>' + esc(c.user_name)");
  must(regionStart, 'comment meta region');
  const regionEnd = c.indexOf("'<div class=\"bc-comment-actions\">'", regionStart);
  must(regionEnd, 'comment actions region');
  const oldRegion = c.slice(regionStart, regionEnd);

  const newRegion =
    "(c.reply_to_id && c.parent_user_name ? " +
    "'<div class=\"bc-reply-preview\" onclick=\"scrollToComment(' + c.reply_to_id + ')\" title=\"\u041f\u0440\u0435\u043c\u0438\u043d\u0438 \u043a\u044a\u043c \u043e\u0440\u0438\u0433\u0438\u043d\u0430\u043b\u043d\u0438\u044f \u043a\u043e\u043c\u0435\u043d\u0442\u0430\u0440\">" +
    "<span class=\"bc-reply-preview__author\">\u21a9 ' + esc(c.parent_user_name) + ':</span> " +
    "<span class=\"bc-reply-preview__text\">' + esc((c.parent_content||'').replace(/<[^>]*>/g,'').slice(0,120)) + ((c.parent_content||'').replace(/<[^>]*>/g,'').length>120?'\u2026':'') + '</span>" +
    "</div>'" +
    " : '') +\r\n          " +
    "'<div class=\"bc-comment-meta\"><strong>' + esc(c.user_name) + '</strong> <span>' + timeAgo(c.created_at) + '</span>" +
    "<button class=\"bc-reply-btn\" onclick=\"replyToComment(' + cardId + ',' + c.id + ',\\'' + esc(c.user_name) + '\\')\">\u21a9 \u041e\u0442\u0433\u043e\u0432\u043e\u0440\u0438</button>" +
    "</div>' +\r\n          '<div class=\"bc-comment-text\">' + (c.content || '').replace(/\\n/g, '<br>') + '</div>' +\r\n          ";

  c = c.slice(0, regionStart) + newRegion + c.slice(regionEnd);
  console.log('7. reply preview + reply button added');
}

// ── 8. Add filter bar before commentsListHtml ─────────────────────────────────
{
  const anchor = "commentsListHtml = '<div class=\"bc-comments-list\" id=\"commentsList\">';";
  must(c.indexOf(anchor), 'commentsListHtml anchor');

  // Build list of unique commenters for the select
  const filterBar =
    "      var uniqueUsers = {};\r\n" +
    "      comments.forEach(function(cm) { uniqueUsers[cm.user_id] = cm.user_name; });\r\n" +
    "      var userOpts = Object.keys(uniqueUsers).map(function(uid) {\r\n" +
    "        return '<option value=\"' + uid + '\">' + esc(uniqueUsers[uid]) + '</option>';\r\n" +
    "      }).join('');\r\n" +
    "      commentsListHtml += '<div class=\"bc-comments-filter\">' +\r\n" +
    "        '<div class=\"bc-filter-tabs\">' +\r\n" +
    "        '<button class=\"bc-filter-tab active\" data-sort=\"desc\" onclick=\"setCommentSort(\\x27desc\\x27)\">\u2193 \u041d\u043e\u0432\u0438</button>' +\r\n" +
    "        '<button class=\"bc-filter-tab\" data-sort=\"asc\" onclick=\"setCommentSort(\\x27asc\\x27)\">\u2191 \u0421\u0442\u0430\u0440\u0438</button>' +\r\n" +
    "        '</div>' +\r\n" +
    "        '<select class=\"bc-filter-user-select\" onchange=\"setCommentUser(this.value)\">' +\r\n" +
    "        '<option value=\"\">\u0412\u0441\u0438\u0447\u043a\u0438</option>' + userOpts +\r\n" +
    "        '</select>' +\r\n" +
    "        '</div>';\r\n";

  c = c.replace(anchor, filterBar + "      " + anchor);
  console.log('8. filter bar added');
}

// ── 9. addComment: send reply_to_id ──────────────────────────────────────────
{
  const old_body = "body:JSON.stringify({content:c,mentions:mIds})";
  must(c.indexOf(old_body), 'addComment body');
  c = c.replace(old_body, "body:JSON.stringify({content:c,mentions:mIds,reply_to_id:_replyToComment?_replyToComment.id:null})");
  console.log('9. addComment reply_to_id done');
}

// ── 10. collapseCommentInput: also cancel reply ───────────────────────────────
{
  const old_collapse = "function collapseCommentInput() {\r\n  var placeholder = document.querySelector('.bc-comment-placeholder');\r\n  var wrap = document.getElementById('commentEditorWrap');\r\n  if (placeholder) placeholder.style.display = '';\r\n  if (wrap) wrap.classList.remove('expanded');\r\n}";
  must(c.indexOf(old_collapse), 'collapseCommentInput');
  const new_collapse = "function collapseCommentInput() {\r\n  var placeholder = document.querySelector('.bc-comment-placeholder');\r\n  var wrap = document.getElementById('commentEditorWrap');\r\n  if (placeholder) placeholder.style.display = '';\r\n  if (wrap) wrap.classList.remove('expanded');\r\n  cancelReply();\r\n}";
  c = c.replace(old_collapse, new_collapse);
  console.log('10. collapseCommentInput updated');
}

// ── 11. New functions: reply, filter, scroll ──────────────────────────────────
{
  const anchor = '\r\nasync function addComment(cardId)';
  must(c.indexOf(anchor), 'addComment anchor');

  const newFns = [
    '',
    'function replyToComment(cardId, commentId, userName) {',
    '  _replyToComment = { id: commentId, userName: userName };',
    '  expandCommentInput();',
    '  var badge = document.getElementById(\'replyBadge\');',
    '  if (badge) {',
    '    badge.style.display = \'flex\';',
    '    var nameEl = badge.querySelector(\'.bc-reply-badge__name\');',
    '    if (nameEl) nameEl.textContent = userName;',
    '  }',
    '  var wrap = document.getElementById(\'commentEditorWrap\');',
    '  if (wrap) setTimeout(function() { wrap.scrollIntoView({ behavior: \'smooth\', block: \'nearest\' }); }, 100);',
    '}',
    '',
    'function cancelReply() {',
    '  _replyToComment = null;',
    '  var badge = document.getElementById(\'replyBadge\');',
    '  if (badge) badge.style.display = \'none\';',
    '}',
    '',
    'function scrollToComment(commentId) {',
    '  var el = document.querySelector(\'[data-comment-id="\' + commentId + \'"]\');',
    '  if (!el) return;',
    '  el.scrollIntoView({ behavior: \'smooth\', block: \'center\' });',
    '  el.classList.add(\'bc-comment--highlight\');',
    '  setTimeout(function() { el.classList.remove(\'bc-comment--highlight\'); }, 2000);',
    '}',
    '',
    'function setCommentSort(order) {',
    '  _commentSortOrder = order;',
    '  document.querySelectorAll(\'.bc-filter-tab\').forEach(function(btn) {',
    '    btn.classList.toggle(\'active\', btn.dataset.sort === order);',
    '  });',
    '  applyCommentFilter();',
    '}',
    '',
    'function setCommentUser(userId) {',
    '  _commentFilterUserId = userId || null;',
    '  applyCommentFilter();',
    '}',
    '',
    'function applyCommentFilter() {',
    '  var list = document.getElementById(\'commentsList\');',
    '  if (!list) return;',
    '  // Move any hidden comments into the list first',
    '  var hidden = document.getElementById(\'hiddenComments\');',
    '  if (hidden) {',
    '    Array.from(hidden.querySelectorAll(\'.bc-comment\')).forEach(function(el) { list.appendChild(el); });',
    '    hidden.remove();',
    '  }',
    '  var moreBtn = document.getElementById(\'showMoreCommentsBtn\');',
    '  if (moreBtn) moreBtn.remove();',
    '  var comments = Array.from(list.querySelectorAll(\'.bc-comment\'));',
    '  // Filter by user',
    '  comments.forEach(function(el) {',
    '    var show = !_commentFilterUserId || el.dataset.userId === String(_commentFilterUserId);',
    '    el.style.display = show ? \'\' : \'none\';',
    '  });',
    '  // Sort',
    '  var visible = comments.filter(function(el) { return el.style.display !== \'none\'; });',
    '  visible.sort(function(a, b) {',
    '    var ta = a.dataset.timestamp || \'\', tb = b.dataset.timestamp || \'\';',
    '    return _commentSortOrder === \'asc\' ? ta.localeCompare(tb) : tb.localeCompare(ta);',
    '  });',
    '  visible.forEach(function(el) { list.appendChild(el); });',
    '}'
  ].join('\r\n');

  c = c.slice(0, c.indexOf(anchor)) + newFns + c.slice(c.indexOf(anchor));
  console.log('11. new functions added');
}

// ── Validate and save ─────────────────────────────────────────────────────────
try {
  new Function(c);
  console.log('SYNTAX OK');
} catch(e) {
  console.error('SYNTAX ERROR:', e.message);
  // Find approximate location
  const lines = c.split('\n');
  const match = e.message.match(/line (\d+)/i);
  if (match) {
    const ln = parseInt(match[1]);
    console.error('Around line', ln, ':', lines.slice(Math.max(0,ln-3), ln+2).join('\n'));
  }
  process.exit(1);
}

fs.writeFileSync(appPath, c, 'utf8');
console.log('Saved. Length:', c.length);
