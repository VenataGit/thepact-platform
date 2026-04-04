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
const sq = String.fromCharCode(39);
const bs = String.fromCharCode(92);

// ── 1. Add fmtDate helper after timeAgo ──────────────────────────────────────
{
  const old = "function timeAgo(d) { const s=Math.floor((Date.now()-new Date(d))/1000); if(s<60)return" + sq + "\u0441\u0435\u0433\u0430" + sq + "; if(s<3600)return Math.floor(s/60)+" + sq + "\u043c" + sq + "; if(s<86400)return Math.floor(s/3600)+" + sq + "\u0447" + sq + "; return Math.floor(s/86400)+" + sq + "\u0434 \u043d\u0430\u0437\u0430\u0434" + sq + "; }";
  const neu = old + CR +
    "function fmtDate(d) {" + CR +
    "  if (!d) return '';" + CR +
    "  var dt = new Date(d);" + CR +
    "  var mo = ['\u042f\u043d','\u0424\u0435\u0432','\u041c\u0430\u0440','\u0410\u043f\u0440','\u041c\u0430\u0439','\u042e\u043d\u0438','\u042e\u043b\u0438','\u0410\u0432\u0433','\u0421\u0435\u043f','\u041e\u043a\u0442','\u041d\u043e\u0435','\u0414\u0435\u043a'];" + CR +
    "  var s = mo[dt.getMonth()] + ' ' + dt.getDate();" + CR +
    "  if (dt.getFullYear() !== new Date().getFullYear()) s += ', ' + dt.getFullYear();" + CR +
    "  return s;" + CR +
    "}";
  must(c.indexOf(old), 'timeAgo function');
  c = c.replace(old, neu);
  console.log('1. fmtDate helper added');
}

// ── 2. Fix editComment to find comment div by data-comment-id ────────────────
{
  const old = "function editComment(cardId, commentId, btn) {" + CR +
    "  var commentDiv = btn.closest('.bc-comment');";
  const neu = "function editComment(cardId, commentId, btn) {" + CR +
    "  var commentDiv = (btn && btn.closest) ? btn.closest('.bc-comment') : document.querySelector('[data-comment-id=\"' + commentId + '\"]');";
  must(c.indexOf(old), 'editComment btn.closest');
  c = c.replace(old, neu);
  console.log('2. editComment updated to find div by data-comment-id when btn is null');
}

