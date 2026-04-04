'use strict';
const fs = require('fs');
const path = require('path');
const appPath = path.join(__dirname, '..', 'public', 'js', 'app.js');
let c = fs.readFileSync(appPath, 'utf8');

function must(idx, label) {
  if (idx === -1) { console.error('NOT FOUND:', label); process.exit(1); }
  return idx;
}

const CR = '\r\n';

// ── 1. Pin button: remove canManage() — available to all users ────────────────
{
  const old = "(canManage() ? '<button class=\"bc-comment-action bc-comment-action--pin\" onclick=\"pinComment(' + cardId + ',' + c.id + ')\">' + (isPinned ? '\u041e\u0442\u043a\u0430\u0447\u0438' : '\\ud83d\\udccc \u0417\u0430\u043a\u0430\u0447\u0438') + '</button>' : '') +";
  const neu = "'<button class=\"bc-comment-action bc-comment-action--pin\" onclick=\"pinComment(' + cardId + ',' + c.id + ')\">' + (isPinned ? '\u041e\u0442\u043a\u0430\u0447\u0438' : '\\ud83d\\udccc \u0417\u0430\u043a\u0430\u0447\u0438') + '</button>' +";
  must(c.indexOf(old), 'pin button canManage');
  c = c.replace(old, neu);
  console.log('1. Pin button now available to all users');
}

// ── 2. Add _pendingScrollCommentId global variable ────────────────────────────
{
  const old = 'var _replyToComment = null; // { id, userName }';
  const neu = 'var _replyToComment = null; // { id, userName }' + CR +
              'var _pendingScrollCommentId = null;';
  must(c.indexOf(old), '_replyToComment global');
  c = c.replace(old, neu);
  console.log('2. _pendingScrollCommentId global added');
}

// ── 3. Notification DROPDOWN: set scroll target on click ──────────────────────
{
  const old = "const link = n.reference_type === 'card' ? `#/card/${n.reference_id}` : '#/notifications';\r\n      return `<a class=\"hey-item${n.is_read ? '' : ' unread'}\" href=\"${link}\" onclick=\"closeAllDropdowns()\">";
  const neu = "const link = n.reference_type === 'card' ? `#/card/${n.reference_id}` : '#/notifications';" + CR +
              "      const scrollId = (n.reference_type === 'card' && n.comment_id) ? n.comment_id : null;" + CR +
              "      return `<a class=\"hey-item${n.is_read ? '' : ' unread'}\" href=\"${link}\" onclick=\"if(${scrollId}){_pendingScrollCommentId=${scrollId};}closeAllDropdowns()\">";
  must(c.indexOf(old), 'notification dropdown link onclick');
  c = c.replace(old, neu);
  console.log('3. Notification dropdown scroll target added');
}

// ── 4. Notifications PAGE: set scroll target on click ────────────────────────
{
  const old = "const link = n.reference_type === 'card' ? `#/card/${n.reference_id}` : '#';\r\n          return `<a class=\"hey-item${n.is_read ? '' : ' unread'}\" href=\"${link}\">";
  const neu = "const link = n.reference_type === 'card' ? `#/card/${n.reference_id}` : '#';" + CR +
              "          const scrollId = (n.reference_type === 'card' && n.comment_id) ? n.comment_id : null;" + CR +
              "          return `<a class=\"hey-item${n.is_read ? '' : ' unread'}\" href=\"${link}\"${scrollId ? ` onclick=\"_pendingScrollCommentId=${scrollId}\"` : ''}>";
  must(c.indexOf(old), 'notifications page link onclick');
  c = c.replace(old, neu);
  console.log('4. Notifications page scroll target added');
}

// ── 5. Card page: auto-scroll to comment after render ─────────────────────────
{
  const old = "    setupCardPageToolbar(card, col, editing);\r\n\r\n    // Setup image lightbox + process video/file attachments in view mode";
  const neu = "    setupCardPageToolbar(card, col, editing);" + CR + CR +
    "    // Auto-scroll to comment from notification" + CR +
    "    if (_pendingScrollCommentId) {" + CR +
    "      var _scrollCid = _pendingScrollCommentId;" + CR +
    "      _pendingScrollCommentId = null;" + CR +
    "      var _hc = document.getElementById('hiddenComments');" + CR +
    "      if (_hc) { _hc.style.display = ''; var _sb = document.getElementById('showMoreCommentsBtn'); if (_sb) _sb.style.display = 'none'; }" + CR +
    "      setTimeout(function() {" + CR +
    "        var _cs = document.querySelector('.bc-comments');" + CR +
    "        if (_cs) _cs.scrollIntoView({ behavior: 'smooth', block: 'start' });" + CR +
    "        setTimeout(function() { scrollToComment(_scrollCid); }, 400);" + CR +
    "      }, 200);" + CR +
    "    }" + CR + CR +
    "    // Setup image lightbox + process video/file attachments in view mode";
  must(c.indexOf(old), 'setupCardPageToolbar call + setTimeout');
  c = c.replace(old, neu);
  console.log('5. Auto-scroll to comment after card render added');
}

// ── Validate and save ─────────────────────────────────────────────────────────
try {
  new Function(c);
  console.log('SYNTAX OK');
} catch(e) {
  console.error('SYNTAX ERROR:', e.message);
  process.exit(1);
}
fs.writeFileSync(appPath, c, 'utf8');
console.log('Saved. Length:', c.length);
