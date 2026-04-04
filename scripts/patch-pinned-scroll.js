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

// ── 1. Add global _pinnedSidebarScrollTop ─────────────────────────────────────
{
  const old = 'var _pendingScrollCommentId = null;';
  const neu = 'var _pendingScrollCommentId = null;' + CR +
              'var _pinnedSidebarScrollTop = 0;';
  must(c.indexOf(old), '_pendingScrollCommentId global');
  c = c.replace(old, neu);
  console.log('1. _pinnedSidebarScrollTop global added');
}

// ── 2. Save sidebar scroll before innerHTML, restore + bind after ─────────────
// Insertion point: right after el.innerHTML = ... (before toolbar setup)
{
  const old = '    // Populate card toolbar with action buttons' + CR +
              '    setupCardPageToolbar(card, col, editing);';
  const neu =
    '    // Restore pinned sidebar scroll position after re-render' + CR +
    '    var _psb = el.querySelector(\'.bc-pinned-sidebar\');' + CR +
    '    if (_psb) {' + CR +
    '      _psb.scrollTop = _pinnedSidebarScrollTop;' + CR +
    '      _psb.addEventListener(\'scroll\', function() { _pinnedSidebarScrollTop = this.scrollTop; }, { passive: true });' + CR +
    '    }' + CR + CR +
    '    // Populate card toolbar with action buttons' + CR +
    '    setupCardPageToolbar(card, col, editing);';
  must(c.indexOf(old), 'Populate card toolbar comment');
  c = c.replace(old, neu);
  console.log('2. Sidebar scroll restore + listener added after innerHTML');
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
