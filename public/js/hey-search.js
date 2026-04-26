// ==================== HEY NOTIFICATIONS ====================
async function updateHeyBadge() {
  try {
    const { count } = await (await fetch('/api/notifications/unread-count')).json();
    const b = document.getElementById('heyBadge');
    if (count > 0) { b.textContent = count > 99 ? '99+' : count; b.style.display = ''; } else b.style.display = 'none';
  } catch {}
}

// ==================== NAV DROPDOWNS ====================
let openDropdownId = null;
function toggleDropdown(id, btn, e) {
  if (e) e.stopPropagation();
  const dd = document.getElementById(id);
  if (openDropdownId === id) { closeAllDropdowns(); return; }
  closeAllDropdowns();
  // Populate content
  if (id === 'heyDropdown') populateHey(dd);
  else if (id === 'pingsDropdown') populatePings(dd);
  else if (id === 'moreDropdown') populateMore(dd);
  else if (id === 'findDropdown') populateFind(dd);
  dd.classList.add('open');
  openDropdownId = id;
  setTimeout(() => document.addEventListener('click', closeAllDropdowns, { once: true }), 10);
}
function closeAllDropdowns() {
  document.querySelectorAll('.nav-dropdown.open').forEach(d => d.classList.remove('open'));
  openDropdownId = null;
}

async function populateHey(el) {
  try {
    const items = await (await fetch('/api/notifications')).json();
    _heyAllItems = items;
    const bookmarked = items.filter(n => n.is_bookmarked);
    const regular = items.filter(n => !n.is_bookmarked);
    const unread = regular.filter(n => !n.is_read);
    const read = regular.filter(n => n.is_read);
    if (items.length === 0) {
      el.innerHTML = '<div class="nav-dropdown__empty" style="padding:24px 16px">Няма нищо ново за теб.</div>';
      return;
    }
    var headerHtml = '<div class="hey-header">' +
      '<span class="hey-header__title">Известия' + (unread.length > 0 ? ' (' + unread.length + ' нови)' : '') + '</span>' +
      (unread.length > 0 ? '<button class="hey-header__action" onclick="markAllHeyRead(event)">Маркирай всички</button>' : '') +
    '</div>';
    var html = headerHtml;
    // Bookmarked section
    if (bookmarked.length > 0) {
      html += '<div class="hey-bookmarks-section">' +
        '<div class="hey-bookmarks-header"><img src="/img/icon-bookmark.png" alt="" width="14" height="14"> Не забравяй за:</div>' +
        bookmarked.map(function(n){ return _renderHeyItem(n, true); }).join('') +
      '</div>';
    }
    // Unread (new) notifications — always on top
    if (unread.length > 0) {
      html += '<div class="hey-section-label hey-section-label--new">Нови</div>';
      html += unread.map(function(n){ return _renderHeyItem(n, false); }).join('');
    }
    // Read notifications — below
    if (read.length > 0) {
      html += '<div class="hey-section-label hey-section-label--read">Прочетени</div>';
      var readSlice = read.slice(0, 20);
      html += readSlice.map(function(n){ return _renderHeyItem(n, false); }).join('');
      if (read.length > 20) {
        html += '<div class="hey-load-more"><button class="hey-load-more__btn" onclick="heyExpandMore()">Виж още (' + (read.length - 20) + ') ↓</button></div>';
      }
    }
    if (unread.length === 0 && read.length === 0 && bookmarked.length > 0) {
      html += '<div class="nav-dropdown__empty" style="padding:16px">Няма други известия.</div>';
    }
    el.innerHTML = html;
  } catch { el.innerHTML = '<div class="nav-dropdown__empty">Грешка</div>'; }
}
function _renderHeyItem(n, isInBookmarkSection) {
  var sn = n.sender_name || '';
  var savUrl = _findAvatar(sn);
  var link = n.reference_type === 'card' ? '#/card/' + n.reference_id : '#/notifications';
  var sid = (n.reference_type === 'card' && n.comment_id) ? n.comment_id : null;
  var bmClass = n.is_bookmarked ? ' hey-item--bookmarked' : '';
  return '<div class="hey-item-wrap' + bmClass + '">' +
    '<a class="hey-item' + (n.is_read ? '' : ' unread') + '" href="' + link + '" onclick="heyClickItem('+n.id+','+sid+');closeAllDropdowns()">' +
      '<div class="hey-item__av" style="background:' + (savUrl ? 'none' : _avColor(sn)) + '">' + _avInner(sn, savUrl) + '</div>' +
      '<div class="hey-item__content">' +
        '<div class="hey-item__subject">' + esc(n.title) + '</div>' +
        (n.body ? '<div class="hey-item__preview">' + esc(n.body) + '</div>' : '') +
        '<div class="hey-item__meta">' + (n.type === 'reminder' ? 'Напомняне · ' : '') + timeAgo(n.created_at) + '</div>' +
      '</div>' +
      (!n.is_read ? '<div class="hey-item__unread-dot"></div>' : '') +
    '</a>' +
    '<button class="hey-item__bookmark' + (n.is_bookmarked ? ' active' : '') + '" onclick="event.stopPropagation();heyToggleBookmark('+n.id+')" title="' + (n.is_bookmarked ? 'Махни от Не забравяй' : 'Не забравяй') + '">' +
      '<img src="/img/icon-bookmark.png" alt="" width="16" height="16">' +
    '</button>' +
  '</div>';
}
function heyClickItem(notifId, commentId) {
  if (commentId) _pendingScrollCommentId = commentId;
  if (notifId) { fetch('/api/notifications/'+notifId+'/read',{method:'PUT'}).then(function(){updateHeyBadge()}).catch(function(){}); }
}
async function heyToggleBookmark(notifId) {
  try {
    await fetch('/api/notifications/'+notifId+'/bookmark',{method:'PUT'});
    updateHeyBadge();
    var dd = document.getElementById('heyDropdown');
    if (dd) populateHey(dd);
  } catch {}
}
function heyExpandMore() {
  var el = document.getElementById('heyDropdown');
  if (!el) return;
  var btn = el.querySelector('.hey-load-more');
  if (!btn) return;
  var read = _heyAllItems.filter(function(n){return !n.is_bookmarked && n.is_read});
  var rest = read.slice(20);
  var html = rest.map(function(n){return _renderHeyItem(n, false)}).join('');
  html += '<a class="hey-footer-link" href="#/notifications" onclick="closeAllDropdowns()">Виж всички известия →</a>';
  btn.insertAdjacentHTML('afterend', html);
  btn.remove();
}
async function markAllHeyRead(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  try {
    await fetch('/api/notifications/read-all', { method: 'PUT' });
    updateHeyBadge();
    const dd = document.getElementById('heyDropdown');
    if (dd?.classList.contains('open')) populateHey(dd);
  } catch {}
}

