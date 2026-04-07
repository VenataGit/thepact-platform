// ==================== HOME PAGE + HOME TASKS + RELEASE NOTES ====================
// ==================== HOME ====================
async function renderHome(el) {
  setBreadcrumb(null);
  el.className = '';
  try {
    const [cards, boards] = await Promise.all([
      (await fetch('/api/cards')).json(),
      (await fetch('/api/boards')).json()
    ]);
    allBoards = boards;
    const now = new Date(); now.setHours(0,0,0,0);
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const now14 = new Date(now); now14.setDate(now14.getDate() + 14);
    const activeCards = cards.filter(c => !c.completed_at && !c.archived_at);
    const myCards = activeCards.filter(c => c.assignees?.some(a => a.id === currentUser.id));
    const overdueCards = activeCards.filter(c => isCardOverdue(c, now));
    const todayCards = activeCards.filter(c => isCardDueToday(c, now, tomorrow));
    // Completed this week (Monday-based)
    const weekStart = new Date(now);
    const _dow = weekStart.getDay();
    weekStart.setDate(weekStart.getDate() - (_dow === 0 ? 6 : _dow - 1));
    const completedThisWeek = cards.filter(c => c.completed_at && _parseDateMidnight(c.completed_at) >= weekStart);
    // Success rate: % of completed cards (last N days) that were on time
    const d90ago = new Date(now); d90ago.setDate(d90ago.getDate() - parseInt(_platformConfig.success_rate_days || '90'));
    const recentCompleted = cards.filter(c => c.completed_at && _parseDateMidnight(c.completed_at) >= d90ago);
    const onTimeCount = recentCompleted.filter(c => {
      const dates = getCardRelevantDates(c);
      if (dates.length === 0) return true; // no deadline = on time
      const completedDate = _parseDateMidnight(c.completed_at);
      return dates.every(d => completedDate <= _parseDateMidnight(d));
    }).length;
    const successRate = recentCompleted.length > 0 ? Math.round(onTimeCount / recentCompleted.length * 100) : 100;
    const myUpcoming = myCards
      .filter(c => { const ed = getCardEarliestDeadline(c); return ed && ed <= now14; })
      .sort((a, b) => (getCardEarliestDeadline(a) || Infinity) - (getCardEarliestDeadline(b) || Infinity))
      .slice(0, 8);

    el.innerHTML = `
      <div style="text-align:center;margin-bottom:20px">
        <img src="/img/logo-white.svg" alt="The Pact" style="height:48px">
      </div>
      <div class="home-content-box">

        <!-- Stats bar -->
        <div style="display:flex;gap:12px;justify-content:center;margin-bottom:32px;flex-wrap:wrap">
          <a href="#/home-tasks?filter=active" style="text-decoration:none">
            <div class="dash-stat" style="min-width:110px;cursor:pointer">
              <span class="dash-stat__num">${activeCards.length}</span>
              <span class="dash-stat__label">Активни задачи</span>
            </div>
          </a>
          <a href="#/home-tasks?filter=today" style="text-decoration:none">
            <div class="dash-stat ${todayCards.length > 0 ? 'dash-stat--warn' : ''}" style="min-width:110px;cursor:pointer">
              <span class="dash-stat__num">${todayCards.length}</span>
              <span class="dash-stat__label">Краен срок днес</span>
            </div>
          </a>
          <a href="#/home-tasks?filter=overdue" style="text-decoration:none">
            <div class="dash-stat ${overdueCards.length > 0 ? 'dash-stat--warn' : ''}" style="min-width:110px;cursor:pointer">
              <span class="dash-stat__num">${overdueCards.length}</span>
              <span class="dash-stat__label">Просрочени</span>
            </div>
          </a>
          <a href="#/home-tasks?filter=completed-week" style="text-decoration:none">
            <div class="dash-stat" style="min-width:110px;cursor:pointer">
              <span class="dash-stat__num">${completedThisWeek.length}</span>
              <span class="dash-stat__label">Завършени тази седмица</span>
            </div>
          </a>
          <a href="#/home-tasks?filter=on-time" style="text-decoration:none">
            <div class="dash-stat ${successRate >= 80 ? 'dash-stat--success' : successRate >= 50 ? '' : 'dash-stat--warn'}" style="min-width:110px;cursor:pointer">
              <span class="dash-stat__num">${successRate}%</span>
              <span class="dash-stat__label">Успеваемост</span>
            </div>
          </a>
        </div>

        <!-- Boards grid -->
        <div style="margin-bottom:32px">
          ${canManage() ? '<div style="font-size:11px;color:var(--text-dim);margin:0 0 8px;text-align:center">↕ Можете да преподреждате бордовете чрез влачене (промяната е за всички)</div>' : ''}
          <div class="projects-home-grid" id="homeBoardsGrid" style="grid-template-columns:repeat(4,1fr);gap:12px">
            ${boards.map(b => {
              var isDocs = b.type === 'docs';
              var href = isDocs ? '#/docs/' + b.id : '#/board/' + b.id;
              var cardClass = isDocs ? 'project-card-home project-card-home--docs' : 'project-card-home';
              // Drag attributes only for moderators/admins
              var dragAttrs = canManage()
                ? ' draggable="true" data-board-id="' + b.id + '"' +
                  ' ondragstart="homeBoardDragStart(event,' + b.id + ')"' +
                  ' ondragover="homeBoardDragOver(event)"' +
                  ' ondragleave="homeBoardDragLeave(event)"' +
                  ' ondrop="homeBoardDrop(event,' + b.id + ')"' +
                  ' ondragend="homeBoardDragEnd(event)"'
                : '';
              if (isDocs) {
                return '<a href="' + href + '" class="' + cardClass + '"' + dragAttrs + '>' +
                  '<div class="project-card-home__header">' +
                    '<div class="project-card-home__title">📁 ' + esc(b.title) + '</div>' +
                  '</div>' +
                  '<div class="project-card-home__body">' +
                    '<div style="font-size:11px;color:var(--text-dim);text-align:center">Docs & Files</div>' +
                  '</div>' +
                '</a>';
              }
              const bc = activeCards.filter(c => c.board_id === b.id);
              const bOver = bc.filter(c => isCardOverdue(c, now)).length;
              return '<a href="' + href + '" class="' + cardClass + '"' + dragAttrs + '>' +
                '<div class="project-card-home__header">' +
                  '<div class="project-card-home__title">' + esc(b.title) + '</div>' +
                '</div>' +
                '<div class="project-card-home__body">' +
                  '<div style="font-size:11px;color:var(--text-dim);text-align:center">' +
                    bc.length + ' активни' +
                    (bOver > 0 ? ' · <span style="color:var(--red);font-weight:600">' + bOver + ' просрочени</span>' : '') +
                  '</div>' +
                '</div>' +
              '</a>';
            }).join('')}
            ${canManage() ? '<div class="project-card-home project-card-home--new" style="cursor:pointer" onclick="promptCreateBoard()"><div class="project-card-home__header"></div><div class="project-card-home__body" style="align-items:center;justify-content:center"><div class="project-card-home__title" style="font-size:14px">+ Ново</div></div></div>' : ''}
          </div>
        </div>

        <!-- My upcoming tasks -->
        ${myUpcoming.length > 0 ? `
        <div style="margin-bottom:32px">
          <div style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">\u041c\u043e\u0438\u0442\u0435 \u043f\u0440\u0435\u0434\u0441\u0442\u043e\u044f\u0449\u0438</div>
          <div class="task-list" style="max-width:100%">
            ${myUpcoming.map(c => {
              const ed = getCardEarliestDeadline(c);
              const edStr = ed ? ed.toISOString().split('T')[0] : null;
              const isOver = ed && ed < now;
              const isToday = ed && ed.getTime() === now.getTime();
              const dueLabel = !ed ? '' : isOver ? '<span style="color:var(--red);font-weight:600">\u26a0 ' + formatDate(edStr) + '</span>' : isToday ? '<span style="color:var(--yellow);font-weight:600">\u23f0 Днес</span>' : '<span>' + formatDate(edStr) + '</span>';
              const pri = c.priority === 'urgent' ? '\ud83d\udd34 ' : c.priority === 'high' ? '\u2191 ' : '';
              return '<a class="task-row ' + (isOver ? 'overdue' : '') + '" href="#/card/' + c.id + '" style="align-items:center">' +
                '<span class="task-title">' + pri + esc(c.title) + '</span>' +
                '<span class="task-meta">' +
                  (c.client_name ? '<span style="color:var(--accent)">' + esc(c.client_name) + '</span>' : '') +
                  dueLabel +
                '</span></a>';
            }).join('')}
          </div>
          <a href="#/mystuff" style="font-size:12px;color:var(--accent);text-decoration:none;display:inline-block;margin-top:8px">\u0412\u0441\u0438\u0447\u043a\u0438 \u043c\u043e\u0438 \u0437\u0430\u0434\u0430\u0447\u0438 \u2192</a>
        </div>` : ''}

        <!-- Recent activity (lazy loaded) -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em">\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0430 \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442</div>
            <a href="#/activity" style="font-size:12px;color:var(--accent);text-decoration:none">\u0412\u0438\u0436 \u0432\u0441\u0438\u0447\u043a\u043e \u2192</a>
          </div>
          <div id="homeActivityFeed" style="color:var(--text-dim);font-size:13px;padding:16px;text-align:center">\u0417\u0430\u0440\u0435\u0436\u0434\u0430\u043d\u0435\u2026</div>
        </div>
      </div>
    `;
    // Lazy-load home activity after render
    setTimeout(loadHomeActivity, 0);
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

async function loadHomeActivity() {
  const container = document.getElementById('homeActivityFeed');
  if (!container) return;
  try {
    const items = await (await fetch('/api/activity?limit=6')).json();
    if (!Array.isArray(items) || items.length === 0) { container.textContent = '\u041d\u044f\u043c\u0430 \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442 \u0432\u0441\u0435 \u043e\u0449\u0435'; return; }
    const actLabel = a => { if(a.action==='created')return'\u0441\u044a\u0437\u0434\u0430\u0434\u0435'; if(a.action==='commented')return'\u043a\u043e\u043c\u0435\u043d\u0442\u0438\u0440\u0430'; if(a.action==='moved')return'\u043f\u0440\u0435\u043c\u0435\u0441\u0442\u0438'; if(a.action==='completed')return'\u0437\u0430\u0432\u044a\u0440\u0448\u0438'; if(a.action==='archived')return'\u0430\u0440\u0445\u0438\u0432\u0438\u0440\u0430'; return a.action; };
    container.style.textAlign = '';
    container.style.padding = '';
    container.innerHTML = items.map(a =>
      '<div class="activity-entry" style="margin-bottom:10px">' +
      '<div class="activity-avatar" style="background:' + (a.user_avatar ? 'none' : _avColor(a.user_name)) + ';width:26px;height:26px;font-size:9px">' + _avInner(a.user_name||'', a.user_avatar) + '</div>' +
      '<div class="activity-body">' +
      '<div class="activity-text" style="font-size:13px"><strong>' + esc(a.user_name||'') + '</strong> ' + actLabel(a) + ' ' +
      (a.target_type==='card' ? '<a href="#/card/' + a.target_id + '">' + esc(a.target_title||'') + '</a>' : esc(a.target_title||'')) +
      '</div>' +
      '<div class="activity-meta">' + (a.board_title ? esc(a.board_title) + ' \u00b7 ' : '') + timeAgo(a.created_at) + '</div>' +
      '</div></div>'
    ).join('');
  } catch { if (container) container.textContent = ''; }
}

function renderMiniCalendar() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = now.getDate();
  const monthName = now.toLocaleDateString('bg', { month: 'long' });
  const dayNames = ['НД','ПН','ВТ','СР','ЧТ','ПТ','СБ'];

  let cells = '';
  for (let i = 0; i < firstDay; i++) cells += '<td></td>';
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today;
    cells += `<td style="${isToday ? 'background:var(--accent);color:#000;border-radius:4px;font-weight:700' : 'color:var(--text-secondary)'}">${d}</td>`;
    if ((firstDay + d) % 7 === 0) cells += '</tr><tr>';
  }

  return `
    <div style="text-align:center;margin-bottom:8px;font-weight:600;color:var(--text)">${monthName}</div>
    <table style="width:100%;text-align:center;font-size:12px;border-collapse:collapse">
      <tr>${dayNames.map(d => `<th style="padding:4px;color:var(--text-dim);font-weight:500;font-size:10px">${d}</th>`).join('')}</tr>
      <tr>${cells}</tr>
    </table>
  `;
}


