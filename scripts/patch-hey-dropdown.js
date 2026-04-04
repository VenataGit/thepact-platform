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

// ── 1. Add _heyAllItems global ────────────────────────────────────────────────
{
  const old = 'var _pinnedSidebarScrollTop = 0;';
  must(c.indexOf(old), '_heyAllItems anchor');
  c = c.replace(old, old + CR + 'var _heyAllItems = [];');
  console.log('1. Added _heyAllItems global');
}

// ── 2. Replace populateHey and insert helpers ─────────────────────────────────
{
  const funcStart = c.indexOf('\nasync function populateHey(el) {');
  const funcEnd   = c.indexOf('\nasync function markAllHeyRead(e)');
  must(funcStart, 'populateHey start');
  must(funcEnd,   'populateHey end');

  const newBlock =
    CR + 'async function populateHey(el) {' + CR +
    '  try {' + CR +
    '    const items = await (await fetch(\'/api/notifications\')).json();' + CR +
    '    _heyAllItems = items;' + CR +
    '    const unreadCount = items.filter(n => !n.is_read).length;' + CR +
    '    if (items.length === 0) {' + CR +
    '      el.innerHTML = \'<div class="nav-dropdown__empty" style="padding:24px 16px">\u041d\u044f\u043c\u0430 \u043d\u0438\u0449\u043e \u043d\u043e\u0432\u043e \u0437\u0430 \u0442\u0435\u0431.</div>\';' + CR +
    '      return;' + CR +
    '    }' + CR +
    '    var headerHtml = \'<div class="hey-header">\' +' + CR +
    '      \'<span class="hey-header__title">\u041d\u043e\u0432\u043e \u0437\u0430 \u0442\u0435\u0431\' + (unreadCount > 0 ? \' (\' + unreadCount + \')\' : \'\') + \'</span>\' +' + CR +
    '      (unreadCount > 0 ? \'<button class="hey-header__action" onclick="markAllHeyRead(event)">\u041c\u0430\u0440\u043a\u0438\u0440\u0430\u0439 \u0432\u0441\u0438\u0447\u043a\u0438</button>\' : \'\') +' + CR +
    '    \'</div>\';' + CR +
    '    var first30 = items.slice(0, 30);' + CR +
    '    var html = headerHtml + first30.map(_renderHeyItem).join(\'\');' + CR +
    '    if (items.length > 30) {' + CR +
    '      html += \'<div class="hey-load-more"><button class="hey-load-more__btn" onclick="heyExpandMore()">\u0412\u0438\u0436 \u0432\u0441\u0438\u0447\u043a\u0438 \u043e\u0441\u0442\u0430\u043d\u0430\u043b\u0438 \u0438\u0437\u0432\u0435\u0441\u0442\u0438\u044f \u2193</button></div>\';' + CR +
    '    }' + CR +
    '    el.innerHTML = html;' + CR +
    '  } catch { el.innerHTML = \'<div class="nav-dropdown__empty">\u0413\u0440\u0435\u0448\u043a\u0430</div>\'; }' + CR +
    '}' + CR +
    'function _renderHeyItem(n) {' + CR +
    '  var sn = n.sender_name || \'\';' + CR +
    '  var av = sn ? initials(sn) : \'?\';' + CR +
    '  var link = n.reference_type === \'card\' ? \'#/card/\' + n.reference_id : \'#/notifications\';' + CR +
    '  var sid = (n.reference_type === \'card\' && n.comment_id) ? n.comment_id : null;' + CR +
    '  return \'<a class="hey-item\' + (n.is_read ? \'\' : \' unread\') + \'" href="\' + link + \'" onclick="if(\' + sid + \'){_pendingScrollCommentId=\' + sid + \';}closeAllDropdowns()">\' +' + CR +
    '    \'<div class="hey-item__av">\' + av + \'</div>\' +' + CR +
    '    \'<div class="hey-item__content">\' +' + CR +
    '      \'<div class="hey-item__subject">\' + esc(n.title) + \'</div>\' +' + CR +
    '      (n.body ? \'<div class="hey-item__preview">\' + esc(n.body) + \'</div>\' : \'\') +' + CR +
    '      \'<div class="hey-item__meta">\' + timeAgo(n.created_at) + \'</div>\' +' + CR +
    '    \'</div>\' +' + CR +
    '    (!n.is_read ? \'<div class="hey-item__unread-dot"></div>\' : \'\') +' + CR +
    '  \'</a>\';' + CR +
    '}' + CR +
    'function heyExpandMore() {' + CR +
    '  var el = document.getElementById(\'heyDropdown\');' + CR +
    '  if (!el) return;' + CR +
    '  var btn = el.querySelector(\'.hey-load-more\');' + CR +
    '  if (!btn) return;' + CR +
    '  var next15 = _heyAllItems.slice(30, 45);' + CR +
    '  var html = next15.map(_renderHeyItem).join(\'\');' + CR +
    '  html += \'<a class="hey-footer-link" href="#/notifications" onclick="closeAllDropdowns()">\u0412\u0438\u0436 \u0432\u0441\u0438\u0447\u043a\u0438 \u043f\u0440\u043e\u0447\u0435\u0442\u0435\u043d\u0438 \u0438\u0437\u0432\u0435\u0441\u0442\u0438\u044f \u2192</a>\';' + CR +
    '  btn.insertAdjacentHTML(\'afterend\', html);' + CR +
    '  btn.remove();' + CR +
    '}';

  c = c.slice(0, funcStart) + newBlock + c.slice(funcEnd);
  console.log('2. Rewrote populateHey + added _renderHeyItem + heyExpandMore');
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