function populateMore(el) {
  el.innerHTML = `
    <div class="nav-dropdown__section">
      <a class="nav-dropdown__item" href="#/activity" onclick="closeAllDropdowns()"><img src="/img/icon-activity.png" alt="" width="16" height="16" class="nav__icon"> Activity</a>
      <a class="nav-dropdown__item" href="#/mystuff" onclick="closeAllDropdowns()"><img src="/img/icon-my-stuff.png" alt="" width="16" height="16" class="nav__icon"> My Stuff</a>
      <a class="nav-dropdown__item" href="#/bookmarks" onclick="closeAllDropdowns()"><img src="/img/icon-bookmark.png" alt="" width="16" height="16" class="nav__icon"> Отметки</a>
      <a class="nav-dropdown__item" href="#/schedule" onclick="closeAllDropdowns()"><div class="item-icon" style="background:var(--blue-dim);color:var(--blue)">📅</div> Моят график</a>
      <a class="nav-dropdown__item" href="#/reports" onclick="closeAllDropdowns()"><div class="item-icon" style="background:var(--red-dim);color:var(--red)">📊</div> Отчети</a>
    </div>
    <div class="nav-dropdown__section" style="border-top:1px solid var(--border)">
      <a class="nav-dropdown__item" href="#/kp-auto" onclick="closeAllDropdowns()"><img src="/img/icon-kp-avto.png" alt="" width="16" height="16" class="nav__icon"> КП-Автоматизация</a>
      <a class="nav-dropdown__item" href="#/dictation" onclick="closeAllDropdowns()"><div class="item-icon" style="background:var(--green-dim,rgba(70,163,116,.18));color:#46a374">🎤</div> Диктовка</a>
      <a class="nav-dropdown__item" href="#/release-notes" onclick="closeAllDropdowns()"><img src="/img/icon-whats-new.png" alt="" width="16" height="16" class="nav__icon"> Какво ново</a>
      <a class="nav-dropdown__item" href="#/trash" onclick="closeAllDropdowns()"><img src="/img/icon-trash.png" alt="" width="16" height="16" class="nav__icon"> Кошче</a>
    </div>
    ${currentUser?.role === 'admin' || currentUser?.role === 'mini_admin' ? `<div class="nav-dropdown__section" style="border-top:1px solid var(--border)">
      <a class="nav-dropdown__item" href="#/admin" onclick="closeAllDropdowns()"><div class="item-icon" style="background:var(--bg-hover);color:var(--text-dim)">⚙️</div> Админ панел</a>
    </div>` : ''}
  `;
}

function populateFind(el) {
  el.innerHTML = `
    <div class="search-overlay" onclick="event.stopPropagation()">
      <input type="search" id="globalSearchInput" placeholder="Търси..." autofocus oninput="doGlobalSearch()">
      <div class="search-filters">
        <select id="searchType"><option value="">Навсякъде</option><option value="card">Карти</option><option value="comment">Коментари</option><option value="message">Съобщения</option></select>
        <select id="searchPerson"><option value="">от Всеки</option>${allUsers.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
        <select id="searchProject"><option value="">Във всички проекти</option>${allBoards.map(b => `<option value="${b.id}">${esc(b.title)}</option>`).join('')}</select>
      </div>
      <div class="search-results" id="searchResults"></div>
    </div>
  `;
  setTimeout(() => document.getElementById('globalSearchInput')?.focus(), 50);
}

async function doGlobalSearch() {
  const q = document.getElementById('globalSearchInput')?.value?.trim();
  const container = document.getElementById('searchResults');
  if (!q || q.length < 2) { container.innerHTML = ''; return; }
  try {
    const boardFilter = document.getElementById('searchProject')?.value || '';
    const { cards, users } = await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
    let filteredCards = cards;
    if (boardFilter) filteredCards = cards.filter(c => c.board_id === parseInt(boardFilter));
    container.innerHTML =
      filteredCards.map(c => `<a class="nav-dropdown__item" href="#/card/${c.id}" onclick="closeAllDropdowns()">${esc(c.title)}<span style="margin-left:auto;font-size:11px;color:var(--text-dim)">${esc(c.board_title)}</span></a>`).join('') +
      users.map(u => `<div class="nav-dropdown__item">${esc(u.name)} <span style="margin-left:auto;font-size:11px;color:var(--text-dim)">${u.role}</span></div>`).join('') +
      (filteredCards.length === 0 && users.length === 0 ? '<div class="nav-dropdown__empty">Няма резултати</div>' : '');
  } catch {}
}
