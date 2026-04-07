// ==================== UTILITIES ====================
// Споделени помощни функции — escape, date formatting, deadline helpers,
// avatar helpers, keyboard shortcuts.

function initials(name) { return name?.split(' ').map(n => n[0]).join('').substring(0, 2) || '?'; }
function _avColor(n) { return _avColors[(n||'').length % _avColors.length]; }
function _avInner(name, url) { return url ? '<img src="'+url+'" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block">' : initials(name); }
function _findAvatar(name) { var u = (allUsers||[]).find(function(x){return x.name===name}); return u ? u.avatar_url : null; }

function esc(s) { if(!s)return''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatDate(d) { if(!d)return''; const s=d.split('T')[0]; const[y,m,dd]=s.split('-'); return`${dd}.${m}.${y}`; }
function getCardColorClass(c) { if(c.is_on_hold)return'on-hold'; if(c.priority==='urgent')return'priority'; var ed=getCardEarliestDeadline(c); if(!ed)return''; var n=new Date();n.setHours(0,0,0,0); var diff=Math.ceil((ed-n)/86400000); if(diff<0)return'overdue'; if(diff===0)return'deadline-today'; if(diff<=4)return'deadline-soon'; return'deadline-ok'; }
// Safe date parser — handles both "2026-04-01" and "2026-04-01T00:00:00.000Z"
function _parseDateMidnight(d) {
  if (!d) return null;
  return new Date(d.toString().split('T')[0] + 'T00:00:00');
}
// Get ALL relevant deadline dates for a card (due_on + board-specific date)
function getCardRelevantDates(card) {
  var dates = [];
  if (card.due_on) dates.push(card.due_on);
  var bt = (card.board_title || '').toLowerCase();
  if (bt.indexOf('pre') !== -1 && card.brainstorm_date) dates.push(card.brainstorm_date);
  else if (bt.indexOf('post') !== -1 && card.editing_date) dates.push(card.editing_date);
  else if (bt.indexOf('production') !== -1 && card.filming_date) dates.push(card.filming_date);
  else if ((bt.indexOf('акаунт') !== -1 || bt.indexOf('account') !== -1) && card.upload_date) dates.push(card.upload_date);
  return dates;
}
// Check if card has ANY overdue deadline
function isCardOverdue(card, now) {
  if (card.is_on_hold || card.completed_at || card.archived_at) return false;
  return getCardRelevantDates(card).some(function(d) { return _parseDateMidnight(d) < now; });
}
// Timer-specific overdue — only board-specific production dates (not due_on unless configured)
function isCardOverdueForTimer(card, now) {
  if (card.is_on_hold || card.completed_at || card.archived_at) return false;
  var checkDueOn = _platformConfig.timer_checks_due_on === 'true';
  var dates = [];
  if (checkDueOn && card.due_on) dates.push(card.due_on);
  var bt = (card.board_title || '').toLowerCase();
  if (bt.indexOf('pre') !== -1 && card.brainstorm_date) dates.push(card.brainstorm_date);
  else if (bt.indexOf('post') !== -1 && card.editing_date) dates.push(card.editing_date);
  else if (bt.indexOf('production') !== -1 && card.filming_date) dates.push(card.filming_date);
  else if ((bt.indexOf('акаунт') !== -1 || bt.indexOf('account') !== -1) && card.upload_date) dates.push(card.upload_date);
  return dates.some(function(d) { return _parseDateMidnight(d) < now; });
}
// Check if card has ANY deadline today
function isCardDueToday(card, now, tomorrow) {
  if (card.completed_at || card.archived_at) return false;
  return getCardRelevantDates(card).some(function(d) {
    var dt = _parseDateMidnight(d);
    return dt && dt >= now && dt < tomorrow;
  });
}
// Get earliest deadline for sorting/display
function getCardEarliestDeadline(card) {
  var dates = getCardRelevantDates(card).map(function(d) { return _parseDateMidnight(d); }).filter(Boolean);
  if (dates.length === 0) return null;
  return dates.sort(function(a, b) { return a - b; })[0];
}
function workingDaysUntil(dateStr) {
  if (!dateStr) return null;
  var target = new Date(dateStr.toString().split('T')[0] + 'T00:00:00');
  var today = new Date(); today.setHours(0,0,0,0);
  if (target < today) return -1;
  if (target.getTime() === today.getTime()) return 0;
  var count = 0;
  var d = new Date(today); d.setDate(d.getDate() + 1);
  while (d <= target) { var dow = d.getDay(); if (dow !== 0 && dow !== 6) count++; d.setDate(d.getDate() + 1); }
  return count;
}
function isKpCard(card) {
  return /КП-\d/.test(card.title || '');
}
function getCardDeadlineDate(card) {
  // KP cards: use board-specific production dates
  if (isKpCard(card)) {
    var bt = (card.board_title || '').toLowerCase();
    if (bt.indexOf('pre') !== -1) return card.brainstorm_date || null;
    if (bt.indexOf('post') !== -1) return card.editing_date || null;
    if (bt.indexOf('production') !== -1) return card.filming_date || null;
    if (bt.indexOf('акаунт') !== -1 || bt.indexOf('account') !== -1) return card.upload_date || null;
    // Fallback: use the nearest upcoming production date
    var dates = [card.brainstorm_date, card.filming_date, card.editing_date, card.upload_date, card.publish_date].filter(Boolean);
    if (dates.length > 0) {
      var now = new Date(); now.setHours(0,0,0,0);
      var upcoming = dates.map(function(d){ return new Date(d.toString().split('T')[0]+'T00:00:00'); })
        .filter(function(d){ return d >= now; })
        .sort(function(a,b){ return a-b; });
      return upcoming.length > 0 ? upcoming[0].toISOString().split('T')[0] : dates[dates.length-1];
    }
    return null;
  }
  // Non-KP cards: use due_on (Краен срок)
  return card.due_on || null;
}
function getDeadlineClass(card) {
  var date = getCardDeadlineDate(card);
  if (!date) return 'dl-none';
  var days = workingDaysUntil(date);
  if (days === null) return 'dl-none';
  if (days < 0) return 'dl-black';
  if (days === 0) return 'dl-red';
  if (days <= 4) return 'dl-yellow';
  return 'dl-green';
}
function timeAgo(d) { const s=Math.floor((Date.now()-new Date(d))/1000); if(s<60)return'сега'; if(s<3600)return Math.floor(s/60)+'м'; if(s<86400)return Math.floor(s/3600)+'ч'; return Math.floor(s/86400)+'д назад'; }
function fmtDate(d) {
  if (!d) return '';
  var dt = new Date(d);
  var mo = ['Ян','Фев','Мар','Апр','Май','Юни','Юли','Авг','Сеп','Окт','Ное','Дек'];
  var s = mo[dt.getMonth()] + ' ' + dt.getDate();
  if (dt.getFullYear() !== new Date().getFullYear()) s += ', ' + dt.getFullYear();
  return s;
}

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', (e) => {
  // Don't trigger shortcuts when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) return;

  // Ctrl/Cmd + J/K — open search
  if ((e.ctrlKey || e.metaKey) && (e.key === 'j' || e.key === 'k')) {
    e.preventDefault();
    toggleDropdown('findDropdown', document.querySelector('[data-nav="find"]'));
    return;
  }

  // ? — show shortcuts help
  if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    showShortcutsHelp();
    return;
  }

  // N — new card (only on board view)
  if (e.key === 'n' && location.hash.startsWith('#/board/')) {
    e.preventDefault();
    const boardId = parseInt(location.hash.split('/')[2]);
    const col = allBoards.find(b=>b.id===boardId)?.columns?.find(c=>!c.is_done_column);
    if (col) location.hash = `#/card/0/new?board=${boardId}&column=${col.id}`;
    return;
  }

  // G+key combos — navigate
  if (pendingShortcut === 'g') {
    pendingShortcut = null;
    e.preventDefault();
    if (e.key === 'h') location.hash = '#/home';
    else if (e.key === 'a') location.hash = '#/activity';
    else if (e.key === 'p') location.hash = '#/chat';
    else if (e.key === 'c') location.hash = '#/campfire/1';
    else if (e.key === 's') location.hash = '#/schedule';
    else if (e.key === 'r') location.hash = '#/reports';
    return;
  }
  if (e.key === 'g') { pendingShortcut = 'g'; setTimeout(() => { pendingShortcut = null; }, 1000); return; }

  // Escape — close modals/dropdowns
  if (e.key === 'Escape') {
    closeAllDropdowns();
    document.getElementById('doneSidebarPanel')?.remove();
    closeProfile();
    document.getElementById('shortcutsModal')?.remove();
    document.querySelector('.modal-overlay')?.remove();
    document.querySelectorAll('.kanban-card-context,.board-context-menu,.bc-options-menu').forEach(function(m) { m.remove(); });
  }
});
