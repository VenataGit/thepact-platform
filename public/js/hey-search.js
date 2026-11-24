// ==================== NAV DROPDOWNS ====================
let openDropdownId = null;
function toggleDropdown(id, btn, e) {
  if (e) e.stopPropagation();
  const dd = document.getElementById(id);
  if (openDropdownId === id) { closeAllDropdowns(); return; }
  closeAllDropdowns();
  // Populate content
  if (id === 'moreDropdown') populateMore(dd);
  else if (id === 'findDropdown') populateFind(dd);
  dd.classList.add('open');
  openDropdownId = id;
  setTimeout(() => document.addEventListener('click', closeAllDropdowns, { once: true }), 10);
}
function closeAllDropdowns() {
  document.querySelectorAll('.nav-dropdown.open').forEach(d => d.classList.remove('open'));
  openDropdownId = null;
}

// Собственикът на платформата (Венци) — само той вижда Content агент, Контент стратегия
// и Настройки (Венци, 19.11.2026). Флагът идва от /auth/status; сървърът също пази.
function isPlatformOwner() {
  return !!(typeof currentUser !== 'undefined' && currentUser && currentUser.is_owner);
}

// Overtime засега е само за хората с позиция „Видеограф" (Екип и роли) + собственика,
// за да не виждат останалите инструменти, които не ползват (Венци, 19.11.2026).
function canSeeOvertime() {
  if (typeof currentUser === 'undefined' || !currentUser) return false;
  // + поименно отметнатите в Настройки → ⏱ Overtime (сървърът връща can_overtime) — 24.11.2026.
  return !!currentUser.is_owner || !!currentUser.can_overtime || /видеограф/i.test(currentUser.position_name || '');
}

// Менюто „Още" (подредба по Венци, 19.11.2026): горе — общите страници; под линията —
// само админските. Линията се показва само ако човекът има админски точки.
function populateMore(el) {
  const owner = isPlatformOwner();
  const adminItems = owner ? `
      ${isPageOff('content') ? '' : `<a class="nav-dropdown__item" href="#/content" onclick="closeAllDropdowns()">Content агент</a>`}
      ${isPageOff('strategy') ? '' : `<a class="nav-dropdown__item" href="#/strategy" onclick="closeAllDropdowns()">Контент стратегия</a>`}
      <a class="nav-dropdown__item" href="#/admin" onclick="return sgOpenSettings(event)">Настройки</a>` : '';
  el.innerHTML = `
    <div class="nav-dropdown__section">
      ${isPageOff('create-task') ? '' : `<a class="nav-dropdown__item" href="#/create-task" onclick="closeAllDropdowns()">Създаване на задачи</a>`}
      ${isPageOff('kp-auto') ? '' : `<a class="nav-dropdown__item" href="#/kp-auto" onclick="closeAllDropdowns()">КП Автоматизация</a>`}
      <a class="nav-dropdown__item" href="#" onclick="event.preventDefault();showKpSplit()">Създай задачи по КП</a>
      ${(currentUser && !isPageOff('task-completions')) ? `<a class="nav-dropdown__item" href="#/task-completions" onclick="closeAllDropdowns()">Готови задачи</a>` : ''}
      ${(currentUser && !isPageOff('processes')) ? `<a class="nav-dropdown__item" href="#/processes" onclick="closeAllDropdowns()">Процеси</a>` : ''}
      <a class="nav-dropdown__item" href="#/release-notes" onclick="closeAllDropdowns()">Какво ново</a>
      <!-- Води към страницата на разширението (какво може + какво ново), а самото
           инсталиране става с бутона вътре в нея — там е и линкът към Web Store,
           където разширението е unlisted и се стига само по линк. Нов таб, за да
           не изхвърля човека от платформата. -->
      <a class="nav-dropdown__item" href="/extension.html" target="_blank" rel="noopener" onclick="closeAllDropdowns()">Chrome разширение</a>
      ${isPageOff('history') ? '' : `<a class="nav-dropdown__item" href="#/history" onclick="closeAllDropdowns()">История</a>`}
      ${isPageOff('board-logic') ? '' : `<a class="nav-dropdown__item" href="#/board-logic" onclick="closeAllDropdowns()">Логика на табло</a>`}
      <!-- Overtime винаги последно; вижда се само от видеографите (+ собственика). Венци, 19.11.2026 -->
      ${(canSeeOvertime() && !isPageOff('overtime')) ? `<a class="nav-dropdown__item" href="#/overtime" onclick="closeAllDropdowns()">Overtime</a>` : ''}
    </div>
    ${adminItems ? `<div class="nav-dropdown__section" style="border-top:1px solid var(--border)">${adminItems}
    </div>` : ''}
  `;
}

function populateFind(el) {
  el.innerHTML = `
    <div class="search-overlay" onclick="event.stopPropagation()">
      <input type="search" id="dashSearchInput" placeholder="Търси карта в Dashboard…" autofocus oninput="doDashSearch()">
      <div class="search-results" id="dashSearchResults"><div class="nav-dropdown__empty">Напиши поне 2 букви…</div></div>
    </div>
  `;
  setTimeout(() => document.getElementById('dashSearchInput')?.focus(), 50);
}

// Search the cards currently loaded on the Basecamp dashboard — the normal ones
// (_dashCards) AND the on-hold ones (_dashOnHold, shown with a ⏸ badge), across
// every board/column. Clicking a result opens the card in Basecamp.
function doDashSearch() {
  const q = (document.getElementById('dashSearchInput')?.value || '').trim().toLowerCase();
  const container = document.getElementById('dashSearchResults');
  if (!container) return;
  if (q.length < 2) { container.innerHTML = '<div class="nav-dropdown__empty">Напиши поне 2 букви…</div>'; return; }
  const titles = {};
  ((typeof _dashStruct !== 'undefined' && _dashStruct && _dashStruct.boards) || []).forEach(b => { titles[b.id] = b.title; });
  const results = [];
  const collect = (store, onHold) => {
    if (!store) return;
    Object.keys(store).forEach(bid => {
      Object.values(store[bid] || {}).forEach(cards => (cards || []).forEach(c => {
        if ((c.title || '').toLowerCase().includes(q)) results.push({ c, board: titles[bid] || '', onHold });
      }));
    });
  };
  collect(typeof _dashCards !== 'undefined' ? _dashCards : null, false);
  collect(typeof _dashOnHold !== 'undefined' ? _dashOnHold : null, true);
  if (!results.length) { container.innerHTML = '<div class="nav-dropdown__empty">Няма карти. Отвори Dashboard-а, ако не си на него.</div>'; return; }
  results.sort((a, b) => (a.c.title || '').localeCompare(b.c.title || ''));
  container.innerHTML = results.slice(0, 40).map(r =>
    '<a class="nav-dropdown__item" href="' + esc(r.c.url || '#') + '" target="_blank" rel="noopener" onclick="closeAllDropdowns()">' +
      (r.onHold ? '⏸ ' : '') + esc(r.c.title || '') +
      '<span style="margin-left:auto;font-size:11px;color:var(--text-dim)">' + esc(r.board) + (r.onHold ? ' · On Hold' : '') + '</span></a>'
  ).join('') + (results.length > 40 ? '<div class="nav-dropdown__empty">…и още ' + (results.length - 40) + '</div>' : '');
}
