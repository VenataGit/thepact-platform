// ==================== ROUTER ====================
// Hash-based routing — навигацията е view'ове.
function router() {
  const hash = location.hash || '#/home';
  const parts = hash.split('?')[0].replace('#/', '').split('/');
  const page = parts[0] || 'home';
  const id = parts[1] ? parseInt(parts[1]) : null;
  const sub = parts[2] || null;

  // Highlight active nav
  document.querySelectorAll('.nav__link').forEach(el => el.classList.remove('active'));
  const activeNav = document.querySelector(`[data-nav="${page}"]`) || document.querySelector(`[data-nav="home"]`);
  if (activeNav) activeNav.classList.add('active');

  const el = document.getElementById('pageContent');
  closeAllDropdowns();

  // Reset card edit mode when navigating away from card page
  if (page !== 'card') _cardEditMode = false;

  switch (page) {
    case 'home': return renderHome(el);
    case 'project': return renderProject(el, id);
    case 'videoproduction': return renderProject(el, 1);
    case 'dashboard': return renderDashboard(el);
    case 'board': return id ? renderBoard(el, id) : renderHome(el);
    case 'docs': return id ? renderDocs(el, id, sub ? parseInt(sub) : null) : renderHome(el);
    case 'doc': return id ? renderDocument(el, id) : renderHome(el);
    case 'card':
      if (sub === 'new') return renderCardCreate(el);
      return id ? renderCardPage(el, id) : renderHome(el);
    case 'activity': return renderActivity(el);
    case 'mystuff': return renderMyStuff(el);
    case 'chat': return id ? renderChatChannel(el, id) : renderChatList(el);
    case 'notifications': return renderNotifications(el);
    case 'messages': return renderMessageBoard(el);
    case 'vault': return renderVault(el, id);
    case 'campfire': return renderCampfire(el, id || 1);
    case 'schedule': return renderSchedule(el);
    case 'checkins': return renderCheckins(el);
    case 'admin': return renderAdmin(el);
    case 'reports': return renderReports(el);
    case 'bookmarks': return renderBookmarks(el);
    case 'kp-auto': return renderKpAuto(el);
    case 'calendar': return renderCalendar(el);
    case 'column': return id ? renderColumnView(el, id) : renderHome(el);
    case 'trash': return renderTrash(el);
    case 'release-notes': return renderReleaseNotes(el);
    case 'home-tasks': return renderHomeTasks(el);
    default: return renderHome(el);
  }
}
window.addEventListener('hashchange', router);

function setBreadcrumb(items) {
  const bar = document.getElementById('breadcrumbBar');
  const bc = document.getElementById('breadcrumb');
  const main = document.getElementById('mainArea');
  // Hide breadcrumb bar when no items (home, admin, etc.)
  if (!items || !items.length) {
    bar.classList.add('hidden');
    main.classList.remove('with-breadcrumb');
    bc.innerHTML = '';
    return;
  }
  bar.classList.remove('hidden'); main.classList.add('with-breadcrumb');
  // Skip auto-prepended "Home" — show just current context, Basecamp-style centered link
  var parts = items.slice();
  // Strip any leading "Home" entries so the bar shows only the meaningful context
  while (parts.length && parts[0].href === '#/home') parts.shift();
  // Prefix with a small grid-style icon (Basecamp "Video Production" bar look)
  var html = '<span class="breadcrumb__icon" aria-hidden="true">'
    + '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="1.5" y="1.5" width="4" height="4" rx="0.8"/>'
    + '<rect x="8.5" y="1.5" width="4" height="4" rx="0.8"/>'
    + '<rect x="1.5" y="8.5" width="4" height="4" rx="0.8"/>'
    + '<rect x="8.5" y="8.5" width="4" height="4" rx="0.8"/>'
    + '</svg></span>';
  html += parts.map(function(item, i) {
    if (i === parts.length - 1 || !item.href) return '<span class="current">' + esc(item.label) + '</span>';
    return '<a href="' + item.href + '">' + esc(item.label) + '</a><span class="sep">›</span>';
  }).join('');
  bc.innerHTML = html;
}