// ── 3. Restructure renderComment HTML — Basecamp style ───────────────────────
{
  const old =
    "        return '<div class=\"bc-comment\" data-comment-id=\"' + c.id + '\" data-user-id=\"' + c.user_id + '\" data-timestamp=\"' + (c.created_at||'') + '\">' +" + CR +
    "          '<div class=\"bc-comment-avatar\" style=\"background:' + cc + '\">' + initials(c.user_name) + '</div>' +" + CR +
    "          '<div class=\"bc-comment-body\">' +" + CR +
    "          (c.reply_to_id && c.parent_user_name ? '<div class=\"bc-reply-preview\" onclick=\"scrollToComment(' + c.reply_to_id + ')\" title=\"\u041f\u0440\u0435\u043c\u0438\u043d\u0438 \u043a\u044a\u043c \u043e\u0440\u0438\u0433\u0438\u043d\u0430\u043b\u043d\u0438\u044f \u043a\u043e\u043c\u0435\u043d\u0442\u0430\u0440\"><span class=\"bc-reply-preview__author\">\u21a9 ' + esc(c.parent_user_name) + ':</span> <span class=\"bc-reply-preview__text\">' + esc((c.parent_content||'').replace(/<[^>]*>/g,'').slice(0,120)) + ((c.parent_content||'').replace(/<[^>]*>/g,'').length>120?'\u2026':'') + '</span></div>' : '') +" + CR +
    "          '<div class=\"bc-comment-meta\"><strong>' + esc(c.user_name) + '</strong> <span>' + timeAgo(c.created_at) + '</span><button class=\"bc-reply-btn\" onclick=\"replyToComment(' + cardId + ',' + c.id + ',\\'' + esc(c.user_name) + '\\')\">↩ \u041e\u0442\u0433\u043e\u0432\u043e\u0440\u0438</button></div>' +" + CR +
    "          '<div class=\"bc-comment-text\">' + (c.content || '').replace(/\\n/g, '<br>') + '</div>' +" + CR +
    "          '<div class=\"bc-comment-actions\">' +" + CR +
    "          (isOwn ? '<button class=\"bc-comment-action\" onclick=\"editComment(' + cardId + ',' + c.id + ',this)\">\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0430\u0439</button>' : '') +" + CR +
    "          (isOwn ? '<button class=\"bc-comment-action bc-comment-action--danger\" onclick=\"deleteComment(' + cardId + ',' + c.id + ')\">\u0418\u0437\u0442\u0440\u0438\u0439</button>' : '') +" + CR +
    "          '<button class=\"bc-comment-action bc-comment-action--pin\" onclick=\"pinComment(' + cardId + ',' + c.id + ')\">' + (isPinned ? '\u041e\u0442\u043a\u0430\u0447\u0438' : '\\ud83d\\udccc \u0417\u0430\u043a\u0430\u0447\u0438') + '</button>' +" + CR +
    "          '</div></div></div>';";

  const neu =
    "        return '<div class=\"bc-comment\" data-comment-id=\"' + c.id + '\" data-user-id=\"' + c.user_id + '\" data-timestamp=\"' + (c.created_at||'') + '\">' +" + CR +
    "          '<div class=\"bc-comment-date\">' + fmtDate(c.created_at) + '</div>' +" + CR +
    "          '<div class=\"bc-comment-avatar\" style=\"background:' + cc + '\">' + initials(c.user_name) + '</div>' +" + CR +
    "          '<div class=\"bc-comment-body\">' +" + CR +
    "          '<div class=\"bc-comment-meta\"><strong>' + esc(c.user_name) + '</strong></div>' +" + CR +
    "          (c.reply_to_id && c.parent_user_name ? '<div class=\"bc-reply-preview\" onclick=\"scrollToComment(' + c.reply_to_id + ')\" title=\"\u041f\u0440\u0435\u043c\u0438\u043d\u0438 \u043a\u044a\u043c \u043e\u0440\u0438\u0433\u0438\u043d\u0430\u043b\u043d\u0438\u044f \u043a\u043e\u043c\u0435\u043d\u0442\u0430\u0440\"><span class=\"bc-reply-preview__author\">\u21a9 ' + esc(c.parent_user_name) + ':</span> <span class=\"bc-reply-preview__text\">' + esc((c.parent_content||'').replace(/<[^>]*>/g,'').slice(0,120)) + ((c.parent_content||'').replace(/<[^>]*>/g,'').length>120?'\u2026':'') + '</span></div>' : '') +" + CR +
    "          '<div class=\"bc-comment-text\">' + (c.content || '').replace(/\\n/g, '<br>') + '</div>' +" + CR +
    "          '<button class=\"bc-reply-btn\" onclick=\"replyToComment(' + cardId + ',' + c.id + ',\\'' + esc(c.user_name) + '\\')\">\\u21a9 \u041e\u0442\u0433\u043e\u0432\u043e\u0440\u0438</button>' +" + CR +
    "          '</div>' +" + CR +
    "          '<div class=\"bc-comment-dots\">' +" + CR +
    "          '<button class=\"bc-comment-dots-btn\" onclick=\"toggleCommentMenu(event,' + cardId + ',' + c.id + ',' + isOwn + ',' + isPinned + ')\">\\u22ef</button>' +" + CR +
    "          '</div>' +" + CR +
    "          '</div>';";

  must(c.indexOf(old), 'renderComment HTML block');
  c = c.replace(old, neu);
  console.log('3. renderComment restructured to Basecamp style');
}

// ── 4. Update commentAddHtml placeholder text ─────────────────────────────────
{
  const old = "'<div class=\"bc-comment-placeholder\" onclick=\"expandCommentInput()\">\u041d\u0430\u043f\u0438\u0441\u0432\u0430\u0439 \u043a\u043e\u043c\u0435\u043d\u0442\u0430\u0440\\u2026</div>'";
  const neu = "'<div class=\"bc-comment-placeholder\" onclick=\"expandCommentInput()\">\u0414\u043e\u0431\u0430\u0432\u0438 \u043a\u043e\u043c\u0435\u043d\u0442\u0430\u0440 \u0442\u0443\u043a\u2026</div>'";
  must(c.indexOf(old), 'comment placeholder text');
  c = c.replace(old, neu);
  console.log('4. Comment placeholder updated');
}

