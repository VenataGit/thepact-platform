// ==================== ФУНКЦИИ И СТРАНИЦИ (вкл./изкл. от админ панела) ====================
// Списък със страниците, които админ може да скрие от #/admin/pages. Изключено НЕ значи
// изтрито — само не се вижда в „Още" и директен линк/бутон връща към Dashboard. Ядрото
// на приложението (Табло, Календар, Настройки) нарочно го няма тук — самозаключване.
var PAGE_TOGGLES = [
  { id: 'kp-auto', label: 'КП-Автоматизация' },
  { id: 'create-task', label: 'Създаване на задачи' },
  { id: 'board-logic', label: 'Логика на табло' },
  { id: 'history', label: 'История' },
  { id: 'content', label: 'Content агент' },
  { id: 'strategy', label: 'Контент стратегия' },
  { id: 'time-report', label: 'Време' },
  { id: 'client-report', label: 'Статистика' },
  { id: 'task-completions', label: 'Готови задачи' },
  { id: 'overtime', label: 'Overtime' },
  { id: 'processes', label: 'Процеси' },
];
function isPageOff(id) {
  return !!(typeof _platformConfig === 'object' && _platformConfig && _platformConfig['page_off_' + id] === 'true');
}

// ==================== ROUTER ====================
// Hash-based routing — навигацията е view'ове.
function router() {
  const hash = location.hash || '#/dashboard';
  const parts = hash.split('?')[0].replace('#/', '').split('/');
  const page = parts[0] || 'home';
  const id = parts[1] ? parseInt(parts[1]) : null;
  const sub = parts[2] || null;

  // Изключена страница (админ панел → Функции и страници) — обратно към Dashboard.
  if (PAGE_TOGGLES.some(function (p) { return p.id === page; }) && isPageOff(page)) {
    if (typeof showToast === 'function') showToast('Тази страница е изключена от админ панела.', 'error', 4000);
    location.hash = '#/dashboard';
    return;
  }

  // Content агент и Контент стратегия — засега само за собственика (Венци, 19.11.2026).
  if ((page === 'content' || page === 'strategy') && currentUser && !currentUser.is_owner) {
    if (typeof showToast === 'function') showToast('Тази страница засега е достъпна само за администратора.', 'error', 4000);
    location.hash = '#/dashboard';
    return;
  }

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
  const _dashPublishBtn = document.getElementById('navDashPublish');
  if (_dashPublishBtn) _dashPublishBtn.style.display = 'none';
  document.querySelectorAll('.dash-filter-panel').forEach((p) => p.remove());

  switch (page) {
    case 'home': return renderDashboard(el);
    case 'dashboard': return renderDashboard(el);
    case 'admin':
      // Историята вече е самостоятелна страница за целия екип, не секция в панела.
      if (parts[1] === 'history') { location.hash = '#/history' + (parts[2] ? '/' + parts[2] : ''); return; }
      return renderSettings(el, parts[1] || null);
    // Старият („Разширени") панел е слят в #/admin — старите линкове водят натам.
    case 'admin-legacy': location.hash = '#/admin'; return;
    case 'history': return renderHistory(el, parts[1] || null);
    case 'kp-auto': return renderKpAuto(el, parts[1] || null);
    case 'calendar': return renderCalendar(el, parts[1] || null);
    case 'release-notes': return renderReleaseNotes(el);
    case 'create-task': return renderTaskCreator(el);
    // Content агент: клиент / пускане / настройки — всичко е пълна страница.
    case 'content': return caRoute(el, parts);
    // Контент стратегия агент: списък / проект / пускане — пълни страници.
    case 'strategy': return csRoute(el, parts);
    case 'board-logic': return renderBoardLogic(el);
    case 'time-report': return renderTimeReport(el);
    case 'client-report': return renderClientReport(el);
    case 'task-completions': return renderTaskCompletionsReport(el);
    case 'overtime':
      // Overtime засега е само за видеографите (+ собственика) — Венци, 19.11.2026.
      if (currentUser && !canSeeOvertime()) { location.hash = '#/dashboard'; return; }
      return renderOvertime(el, parts[1] || null);
    // „Моите задачи" — само избраната колона на човека (аватар → Моите задачи).
    case 'my-tasks': return renderMyTasks(el);
    case 'my-settings': return renderMySettings(el);
    case 'processes': return renderProcesses(el, parts[1] || null, parts[2] || null);
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

