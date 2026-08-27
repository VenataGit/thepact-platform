// ==================== ROUTER ====================
// Hash-based routing — навигацията е view'ове.
function router() {
  const hash = location.hash || '#/dashboard';
  const parts = hash.split('?')[0].replace('#/', '').split('/');
  const page = parts[0] || 'home';
  const id = parts[1] ? parseInt(parts[1]) : null;
  const sub = parts[2] || null;

  // Highlight active nav
  document.querySelectorAll('.nav__link').forEach(el => el.classList.remove('active'));
  const activeNav = document.querySelector(`[data-nav="${page}"]`) || document.querySelector(`[data-nav="dashboard"]`);
  if (activeNav) activeNav.classList.add('active');

  const el = document.getElementById('pageContent');
  closeAllDropdowns();
  // Dashboard-only settings gear + filter (top nav) — hide on every navigation; renderDashboard re-shows them.
  const _dashGear = document.getElementById('navDashSettings');
  if (_dashGear) _dashGear.style.display = 'none';
  const _dashFilterBtn = document.getElementById('navDashFilter');
  if (_dashFilterBtn) _dashFilterBtn.style.display = 'none';
  document.querySelectorAll('.dash-filter-panel').forEach((p) => p.remove());

  // Reset card edit mode when navigating away from card page
  if (page !== 'card') _cardEditMode = false;

  switch (page) {
    case 'home': return renderDashboard(el);
    case 'project': return renderProject(el, id);
    case 'videoproduction': return renderProject(el, 1);
    case 'dashboard': return renderDashboard(el);
    case 'clients': return parts[1] ? renderClientDetail(el, decodeURIComponent(parts[1])) : renderClientsList(el);
    case 'client-schedule': return renderClientSchedule(el);
    case 'board': return id ? renderBoard(el, id) : renderDashboard(el);
    case 'docs': return id ? renderDocs(el, id, sub ? parseInt(sub) : null) : renderDashboard(el);
    case 'doc': return id ? renderDocument(el, id) : renderDashboard(el);
    case 'card':
      if (sub === 'new') return renderCardCreate(el);
      return id ? renderCardPage(el, id) : renderDashboard(el);
    case 'activity': return renderActivity(el);
    case 'mystuff': return renderMyStuff(el);
    case 'chat': return id ? renderChatChannel(el, id) : renderChatList(el);
    case 'notifications': return renderNotifications(el);
    case 'messages': return renderMessageBoard(el);
    case 'msgboard': return id ? renderMsgBoard(el, id) : renderDashboard(el);
    case 'msg': return id ? renderMsgPage(el, id) : renderDashboard(el);
    case 'vault': return renderVault(el, id);
    case 'campfire': return renderCampfire(el, id || 1);
    case 'schedule': return renderSchedule(el);
    case 'checkins': return renderCheckins(el);
    case 'agent': return renderAgentChat(el);
    case 'admin':
      // Историята вече е самостоятелна страница за целия екип, не секция в панела.
      if (parts[1] === 'history') { location.hash = '#/history' + (parts[2] ? '/' + parts[2] : ''); return; }
      return renderSettings(el, parts[1] || null);
    // Старият („Разширени") панел е слят в #/admin — старите линкове водят натам.
    case 'admin-legacy': location.hash = '#/admin'; return;
    case 'history': return renderHistory(el, parts[1] || null);
    case 'reports': return renderReports(el);
    case 'bookmarks': return renderBookmarks(el);
    case 'kp-auto': return renderKpAuto(el);
    case 'calendar': return renderCalendar(el);
    case 'column': return id ? renderColumnView(el, id) : renderDashboard(el);
    case 'trash': return renderTrash(el);
    case 'release-notes': return renderReleaseNotes(el);
    case 'home-tasks': return renderHomeTasks(el);
    case 'create-task': return renderTaskCreator(el);
    // CRM: всичко около сделка е пълна страница, не прозорче.
    case 'crm':
      if (parts[1] === 'new') return renderCrmNew(el);
      return id ? renderCrmDeal(el, id) : renderCrm(el);
    case 'premiere': return renderPremiere(el);
    case 'board-logic': return renderBoardLogic(el);
    case 'time-report': return renderTimeReport(el);
    default: return renderDashboard(el);
  }
}
window.addEventListener('hashchange', router);

function setBreadcrumb(items) {
  // Breadcrumb bar removed globally — every page now looks the same (no context bar
  // above the content). Kept as a no-op that always hides the bar so the 30+ existing
  // callers don't each need changing.
  const bar = document.getElementById('breadcrumbBar');
  const bc = document.getElementById('breadcrumb');
  const main = document.getElementById('mainArea');
  if (bar) bar.classList.add('hidden');
  if (bc) bc.innerHTML = '';
  if (main) main.classList.remove('with-breadcrumb');
}

// Board jump dropdown — lists all boards for quick navigation
function toggleBoardJumpMenu(e) {
  e.stopPropagation();
  var existing = document.getElementById('boardJumpDropdown');
  if (existing) { existing.remove(); return; }
  var boards = (allBoards || []).filter(function(b) { return !b.archived; });
  var dd = document.createElement('div');
  dd.className = 'breadcrumb-jump-dropdown';
  dd.id = 'boardJumpDropdown';
  var html = '<div class="breadcrumb-jump-dropdown__title">Бордове</div>';
  boards.forEach(function(b) {
    var bHref = b.type === 'docs' ? '#/docs/' + b.id : b.type === 'message_board' ? '#/msgboard/' + b.id : '#/board/' + b.id;
    var bIcon = b.type === 'docs' ? '📁 ' : b.type === 'message_board' ? '💬 ' : '';
    html += '<a class="breadcrumb-jump-dropdown__item" href="' + bHref + '">' + bIcon + esc(b.title) + '</a>';
  });
  if (!boards.length) html += '<div class="breadcrumb-jump-dropdown__empty">Няма бордове</div>';
  dd.innerHTML = html;
  var btn = e.currentTarget;
  var bar = document.getElementById('breadcrumbBar');
  // Position dropdown directly under the button
  var btnRect = btn.getBoundingClientRect();
  var barRect = bar.getBoundingClientRect();
  dd.style.left = (btnRect.left - barRect.left) + 'px';
  dd.style.transform = 'none';
  bar.appendChild(dd);
  // Close on any click outside
  setTimeout(function() {
    document.addEventListener('click', function handler(ev) {
      if (!dd.contains(ev.target)) { dd.remove(); document.removeEventListener('click', handler); }
    });
  }, 0);
  // Close when navigating
  dd.addEventListener('click', function(ev) { if (ev.target.tagName === 'A') dd.remove(); });
}