// ── 5. Update add comment button label ───────────────────────────────────────
{
  const old = "bc-btn-save bc-btn-add-comment\" onclick=\"addComment(' + cardId + ')\">\u0414\u043e\u0431\u0430\u0432\u0438 \u043a\u043e\u043c\u0435\u043d\u0442\u0430\u0440</button><button class=\"bc-btn-discard\" onclick=\"collapseCommentInput()\">\u041e\u0442\u043a\u0430\u0437</button>";
  const neu = "bc-btn-save bc-btn-add-comment\" onclick=\"addComment(' + cardId + ')\">\u0414\u043e\u0431\u0430\u0432\u0438 \u0442\u043e\u0437\u0438 \u043a\u043e\u043c\u0435\u043d\u0442\u0430\u0440</button><button class=\"bc-btn-discard\" onclick=\"collapseCommentInput()\">\u041e\u0442\u043a\u0430\u0437</button>";
  must(c.indexOf(old), 'add comment button label');
  c = c.replace(old, neu);
  console.log('5. Add comment button label updated');
}

// ── 6. Add toggleCommentMenu function ─────────────────────────────────────────
{
  const anchor = "function editComment(cardId, commentId, btn) {";
  must(c.indexOf(anchor), 'editComment for menu insertion');

  const menu =
    "function toggleCommentMenu(e, cardId, commentId, isOwn, isPinned) {" + CR +
    "  e.stopPropagation();" + CR +
    "  document.querySelectorAll('.bc-comment-ctx-menu').forEach(function(m) { m.remove(); });" + CR +
    "  var menu = document.createElement('div');" + CR +
    "  menu.className = 'bc-comment-ctx-menu';" + CR +
    "  function addItem(label, fn, danger) {" + CR +
    "    var btn = document.createElement('button');" + CR +
    "    btn.className = 'bc-comment-ctx-item' + (danger ? ' bc-comment-ctx-item--danger' : '');" + CR +
    "    btn.textContent = label;" + CR +
    "    btn.onclick = function(ev) { ev.stopPropagation(); menu.remove(); fn(); };" + CR +
    "    menu.appendChild(btn);" + CR +
    "  }" + CR +
    "  addItem('\u21a9 \u041e\u0442\u0433\u043e\u0432\u043e\u0440\u0438', function() { var nm = ''; var cd = document.querySelector('[data-comment-id=\"' + commentId + '\"]'); if (cd) { var st = cd.querySelector('.bc-comment-meta strong'); if (st) nm = st.textContent; } replyToComment(cardId, commentId, nm); });" + CR +
    "  addItem('\ud83d\udccc ' + (isPinned ? '\u041e\u0442\u043a\u0430\u0447\u0438' : '\u0417\u0430\u043a\u0430\u0447\u0438'), function() { pinComment(cardId, commentId); });" + CR +
    "  if (isOwn) {" + CR +
    "    var sep = document.createElement('div'); sep.className = 'bc-comment-ctx-sep'; menu.appendChild(sep);" + CR +
    "    addItem('\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0430\u0439', function() { editComment(cardId, commentId, null); });" + CR +
    "    addItem('\u0418\u0437\u0442\u0440\u0438\u0439', function() { deleteComment(cardId, commentId); }, true);" + CR +
    "  }" + CR +
    "  document.body.appendChild(menu);" + CR +
    "  var rect = e.currentTarget.getBoundingClientRect();" + CR +
    "  menu.style.position = 'fixed';" + CR +
    "  menu.style.top = (rect.bottom + 4) + 'px';" + CR +
    "  menu.style.left = Math.max(8, rect.right - 180) + 'px';" + CR +
    "  menu.style.zIndex = '9999';" + CR +
    "  setTimeout(function() { document.addEventListener('click', function cl() { menu.remove(); document.removeEventListener('click', cl); }); }, 0);" + CR +
    "}" + CR + CR;

  c = c.replace(anchor, menu + anchor);
  console.log('6. toggleCommentMenu function added');
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
