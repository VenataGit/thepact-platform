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

// ── 1. Restructure pinnedSidebarHtml — fixed header + scrollable body ─────────
{
  const old =
    "      pinnedSidebarHtml = '<div class=\"bc-pinned-sidebar\">' +" + CR +
    "        '<div class=\"bc-pinned-sidebar__title\">\\ud83d\\udccc \\u0417\\u0430\\u043a\\u0430\\u0447\\u0435\\u043d\\u043e</div>' +" + CR +
    "        '<div class=\"bc-pinned-sidebar__content\">' + (pc.content || '').replace(/\\n/g, '<br>') + '</div>' +" + CR +
    "        '<div class=\"bc-pinned-sidebar__meta\">\\u2014 ' + esc(pc.user_name) + ', ' + timeAgo(pc.created_at) + '</div>' +" + CR +
    "        '<button class=\"bc-pinned-sidebar__unpin\" onclick=\"unpinComment(' + cardId + ')\">Откачи</button>' +" + CR +
    "        '</div>';";

  const neu =
    "      pinnedSidebarHtml = '<div class=\"bc-pinned-sidebar\">' +" + CR +
    "        '<div class=\"bc-pinned-sidebar__header\">' +" + CR +
    "          '<span class=\"bc-pinned-sidebar__title\">\\ud83d\\udccc \\u0417\\u0430\\u043a\\u0430\\u0447\\u0435\\u043d\\u043e</span>' +" + CR +
    "          '<button class=\"bc-pinned-sidebar__unpin\" onclick=\"unpinComment(' + cardId + ')\">' +" + CR +
    "            '\\u041e\\u0442\\u043a\\u0430\\u0447\\u0438</button>' +" + CR +
    "        '</div>' +" + CR +
    "        '<div class=\"bc-pinned-sidebar__body\" id=\"pinnedSidebarBody\">' +" + CR +
    "          '<div class=\"bc-pinned-sidebar__content\">' + (pc.content || '').replace(/\\n/g, '<br>') + '</div>' +" + CR +
    "          '<div class=\"bc-pinned-sidebar__meta\">\\u2014 ' + esc(pc.user_name) + ', ' + timeAgo(pc.created_at) + '</div>' +" + CR +
    "        '</div>' +" + CR +
    "        '</div>';";

  must(c.indexOf(old), 'pinnedSidebarHtml block');
  c = c.replace(old, neu);
  console.log('1. pinnedSidebarHtml restructured with fixed header + scrollable body');
}

// ── 2. Update scroll restore to target #pinnedSidebarBody ─────────────────────
{
  const old =
    "    var _psb = el.querySelector('.bc-pinned-sidebar');" + CR +
    "    if (_psb) {" + CR +
    "      _psb.scrollTop = _pinnedSidebarScrollTop;" + CR +
    "      _psb.addEventListener('scroll', function() { _pinnedSidebarScrollTop = this.scrollTop; }, { passive: true });" + CR +
    "    }";

  const neu =
    "    var _psb = document.getElementById('pinnedSidebarBody');" + CR +
    "    if (_psb) {" + CR +
    "      _psb.scrollTop = _pinnedSidebarScrollTop;" + CR +
    "      _psb.addEventListener('scroll', function() { _pinnedSidebarScrollTop = this.scrollTop; }, { passive: true });" + CR +
    "    }";

  must(c.indexOf(old), 'scroll restore code');
  c = c.replace(old, neu);
  console.log('2. Scroll restore targets #pinnedSidebarBody');
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