// ==================== HOME TASKS (filtered view) ====================
async function renderHomeTasks(el) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const filter = params.get('filter') || 'active';

  const filterLabels = {
    'active': 'Активни задачи',
    'overdue': 'Просрочени задачи',
    'today': 'Краен срок днес',
    'completed-week': 'Завършени тази седмица',
    'on-time': 'Успеваемост (90 дни)'
  };

  setBreadcrumb([{ label: 'Начало', href: '#/home' }, { label: filterLabels[filter] || 'Задачи' }]);
  el.className = '';

  try {
    const cards = await (await fetch('/api/cards')).json();
    const now = new Date(); now.setHours(0,0,0,0);
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const weekStart = new Date(now);
    const _dow = weekStart.getDay();
    weekStart.setDate(weekStart.getDate() - (_dow === 0 ? 6 : _dow - 1));
    const d90ago = new Date(now); d90ago.setDate(d90ago.getDate() - parseInt(_platformConfig.success_rate_days || '90'));

    let filtered = [];
    if (filter === 'active') {
      filtered = cards.filter(c => !c.completed_at && !c.archived_at);
    } else if (filter === 'overdue') {
      filtered = cards.filter(c => isCardOverdue(c, now));
    } else if (filter === 'today') {
      filtered = cards.filter(c => isCardDueToday(c, now, tomorrow));
    } else if (filter === 'completed-week') {
      filtered = cards.filter(c => c.completed_at && _parseDateMidnight(c.completed_at) >= weekStart);
    } else if (filter === 'on-time') {
      filtered = cards.filter(c => {
        if (!c.completed_at || _parseDateMidnight(c.completed_at) < d90ago) return false;
        const dates = getCardRelevantDates(c);
        if (dates.length === 0) return true;
        const completedDate = _parseDateMidnight(c.completed_at);
        return dates.every(d => completedDate <= _parseDateMidnight(d));
      });
    }

    // Sort by earliest deadline
    filtered.sort((a, b) => {
      const da = getCardEarliestDeadline(a);
      const db = getCardEarliestDeadline(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    });

    const rows = filtered.map(c => {
      const ed = getCardEarliestDeadline(c);
      const edStr = ed ? ed.toISOString().split('T')[0] : null;
      const isOver = ed && ed < now && !c.completed_at;
      const isToday = ed && ed >= now && ed < tomorrow;
      const dueLabel = !ed ? '' : isOver ? '<span style="color:var(--red);font-weight:600">\u26a0 ' + formatDate(edStr) + '</span>' : isToday ? '<span style="color:var(--yellow);font-weight:600">\u23f0 Днес</span>' : '<span>' + formatDate(edStr) + '</span>';
      const completedLabel = c.completed_at ? '<span style="color:var(--green);font-size:11px">\u2713 ' + formatDate(c.completed_at) + '</span>' : '';
      const pri = c.priority === 'urgent' ? '\ud83d\udd34 ' : c.priority === 'high' ? '\u2191 ' : '';
      const assignees = (c.assignees || []).map(a => a.name).join(', ');
      return '<a class="task-row ' + (isOver ? 'overdue' : '') + '" href="#/card/' + c.id + '" style="align-items:center">' +
        '<span class="task-title">' + pri + esc(c.title) + '</span>' +
        '<span class="task-meta">' +
          (c.board_title ? '<span style="color:var(--text-dim);font-size:11px">' + esc(c.board_title) + '</span>' : '') +
          (assignees ? '<span style="color:var(--accent);font-size:11px">' + esc(assignees) + '</span>' : '') +
          (c.client_name ? '<span style="color:var(--accent);font-size:11px">' + esc(c.client_name) + '</span>' : '') +
          dueLabel + completedLabel +
        '</span></a>';
    }).join('');

    // Filter tabs
    const tabs = [
      { key: 'active', label: 'Активни', icon: '\ud83d\udfe2' },
      { key: 'today', label: 'Днес', icon: '\u23f0' },
      { key: 'overdue', label: 'Просрочени', icon: '\ud83d\udd34' },
      { key: 'completed-week', label: 'Тази седмица', icon: '\u2705' },
      { key: 'on-time', label: 'Успеваемост', icon: '\ud83c\udfc6' }
    ];

    el.innerHTML = `
      <div style="max-width:800px;margin:0 auto">
        <div class="page-header"><h1>${filterLabels[filter] || 'Задачи'}</h1><div class="page-subtitle">${filtered.length} резултата</div></div>
        <div style="display:flex;gap:8px;justify-content:center;margin-bottom:20px;flex-wrap:wrap">
          ${tabs.map(t => `<a href="#/home-tasks?filter=${t.key}" class="btn btn-sm ${filter === t.key ? 'btn-primary' : ''}">${t.icon} ${t.label}</a>`).join('')}
        </div>
        <div class="task-list">
          ${rows || '<div style="text-align:center;padding:32px;color:var(--text-dim)">Няма задачи в тази категория</div>'}
        </div>
        <div style="text-align:center;margin-top:16px">
          <a href="#/home" class="btn btn-sm btn-ghost">\u2190 Начало</a>
        </div>
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка при зареждане</div>'; }
}

// ==================== RELEASE NOTES ====================
function renderReleaseNotes(el) {
  setBreadcrumb([{ label: '\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u0438' }, { label: '\u041a\u0430\u043a\u0432\u043e \u043d\u043e\u0432\u043e' }]);
  el.className = '';

  var RELEASES = [
    {
      month: '\u0410\u043f\u0440\u0438\u043b 2026',
      entries: [
        { date: '05.04', tag: 'feature', title: '\u041d\u043e\u0432 \u0434\u0438\u0437\u0430\u0439\u043d \u043d\u0430 \u043a\u0430\u0440\u0442\u0438\u0442\u0435 \u043d\u0430 \u0431\u043e\u0440\u0434\u043e\u0432\u0435\u0442\u0435',
          body: '\u041a\u0430\u0440\u0442\u0438\u0442\u0435 \u043d\u0430 \u0431\u043e\u0440\u0434\u043e\u0432\u0435\u0442\u0435 \u043d\u0430 \u043d\u0430\u0447\u0430\u043b\u043d\u0430\u0442\u0430 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u0441\u0435\u0433\u0430 \u0438\u043c\u0430\u0442 Tinted Header \u0434\u0438\u0437\u0430\u0439\u043d \u2014 \u043e\u0446\u0432\u0435\u0442\u0435\u043d\u0430 \u0433\u043e\u0440\u043d\u0430 \u0441\u0435\u043a\u0446\u0438\u044f \u0441\u044a\u0441 \u0437\u0430\u0433\u043b\u0430\u0432\u0438\u0435\u0442\u043e \u0438 \u0442\u044a\u043c\u043d\u043e \u0442\u044f\u043b\u043e \u0441 \u0434\u0435\u0442\u0430\u0439\u043b\u0438\u0442\u0435. \u041f\u043e-\u0447\u0438\u0441\u0442\u043e \u0440\u0430\u0437\u0434\u0435\u043b\u0435\u043d\u0438\u0435 \u0438 \u043c\u043e\u0434\u0435\u0440\u0435\u043d \u0432\u0438\u0434.' },
        { date: '05.04', tag: 'fix', title: 'Dashboard: \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u043d\u043e \u043f\u043e\u0434\u0440\u0435\u0436\u0434\u0430\u043d\u0435 \u043f\u043e \u0434\u0430\u0442\u0430 \u043f\u0440\u0438 drag & drop',
          body: '\u041a\u043e\u0433\u0430\u0442\u043e \u043f\u0440\u0435\u043c\u0435\u0441\u0442\u0438\u0442\u0435 \u043a\u0430\u0440\u0442\u0430 \u043c\u0435\u0436\u0434\u0443 \u043a\u043e\u043b\u043e\u043d\u0438 \u0432 Dashboard, \u0442\u044f \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u043d\u043e \u0441\u0435 \u043d\u0430\u0440\u0435\u0436\u0434\u0430 \u043f\u043e \u043a\u0440\u0430\u0435\u043d \u0441\u0440\u043e\u043a \u2014 \u043d\u0430\u0439-\u0441\u043a\u043e\u0440\u043e\u0448\u043d\u0438\u0442\u0435 \u0438 \u043f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u0438\u0442\u0435 \u0441\u0430 \u043d\u0430\u0439-\u043e\u0442\u0433\u043e\u0440\u0435. \u041d\u044f\u043c\u0430 \u043d\u0443\u0436\u0434\u0430 \u043e\u0442 \u0440\u0435\u0444\u0440\u0435\u0448.' },
        { date: '05.04', tag: 'infra', title: '\u0421\u0442\u0430\u0431\u0438\u043b\u043d\u043e\u0441\u0442: smart deploy \u0441\u043a\u0440\u0438\u043f\u0442',
          body: '\u0421\u044a\u0440\u0432\u044a\u0440\u044a\u0442 \u0432\u0435\u0447\u0435 \u043d\u0435 \u0441\u0435 \u0440\u0435\u0441\u0442\u0430\u0440\u0442\u0438\u0440\u0430 \u0432\u0441\u044f\u043a\u0430 \u043c\u0438\u043d\u0443\u0442\u0430. \u041d\u043e\u0432\u0438\u044f\u0442 deploy \u0441\u043a\u0440\u0438\u043f\u0442 \u0440\u0435\u0441\u0442\u0430\u0440\u0442\u0438\u0440\u0430 \u0441\u0430\u043c\u043e \u043f\u0440\u0438 \u0440\u0435\u0430\u043b\u043d\u0438 \u043f\u0440\u043e\u043c\u0435\u043d\u0438 \u043e\u0442 GitHub. \u0421\u0442\u0430\u0440\u0430\u0442\u0430 Basecamp \u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430 \u0435 \u043f\u0440\u0435\u043c\u0430\u0445\u043d\u0430\u0442\u0430 \u043e\u0442 VPS.' },
        { date: '05.04', tag: 'feature', title: '\u041a\u041f-\u0410\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0437\u0430\u0446\u0438\u044f: \u043f\u044a\u043b\u043d\u043e \u043f\u0440\u0435\u0440\u0430\u0431\u043e\u0442\u0432\u0430\u043d\u0435',
          body: '\u0420\u0430\u0432\u043d\u043e\u043c\u0435\u0440\u043d\u043e \u0440\u0430\u0437\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d\u0438\u0435 \u043d\u0430 \u0434\u0430\u0442\u0438 \u0437\u0430 \u043f\u0443\u0431\u043b\u0438\u043a\u0443\u0432\u0430\u043d\u0435 \u0432 \u043a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0438\u0440\u0443\u0435\u043c \u043f\u0440\u043e\u0437\u043e\u0440\u0435\u0446 (30 \u0434\u043d\u0438). \u0410\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u043d\u043e \u0441\u044a\u0437\u0434\u0430\u0432\u0430\u043d\u0435 \u043d\u0430 \u041a\u041f \u043a\u0430\u0440\u0442\u0438 15 \u0440\u0430\u0431\u043e\u0442\u043d\u0438 \u0434\u043d\u0438 \u043f\u0440\u0435\u0434\u0438 \u0441\u043b\u0435\u0434\u0432\u0430\u0449\u0438\u044f \u041a\u041f. 5 \u0441\u0442\u044a\u043f\u043a\u0438 \u0432\u043c\u0435\u0441\u0442\u043e 17.' },
        { date: '05.04', tag: 'feature', title: '\u0421\u0438\u0441\u0442\u0435\u043c\u0430 \u0437\u0430 \u0446\u0432\u0435\u0442\u043e\u0432\u0435 \u043d\u0430 \u043a\u0440\u0430\u0439\u043d\u0438 \u0441\u0440\u043e\u043a\u043e\u0432\u0435',
          body: '\u041a\u041f \u043a\u0430\u0440\u0442\u0438\u0442\u0435 \u0438\u0437\u043f\u043e\u043b\u0437\u0432\u0430\u0442 \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0441\u0442\u0432\u0435\u043d\u0438 \u0434\u0430\u0442\u0438 (\u0431\u0440\u0435\u0439\u043d\u0441\u0442\u043e\u0440\u043c, \u0437\u0430\u0441\u043d\u0435\u043c\u0430\u043d\u0435, \u043c\u043e\u043d\u0442\u0430\u0436, \u043a\u0430\u0447\u0432\u0430\u043d\u0435) \u0437\u0430 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u044f\u043d\u0435 \u043d\u0430 \u0446\u0432\u0435\u0442\u0430. \u041a\u0430\u0440\u0442\u0438\u0442\u0435 \u0431\u0435\u0437 \u043a\u0440\u0430\u0435\u043d \u0441\u0440\u043e\u043a \u0441\u0430 \u0441\u0432\u0435\u0442\u043b\u043e \u0441\u0438\u0432\u0438. \u0426\u0432\u0435\u0442\u043e\u0432\u0435\u0442\u0435 \u0440\u0430\u0431\u043e\u0442\u044f\u0442 \u043d\u0430\u0432\u0441\u044f\u043a\u044a\u0434\u0435 \u2014 Kanban, Dashboard, \u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440.' },
        { date: '05.04', tag: 'feature', title: 'Google Calendar \u0438\u043d\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u044f',
          body: '\u0421\u044a\u0431\u0438\u0442\u0438\u044f\u0442\u0430 \u043e\u0442 \u041f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0441\u0442\u0432\u0435\u043d \u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440 \u0441\u0435 \u0441\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0438\u0440\u0430\u0442 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u043d\u043e \u0441 Google Calendar. \u0412\u0441\u044f\u043a\u043e \u0441\u044a\u0431\u0438\u0442\u0438\u0435 \u0432\u043a\u043b\u044e\u0447\u0432\u0430 \u043b\u0438\u043d\u043a \u043a\u044a\u043c \u043a\u0430\u0440\u0442\u0430\u0442\u0430 \u0432 \u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430\u0442\u0430. \u0427\u0430\u0441\u043e\u0432\u0435\u0442\u0435 \u0441\u0430 \u043a\u043e\u0440\u0435\u043a\u0442\u043d\u0438 \u0432 Europe/Sofia \u0447\u0430\u0441\u043e\u0432\u0430 \u0437\u043e\u043d\u0430.' },
      ]
    },
    {
      month: '\u0410\u043f\u0440\u0438\u043b 2026 (\u0440\u0430\u043d\u043d\u0438)',
      entries: [
        { date: '04.04', tag: 'feature', title: '\u041f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0441\u0442\u0432\u0435\u043d \u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440',
          body: 'Google Calendar-\u0441\u0442\u0438\u043b \u0441\u0435\u0434\u043c\u0438\u0447\u0435\u043d \u0438\u0437\u0433\u043b\u0435\u0434 \u0441 drag & drop. Sidebar \u0441 \u043d\u0435\u043d\u0430\u0441\u0440\u043e\u0447\u0435\u043d\u0438 \u043a\u0430\u0440\u0442\u0438, 15-\u043c\u0438\u043d\u0443\u0442\u043d\u0430 \u0440\u0435\u0448\u0435\u0442\u043a\u0430, resize \u043d\u0430 \u0431\u043b\u043e\u043a\u043e\u0432\u0435. \u0414\u0432\u043e\u0435\u043d \u043a\u043b\u0438\u043a \u043e\u0442\u0432\u0430\u0440\u044f \u043a\u0430\u0440\u0442\u0430\u0442\u0430.' },
        { date: '04.04', tag: 'feature', title: '\u0421\u0438\u0441\u0442\u0435\u043c\u0430 \u0437\u0430 \u0446\u0432\u0435\u0442\u043e\u0432\u0435 \u043d\u0430 \u0434\u0435\u0434\u043b\u0430\u0439\u043d\u0438',
          body: '\u0426\u0432\u0435\u0442\u043e\u0432\u043e \u043a\u043e\u0434\u0438\u0440\u0430\u043d\u0435 \u043d\u0430 \u043a\u0430\u0440\u0442\u0438\u0442\u0435 \u0441\u043f\u043e\u0440\u0435\u0434 \u043a\u0440\u0430\u0439\u043d\u0438\u044f \u0441\u0440\u043e\u043a: \u0437\u0435\u043b\u0435\u043d\u043e (5+ \u0434\u043d\u0438), \u0436\u044a\u043b\u0442\u043e (1-4), \u0447\u0435\u0440\u0432\u0435\u043d\u043e (\u0434\u043d\u0435\u0441), \u0447\u0435\u0440\u043d\u043e (\u043f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u043e). \u0420\u0430\u0431\u043e\u0442\u0438 \u0432\u044a\u0432 \u0432\u0441\u0438\u0447\u043a\u0438 \u0438\u0437\u0433\u043b\u0435\u0434\u0438.' },
        { date: '04.04', tag: 'feature', title: '30-\u0434\u043d\u0435\u0432\u043d\u043e \u043a\u043e\u0448\u0447\u0435 \u0437\u0430 \u043a\u0430\u0440\u0442\u0438',
          body: '\u0418\u0437\u0442\u0440\u0438\u0442\u0438\u0442\u0435 \u043a\u0430\u0440\u0442\u0438 \u043e\u0442\u0438\u0432\u0430\u0442 \u0432 \u043a\u043e\u0448\u0447\u0435 \u0437\u0430 30 \u0434\u043d\u0438 \u043f\u0440\u0435\u0434\u0438 \u043e\u043a\u043e\u043d\u0447\u0430\u0442\u0435\u043b\u043d\u043e \u0438\u0437\u0442\u0440\u0438\u0432\u0430\u043d\u0435. \u041c\u043e\u0436\u0435\u0442\u0435 \u0434\u0430 \u0432\u044a\u0437\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u0435 \u0432\u0441\u044f\u043a\u0430 \u043a\u0430\u0440\u0442\u0430 \u043e\u0442 \u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u0438 \u2192 \u041a\u043e\u0448\u0447\u0435.' },
        { date: '04.04', tag: 'feature', title: 'Mobile responsive + toast \u0438\u0437\u0432\u0435\u0441\u0442\u0438\u044f',
          body: '\u041f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430\u0442\u0430 \u0441\u0435\u0433\u0430 \u0441\u0435 \u043f\u043e\u043a\u0430\u0437\u0432\u0430 \u043a\u043e\u0440\u0435\u043a\u0442\u043d\u043e \u043d\u0430 \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0438 \u0438 \u0442\u0430\u0431\u043b\u0435\u0442\u0438. \u0412\u0441\u0438\u0447\u043a\u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f \u043f\u043e\u043a\u0430\u0437\u0432\u0430\u0442 toast \u0438\u0437\u0432\u0435\u0441\u0442\u0438\u044f (\u0443\u0441\u043f\u0435\u0445/\u0433\u0440\u0435\u0448\u043a\u0430) \u0432\u043c\u0435\u0441\u0442\u043e confirm/prompt \u0434\u0438\u0430\u043b\u043e\u0437\u0438.' },
        { date: '04.04', tag: 'ui', title: '\u041a\u0430\u0440\u0442\u0430: \u043f\u0440\u0435\u0440\u0430\u0431\u043e\u0442\u0435\u043d \u0434\u0438\u0437\u0430\u0439\u043d',
          body: '\u041a\u0430\u0440\u0442\u0430\u0442\u0430 \u0441\u0435\u0433\u0430 \u0435 \u0434\u043e 1100px \u0448\u0438\u0440\u043e\u043a\u0430. \u041a\u043e\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0442\u0435 \u0441\u0430 \u0441 \u043d\u043e\u0432 \u043b\u0435\u0439\u0430\u0443\u0442 \u2014 \u0440\u0430\u0437\u0434\u0435\u043b\u0438\u0442\u0435\u043b\u0438, \u0434\u0430\u0442\u0430 \u043a\u043e\u043b\u043e\u043d\u0430, \u043c\u0435\u043d\u044e \u0441 \u0442\u0440\u0438 \u0442\u043e\u0447\u043a\u0438. Pinned sidebar \u0437\u0430 \u043b\u0435\u0441\u043d\u0430 \u043d\u0430\u0432\u0438\u0433\u0430\u0446\u0438\u044f.' },
        { date: '04.04', tag: 'ui', title: '\u041d\u0430\u0447\u0430\u043b\u043d\u0430 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u0438 \u043d\u0430\u0432\u0438\u0433\u0430\u0446\u0438\u044f',
          body: '\u041b\u043e\u0433\u043e \u043d\u0430\u0434 \u043a\u043e\u043d\u0442\u0435\u0439\u043d\u0435\u0440\u0430, 4-\u043a\u043e\u043b\u043e\u043d\u043d\u0430 \u0440\u0435\u0448\u0435\u0442\u043a\u0430 \u0437\u0430 \u043f\u0440\u043e\u0435\u043a\u0442\u0438. Dashboard \u0435 \u0432 \u0433\u043b\u0430\u0432\u043d\u0430\u0442\u0430 \u043d\u0430\u0432\u0438\u0433\u0430\u0446\u0438\u044f. \u041f\u043e\u0434\u043e\u0431\u0440\u0435\u043d Hey! dropdown \u2014 800px, \u0446\u0435\u043d\u0442\u0440\u0438\u0440\u0430\u043d, \u043f\u044a\u043b\u043d\u0430 \u0432\u0438\u0441\u043e\u0447\u0438\u043d\u0430.' },
      ]
    },
    {
      month: '\u041c\u0430\u0440\u0442 2026',
      entries: [
        { date: '31.03', tag: 'feature', title: '\u041f\u044a\u043b\u043d\u043e \u0441\u0442\u0430\u0440\u0442\u0438\u0440\u0430\u043d\u0435 \u043d\u0430 \u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430\u0442\u0430',
          body: '\u0421\u0442\u0430\u0440\u0442 \u043d\u0430 \u0441\u0430\u043c\u043e\u0441\u0442\u043e\u044f\u0442\u0435\u043b\u043d\u0430\u0442\u0430 \u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430 ThePact. Kanban \u0431\u043e\u0440\u0434\u043e\u0432\u0435, \u043a\u0430\u0440\u0442\u0438 \u0441\u044a\u0441 \u0441\u0442\u044a\u043f\u043a\u0438, \u043a\u043e\u043c\u0435\u043d\u0442\u0430\u0440\u0438, \u0447\u0430\u0442, WebSocket \u0437\u0430 real-time, JWT \u0430\u0432\u0442\u0435\u043d\u0442\u0438\u043a\u0430\u0446\u0438\u044f. \u041d\u0435\u0437\u0430\u0432\u0438\u0441\u0438\u043c\u0430 \u043e\u0442 Basecamp.' },
        { date: '31.03', tag: 'feature', title: 'Dashboard \u0438\u0437\u0433\u043b\u0435\u0434',
          body: '\u041f\u044a\u043b\u0435\u043d \u043f\u0440\u0435\u0433\u043b\u0435\u0434 \u043d\u0430 \u0432\u0441\u0438\u0447\u043a\u0438 \u0431\u043e\u0440\u0434\u043e\u0432\u0435 \u0441 \u043a\u043e\u043b\u043e\u043d\u0438 \u0438 \u043a\u0430\u0440\u0442\u0438, drag & drop \u043c\u0435\u0436\u0434\u0443 \u043a\u043e\u043b\u043e\u043d\u0438, \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043a\u0438, on-hold \u0441\u0435\u043a\u0446\u0438\u044f, collapse/expand.' },
        { date: '31.03', tag: 'feature', title: '\u041a\u043e\u043c\u0443\u043d\u0438\u043a\u0430\u0446\u0438\u044f \u0438 \u0444\u0430\u0439\u043b\u043e\u0432\u0435',
          body: 'Chat (DM + \u0433\u0440\u0443\u043f\u043e\u0432\u0438), Campfire \u0447\u0430\u0442, Message Board, \u0438\u0437\u0432\u0435\u0441\u0442\u0438\u044f \u0441 @mentions, \u0444\u0430\u0439\u043b\u043e\u0432 Vault \u0441 \u043f\u0430\u043f\u043a\u0438 \u0438 \u043a\u0430\u0447\u0432\u0430\u043d\u0435 \u0434\u043e 50MB.' },
      ]
    }
  ];

  var tagLabels = { feature: '\u041d\u043e\u0432\u043e', fix: '\u041f\u043e\u043f\u0440\u0430\u0432\u043a\u0430', ui: '\u0414\u0438\u0437\u0430\u0439\u043d', infra: '\u0418\u043d\u0444\u0440\u0430' };
  var tagColors = { feature: 'var(--accent)', fix: 'var(--green)', ui: '#a78bfa', infra: 'var(--orange)' };

  var html = '<div class="home-content-box" style="max-width:800px">' +
    '<h1 style="font-size:22px;font-weight:800;color:#fff;margin-bottom:6px">\ud83d\udcf0 \u041a\u0430\u043a\u0432\u043e \u043d\u043e\u0432\u043e</h1>' +
    '<p style="font-size:13px;color:var(--text-dim);margin-bottom:28px">\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0438 \u043f\u0440\u043e\u043c\u0435\u043d\u0438 \u0438 \u043d\u043e\u0432\u0438 \u0444\u0443\u043d\u043a\u0446\u0438\u043e\u043d\u0430\u043b\u043d\u043e\u0441\u0442\u0438 \u0432 \u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430\u0442\u0430.</p>';

  RELEASES.forEach(function(group) {
    html += '<div style="margin-bottom:32px">' +
      '<h2 style="font-size:13px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em;padding-bottom:10px;border-bottom:1px solid var(--border);margin-bottom:16px">' + group.month + '</h2>';

    group.entries.forEach(function(e) {
      var tagLabel = tagLabels[e.tag] || e.tag;
      var tagColor = tagColors[e.tag] || 'var(--text-dim)';
      html += '<article style="display:flex;gap:14px;margin-bottom:18px;padding-bottom:18px;border-bottom:1px solid rgba(255,255,255,0.03)">' +
        '<div style="flex-shrink:0;width:46px;text-align:right;padding-top:2px">' +
          '<time style="font-size:12px;font-weight:600;color:var(--text-dim);font-variant-numeric:tabular-nums">' + e.date + '</time>' +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
            '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:' + tagColor + ';color:#fff;text-transform:uppercase;letter-spacing:0.04em;opacity:0.85">' + tagLabel + '</span>' +
            '<h3 style="font-size:14px;font-weight:700;color:#fff;margin:0">' + e.title + '</h3>' +
          '</div>' +
          '<p style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin:0">' + e.body + '</p>' +
        '</div>' +
      '</article>';
    });

    html += '</div>';
  });

  html += '<div style="text-align:center;padding:16px;color:var(--text-dim);font-size:11px">' +
    '\u2014 \u041d\u0430\u0447\u0430\u043b\u043e \u043d\u0430 \u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430\u0442\u0430: \u043c\u0430\u0440\u0442 2026 \u2014</div>';
  html += '</div>';

  el.innerHTML = html;
}

// ==================== HOME BOARDS DRAG & DROP (mod/admin only) ====================
// Reorders board cards on the home page. Persists to /api/boards/reorder so the
// new order applies to ALL users (broadcast via WebSocket).
var _homeDraggedBoardId = null;

function homeBoardDragStart(e, boardId) {
  if (!canManage()) { e.preventDefault(); return; }
  _homeDraggedBoardId = boardId;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  // Some browsers need data set in dragstart, otherwise drop fires nothing
  try { e.dataTransfer.setData('text/plain', String(boardId)); } catch (err) {}
}

function homeBoardDragOver(e) {
  if (_homeDraggedBoardId === null) return;
  e.preventDefault(); // required for drop to fire
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('home-board-drag-over');
}

function homeBoardDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('home-board-drag-over');
  }
}

function homeBoardDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.home-board-drag-over').forEach(function(el) {
    el.classList.remove('home-board-drag-over');
  });
  _homeDraggedBoardId = null;
}

async function homeBoardDrop(e, targetBoardId) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('home-board-drag-over');
  document.querySelectorAll('.home-board-drag-over').forEach(function(el) {
    el.classList.remove('home-board-drag-over');
  });

  if (_homeDraggedBoardId === null || _homeDraggedBoardId === targetBoardId) {
    _homeDraggedBoardId = null;
    return;
  }

  // Build the new order from the current DOM (so we don't depend on stale state)
  var grid = document.getElementById('homeBoardsGrid');
  if (!grid) return;
  var cards = Array.from(grid.querySelectorAll('[data-board-id]'));
  var ids = cards.map(function(el) { return parseInt(el.dataset.boardId, 10); });

  var fromIdx = ids.indexOf(_homeDraggedBoardId);
  var toIdx = ids.indexOf(targetBoardId);
  if (fromIdx < 0 || toIdx < 0) { _homeDraggedBoardId = null; return; }

  // Move dragged in front of target
  var draggedId = ids.splice(fromIdx, 1)[0];
  ids.splice(toIdx, 0, draggedId);
  _homeDraggedBoardId = null;

  // Optimistic UI: reorder DOM immediately so user sees the change
  var newOrder = ids.map(function(id) {
    return cards.find(function(el) { return parseInt(el.dataset.boardId, 10) === id; });
  });
  newOrder.forEach(function(el) { grid.appendChild(el); });

  // Suppress next WS rerender (own action will trigger boards:reordered event)
  _suppressWsRerender = Date.now() + 1500;

  try {
    var res = await fetch('/api/boards/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ids })
    });
    if (!res.ok) {
      var err = await res.json().catch(function() { return {}; });
      throw new Error(err.error || ('HTTP ' + res.status));
    }
    showToast('Бордовете са преподредени', 'success');
    // Update the in-memory cache so navigation away+back shows new order
    if (Array.isArray(allBoards)) {
      allBoards.sort(function(a, b) {
        return ids.indexOf(a.id) - ids.indexOf(b.id);
      });
    }
  } catch (e) {
    console.warn('[home] reorder failed:', e.message);
    showToast('Грешка при преподреждане: ' + e.message, 'error');
    // Re-render to revert optimistic change
    router();
  }
}
