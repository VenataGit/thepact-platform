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
          ${canManage() ? (_homeReorderMode
            ? '<div class="home-reorder-banner">' +
                '<span>🔧 <strong>Режим на подреждане</strong> — влачи бордовете за да промениш реда. Бутонът "+ Ново" винаги остава най-долу.</span>' +
                '<button class="btn btn-sm btn-primary" onclick="exitHomeReorderMode()">✓ Готово</button>' +
              '</div>'
            : ''
          ) : ''}
          <div class="projects-home-grid${_homeReorderMode ? ' projects-home-grid--reorder' : ''}" id="homeBoardsGrid" style="grid-template-columns:repeat(4,1fr);gap:12px">
            ${boards.map(b => {
              var isDocs = b.type === 'docs';
              var isMsgBoard = b.type === 'message_board';
              var href = isDocs ? '#/docs/' + b.id : isMsgBoard ? '#/msgboard/' + b.id : '#/board/' + b.id;
              var cardClass = isDocs ? 'project-card-home project-card-home--docs' : isMsgBoard ? 'project-card-home project-card-home--msgboard' : 'project-card-home';
              // Two modes: normal (long-press to enter reorder) vs active reorder (drag enabled, no nav)
              var dragAttrs = '';
              var hrefAttr = ' href="' + href + '"';
              if (canManage()) {
                if (_homeReorderMode) {
                  // ACTIVE reorder mode — enable drag, suppress link navigation
                  hrefAttr = '';  // no href = clicking does nothing
                  dragAttrs = ' draggable="true" data-board-id="' + b.id + '"' +
                    ' ondragstart="homeBoardDragStart(event,' + b.id + ')"' +
                    ' ondragover="homeBoardDragOver(event)"' +
                    ' ondragleave="homeBoardDragLeave(event)"' +
                    ' ondrop="homeBoardDrop(event,' + b.id + ')"' +
                    ' ondragend="homeBoardDragEnd(event)"';
                } else {
                  // NORMAL mode — long-press handlers, normal click navigation
                  dragAttrs = ' data-board-id="' + b.id + '"' +
                    ' onpointerdown="homeLongPressStart(event,' + b.id + ')"' +
                    ' onpointerup="homeLongPressCancel()"' +
                    ' onpointerleave="homeLongPressCancel()"' +
                    ' onpointercancel="homeLongPressCancel()"' +
                    ' onclick="return homeBoardClickGuard(event)"';
                }
              }
              if (isMsgBoard) {
                return '<a' + hrefAttr + ' class="' + cardClass + '"' + dragAttrs + '>' +
                  '<div class="project-card-home__header">' +
                    '<div class="project-card-home__title">💬 ' + esc(b.title) + '</div>' +
                  '</div>' +
                  '<div class="project-card-home__body">' +
                    '<div style="font-size:11px;color:var(--text-dim);text-align:center">Message Board</div>' +
                  '</div>' +
                '</a>';
              }
              if (isDocs) {
                return '<a' + hrefAttr + ' class="' + cardClass + '"' + dragAttrs + '>' +
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
              return '<a' + hrefAttr + ' class="' + cardClass + '"' + dragAttrs + '>' +
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
  el.className = 'page-card';

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
      <div class="card-page">
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
      month: 'Август 2026',
      entries: [
        { date: '28.08', tag: 'feature', title: 'КП→задачи: форматирането се пренася в новата задача',
          body: 'Хипервръзки, получер, курсив, зачеркнат текст и цветовете от контент плана вече се пренасят автоматично в новосъздадената задача в Basecamp.' },
        { date: '28.08', tag: 'feature', title: 'КП→задачи: бутон „Пропусни" + сигнал за вече съществуваща задача',
          body: 'При преглед преди създаване на задачи вече може да пропуснеш конкретно видео, а платформата предупреждава, ако за него вече има задача.' },
        { date: '28.08', tag: 'fix', title: 'КП-Автоматизация: датите тръгват по фиксиран интервал',
          body: 'Разпределението на датите за публикуване вече не зависи от дължината на месеца.' },
        { date: '28.08', tag: 'feature', title: 'Страница за Chrome разширението',
          body: 'Нова публична страница (thepact.pro/extension.html) с бутон за изтегляне, какво може разширението и дневник по версии.' },
        { date: '27.08', tag: 'feature', title: 'Нова страница „Клиент — график"',
          body: 'Хронологичен списък със задачите на избран клиент по дата, достъпен от менюто „Още".' },
        { date: '27.08', tag: 'feature', title: 'Скрити клиенти',
          body: 'Клиент може да се скрие от общите изгледи; изгледът „Клиент — график" стана и по-компактен.' },
        { date: '27.08', tag: 'fix', title: 'Скрит клиент се връща сам при нова карта',
          body: 'Ако за скрит клиент излезе нова карта в Basecamp, той автоматично спира да е скрит.' },
        { date: '27.08', tag: 'fix', title: 'Филтърът по клиент тръгва от истинското име, не от формата на заглавието',
          body: '' },
        { date: '27.08', tag: 'feature', title: 'Времето се засича и по етап',
          body: 'Освен общо, времето вече се проследява отделно за измисляне, записване и монтаж.' },
        { date: '27.08', tag: 'fix', title: 'Таймерът спира само при ръчен стоп или затворен таб',
          body: '' },
        { date: '27.08', tag: 'fix', title: '„Кой редактира" показва истинското име и от колко време',
          body: 'Преди пишеше generic „Колега"; сега се вижда конкретният човек.' },
        { date: '27.08', tag: 'fix', title: '„Клиент — график" пропуска Not now и Done картите',
          body: '' },
        { date: '27.08', tag: 'fix', title: 'On Hold картите пак показват дата; контент планът се подрежда по срока на плана',
          body: '' },
        { date: '27.08', tag: 'admin', title: 'Админ настройки: управление на видимите страници',
          body: 'Ново място в админ панела, откъдето се включват/изключват отделни инструменти от менюто „Още".' },
        { date: '27.08', tag: 'infra', title: 'Пакет за ръчно инсталиране на разширението — няколко издания (v1.9.4–v1.9.9)',
          body: '' },
        { date: '26.08', tag: 'fix', title: 'Basecamp позициите се броят от 1 — КП планът вече наистина стига до Done',
          body: '' },
        { date: '26.08', tag: 'ui', title: 'Прозорецът „Създай задачи по КП" се затваря само с бутона Х',
          body: 'Преди случайно цъкване встрани го затваряше.' },
        { date: '26.08', tag: 'fix', title: 'Цветът на картите е изцяло по датата; „Приоритет" се създава като последна стъпка',
          body: '' },
        { date: '25.08', tag: 'ui', title: 'По-спокойна анимация на чекнатата стъпка',
          body: 'Чекването на стъпка вече не мести картата — вместо това индикаторът плавно пулсира зелено и е по-малък и дискретен.' },
        { date: '24.08', tag: 'feature', title: 'Историята вече хваща и смяната на датите в Basecamp',
          body: '' },
        { date: '24.08', tag: 'fix', title: 'Историята: едно паднало парче вече не изпразва целия таб',
          body: '' },
        { date: '24.08', tag: 'admin', title: 'Автоматичните дати по стъпки минаха на логика „своя стъпка за всяка колона"',
          body: 'Поправени и старите карти с остарял чеклист, за да следват новата логика.' },
        { date: '22.08', tag: 'ui', title: 'Прозорецът „Създай задачи по КП" пази скрола и фокуса',
          body: '' },
        { date: '22.08', tag: 'feature', title: 'Разбитият КП план се архивира автоматично в Done',
          body: 'При разбиване на контент план на задачи, папката на клиента вече се създава сама.' },
        { date: '22.08', tag: 'feature', title: 'Бекъп на задачите от Basecamp в четим файл',
          body: 'Всяка задача се пази в отделен читаем бекъп файл на сървъра — по клиент, със запазено форматиране, коментари и списък на липсващи снимки.' },
        { date: '22.08', tag: 'fix', title: 'Планът наистина стига до Done',
          body: 'Оправено сгрешено условие, което пречеше на разпознаването.' },
        { date: '21.08', tag: 'feature', title: '„Създай задачи по КП": пълен преглед, редакция на датите, сигнал за дата без видео',
          body: '' },
        { date: '21.08', tag: 'infra', title: 'Авто-датите по стъпките важат вече за целия проект Video Production',
          body: '' },
        { date: '20.08', tag: 'fix', title: 'Описанието на задачите пази празните редове; заглавията остават оцветени',
          body: 'Преди редакция на текста ги събираше в един ред.' },
        { date: '19.08', tag: 'ui', title: 'Имената на клиентите се избират от списък, не се пишат на ръка',
          body: '' },
        { date: '19.08', tag: 'admin', title: 'Листът „Записки" вече не задейства Dev Queue',
          body: '' },
        { date: '19.08', tag: 'feature', title: 'Разширението v1.9.3: работи и на app.basecamp.com',
          body: 'Показва истинското име на човек вместо generic „Колега".' },
        { date: '17.08', tag: 'fix', title: 'On Hold картите се подреждат по датата на колоната, не по ръчния ред',
          body: '' },
        { date: '16.08', tag: 'feature', title: 'Всяка колона следи собствената си стъпка',
          body: '„Due On" вече значи само датата за публикуване, а не датата на текущия етап.' },
        { date: '15.08', tag: 'ui', title: 'КП хайлайт на заглавието: само цвят, без удебеляване',
          body: '' },
        { date: '13.08', tag: 'feature', title: 'История: нов таб „Текст"',
          body: 'Показва какъв е бил текстът на задачата преди и след промяна.' },
        { date: '13.08', tag: 'feature', title: 'История: самостоятелна страница за целия екип',
          body: 'С истински филтри, а не само секция в админ панела.' },
        { date: '12.08', tag: 'feature', title: 'Ново меню „История" в админ панела',
          body: 'Кой какво и кога е правил по задачите.' },
        { date: '12.08', tag: 'fix', title: 'Задачи извън КП/РЕК/КМП вече също получават папка с файлове',
          body: '' },
        { date: '12.08', tag: 'fix', title: 'Папките с файлове се създават автоматично',
          body: 'Локациите за Windows и Mac вече излизат най-горе в задачата.' },
        { date: '11.08', tag: 'feature', title: 'Всяка нова задача носи локациите на файловете',
          body: 'Бутон „Отвори папката" за Windows и Mac директно от задачата в Basecamp.' },
        { date: '08.08', tag: 'feature', title: 'Google Calendar събитията се обновяват на живо',
          body: 'Изглеждат като карти в Производствения календар и пращат известия в Basecamp.' },
        { date: '08.08', tag: 'feature', title: 'Производственият календар работи с няколко Google календара наведнъж',
          body: '' },
        { date: '08.08', tag: 'fix', title: 'Нов следен календар наследява отговорниците, вместо да тръгне празен',
          body: '' },
        { date: '07.08', tag: 'feature', title: 'Бутон за издаване на токен за гласовия агент',
          body: '' },
        { date: '07.08', tag: 'ui', title: 'Табло: клиентите във филтъра — първо българските, после английските',
          body: '' },
        { date: '07.08', tag: 'fix', title: 'Времето се помни при преименуване на задача, не само при местене',
          body: '' },
        { date: '06.08', tag: 'feature', title: 'Гласов брифинг „какво ме чака" за AI агента',
          body: '' },
        { date: '04.08', tag: 'admin', title: 'Одобрени имейли',
          body: 'Админ пуска нов човек в платформата само с един имейл адрес.' },
        { date: '03.08', tag: 'feature', title: 'Нова страница „Логика на табло"',
          body: 'Достъпна от менюто „Още".' },
        { date: '03.08', tag: 'admin', title: 'Техническа корекция на данни в Project Management',
          body: '' },
      ]
    },
    {
      month: 'Юли 2026',
      entries: [
        { date: '31.07', tag: 'feature', title: 'Нов инструмент „Създаване на задачи"',
          body: 'Карти в Basecamp директно от платформата, с допълнителна информация, шаблон в описанието и ред на дъските/датите.' },
        { date: '31.07', tag: 'feature', title: 'Нов инструмент „CRM"',
          body: 'Фунията за придобиване на клиенти, достъпна от „Още → CRM" — на цяла страница, без прозорчета.' },
        { date: '31.07', tag: 'infra', title: 'Локален нощен бекъп на цялата платформа',
          body: 'Всяка нощ в 00:00.' },
        { date: '31.07', tag: 'ui', title: 'Среден бутон на мишката отваря картата в Basecamp на заден план',
          body: '' },
        { date: '31.07', tag: 'ui', title: 'Менюто е изцяло на български и се свива до четири точки на тесен екран',
          body: 'Мобилната версия вече не показва лого върху менюто; „Още" остана само с текст, без икони.' },
        { date: '31.07', tag: 'fix', title: 'Поправка на 404 при хора с повече от един Basecamp акаунт',
          body: '' },
        { date: '31.07', tag: 'feature', title: 'Бутон „Chrome разширение" в менюто „Още"',
          body: '' },
        { date: '31.07', tag: 'feature', title: 'Производственият календар показва и събитията от Google Calendar',
          body: 'Дори когато са запазени направо там, не през платформата.' },
        { date: '30.07', tag: 'fix', title: 'Календарният линк на телефон отваря картата в приложението Basecamp',
          body: '' },
        { date: '30.07', tag: 'feature', title: 'Време: групиране по заглавие на задачата',
          body: 'Не по вътрешен ID на картата; добавен и отчет по клиент/КП.' },
        { date: '30.07', tag: 'feature', title: 'КП-Автоматизация: следващият план тръгва щом главната карта стигне „В продукция"',
          body: '' },
        { date: '30.07', tag: 'fix', title: 'Таблица известия: игнорирани акаунти и по-точно намиране на заглавния ред',
          body: 'Край на спама при масово преправяне на дати.' },
        { date: '30.07', tag: 'feature', title: 'Premiere Downgrade: проекти до 2025 без ограничение в размера',
          body: '' },
        { date: '29.07', tag: 'feature', title: 'Известия от Google Sheets към Basecamp',
          body: 'За клиент Re/Shape.' },
        { date: '29.07', tag: 'feature', title: 'Dashboard: карти се местят и между различни дъски',
          body: 'През портал в Basecamp; порталите се пазят и се почистват сами.' },
        { date: '28.07', tag: 'feature', title: 'КП-Автоматизация: панел „Екип и роли"',
          body: 'Плюс автоматичен коментар с тагове под новата КП карта.' },
        { date: '28.07', tag: 'ui', title: 'Настройки: видими за всички, отварят се само с админ права',
          body: '„Разширени" отпадна — всичко е на едно място.' },
        { date: '28.07', tag: 'feature', title: 'Разширение: публична страница с политиката за поверителност',
          body: 'Изисквана от Chrome Web Store.' },
        { date: '27.07', tag: 'fix', title: 'КП-Автоматизация: календарният прозорец се хваща автоматично спрямо месеца',
          body: '' },
        { date: '19.07', tag: 'feature', title: 'Чат бот в Campfire',
          body: 'Венци пише в Campfire чата на личния проект, а Клод отговаря там директно.' },
        { date: '17.07', tag: 'feature', title: 'Dashboard: бутон „Филтър" до Настройки',
          body: 'Филтриране по клиент, КП, дата и изпълнител.' },
        { date: '17.07', tag: 'fix', title: 'Известия за резултати: КП изпубликуван → съобщение + карта в Basecamp',
          body: '' },
        { date: '16.07', tag: 'feature', title: 'Premiere Pro Downgrade — нов инструмент',
          body: 'Сваля .prproj файл към по-стара версия на Premiere.' },
        { date: '16.07', tag: 'feature', title: 'Производственият календар: Basecamp линковете отварят нативното приложение',
          body: 'Smart deep-link мост вместо браузъра.' },
        { date: '15.07', tag: 'feature', title: 'Dev Queue',
          body: 'Задачите от личния Basecamp проект на Венци стигат директно до Claude Code на компютъра.' },
        { date: '13.07', tag: 'fix', title: 'Basecamp линковете сочат към 3.basecamp.com',
          body: 'Тъмната тема на Basecamp вече се пази.' },
        { date: '13.07', tag: 'feature', title: 'Find: търсенето намира и On Hold картите',
          body: '' },
        { date: '10.07', tag: 'feature', title: 'Време: жив индикатор на дашборда + админ отчет',
          body: 'Нова страница „Време" в менюто „Още".' },
        { date: '10.07', tag: 'ui', title: 'Responsive: навигацията вече не се застъпва под 1780px',
          body: '' },
        { date: '09.07', tag: 'feature', title: 'Календарни известия v2',
          body: 'Въпрос към създателя на събитието, линк към задачата, Campfire ping.' },
        { date: '08.07', tag: 'feature', title: 'PM Agent: чат с инструменти',
          body: 'Действия с одобрение, дневен дайджест и watchdog.' },
        { date: '08.07', tag: 'ui', title: 'КП карта в Basecamp: жълт highlight на „Видео N"',
          body: '' },
        { date: '07.07', tag: 'feature', title: 'КП-Автоматизация: картите вече отиват в Basecamp Pre-Production',
          body: 'Нов админ панел с подменюта за настройката.' },
        { date: '07.07', tag: 'feature', title: 'PM Agent: AI одит „какво изпускаме"',
          body: 'Прави снапшот на Basecamp и проверява за пропуснати неща.' },
        { date: '06.07', tag: 'feature', title: 'Календарни известия: Google Calendar → Basecamp Message Board',
          body: '' },
        { date: '06.07', tag: 'feature', title: 'Дашборд: датата на картата идва от стъпката на отдела',
          body: 'Подредба по срок, с приоритетни карти най-отгоре.' },
      ]
    },
    {
      month: 'Юни 2026',
      entries: [
        { date: '29.06', tag: 'fix', title: 'Махнати браузър push известия и permission popup',
          body: '' },
        { date: '27.06', tag: 'ui', title: 'Дашборд под 900px: focus режим вместо вертикално стакване',
          body: '' },
        { date: '26.06', tag: 'feature', title: '„Създай задачи по КП": пренасяне на снимки и видеа в новите карти',
          body: '' },
        { date: '26.06', tag: 'ui', title: 'По-широки колони на таблото; изчистено меню „Още"',
          body: '' },
        { date: '25.06', tag: 'feature', title: 'Нов инструмент „Създай задачи по КП"',
          body: 'Разбива контент план на отделни карти в Basecamp.' },
        { date: '25.06', tag: 'feature', title: 'Клиенти: преглед на всеки клиент',
          body: 'Взет директно от Basecamp.' },
        { date: '25.06', tag: 'ui', title: 'Премахната breadcrumb лентата навсякъде',
          body: 'Нов панел „Глобални настройки".' },
        { date: '25.06', tag: 'fix', title: 'Дашборд показва On Hold картите под всяка колона',
          body: '' },
        { date: '24.06', tag: 'ui', title: 'Навигация: системен шрифт навсякъде, центрирано меню',
          body: '„Намери" вече търси директно в таблото.' },
        { date: '24.06', tag: 'ui', title: 'Дашборд: по-стегнати карти',
          body: 'Дългите думи в заглавията вече пренасят ред, вместо да излизат извън картата.' },
        { date: '23.06', tag: 'feature', title: 'Производственият календар вече чете директно от Basecamp',
          body: '' },
        { date: '23.06', tag: 'fix', title: 'Работните дни пропускат официалните празници',
          body: 'Не само уикендите.' },
        { date: '23.06', tag: 'ui', title: 'Началната страница отпадна',
          body: 'Таблото е новата стартова страница.' },
        { date: '22.06', tag: 'feature', title: 'Таблото стана Basecamp-базирано',
          body: 'Вижда се и се мести директно от/към Basecamp, вместо от локално копие на картите.' },
        { date: '22.06', tag: 'feature', title: 'Автоматична синхронизация на датите',
          body: 'Basecamp известие → ботът пренаписва датите на стъпките според крайния срок на картата.' },
        { date: '22.06', tag: 'feature', title: 'Производственият календар чете снимачния ден директно от Basecamp',
          body: '' },
        { date: '21.06', tag: 'feature', title: 'Вход с Basecamp',
          body: '„Connect with Basecamp" — само за екипа, без пароли.' },
      ]
    },
    {
      month: 'Април 2026',
      entries: [
        { date: '28.04', tag: 'fix', title: 'SOS: постоянни известия за закъснели участници',
          body: '' },
        { date: '27.04', tag: 'feature', title: 'Диктовка: AI обобщение с редактируемо поле',
          body: 'Текстовите полета вече растат автоматично с текста.' },
        { date: '27.04', tag: 'infra', title: 'Диктовка: по-бърза транскрипция',
          body: 'Chunked pipeline-parallel обработка.' },
        { date: '26.04', tag: 'feature', title: 'Нова страница „Диктовка"',
          body: 'Локален Whisper за разпознаване на реч, без да излиза от компютъра.' },
        { date: '14.04', tag: 'feature', title: 'Нова роля „Мини Админ" + система за позиции',
          body: 'CRUD управление на позициите с настройка на права.' },
        { date: '13.04', tag: 'feature', title: 'Нов тип борд „Message Board"',
          body: 'За обявления и дискусии, с ⋯ меню за преименуване/архивиране/изтриване.' },
        { date: '13.04', tag: 'feature', title: 'Дневен отчет',
          body: 'Автоматичен, структуриран, всяка сутрин в 9:30 в Message Board, с линкове към задачите.' },
        { date: '13.04', tag: 'ui', title: 'КП видео заглавия: маркиране със злато вместо цвят',
          body: '' },
        { date: '12.04', tag: 'ui', title: 'Chat: истински Trix редактор',
          body: 'Търсене и изпращане на GIF-ове, редактиране и изтриване на съобщения.' },
        { date: '12.04', tag: 'ui', title: 'Бележките в картата: подобрен цветови бутон',
          body: 'Toolbar-ът остава лепкав при скрол.' },
        { date: '10.04', tag: 'feature', title: 'PWA — инсталируемо приложение',
          body: 'Платформата може да се сложи на телефона/десктопа с push известия.' },
        { date: '10.04', tag: 'ui', title: 'Колоната Done вече е своя страница',
          body: 'Вместо изскачащ панел; всяка дъска гарантирано има Done колона.' },
        { date: '09.04', tag: 'feature', title: 'КП-Автоматизация: автоматични дати за брейнсторм',
          body: 'Плюс златни заглавия на видеата в Basecamp.' },
        { date: '09.04', tag: 'ui', title: 'Голяма визуална ревизия на таблото',
          body: 'Нов breadcrumb, преработени колони и странична лента.' },
        { date: '09.04', tag: 'fix', title: 'Премахнат лимитът за карти в колона (WIP limit)',
          body: '' },
        { date: '08.04', tag: 'ui', title: 'Дропдауните Pings/Find вече в мрежа',
          body: 'Basecamp-стил решетка вместо списък.' },
        { date: '08.04', tag: 'fix', title: 'Темата се кешира локално',
          body: 'Без просветване (FOUC) при презареждане на страницата.' },
        { date: '07.04', tag: 'feature', title: 'Пълна тема за персонализация',
          body: 'Над 100 настройки за карти, дашборд, breadcrumb и дропдауни.' },
        { date: '07.04', tag: 'feature', title: 'Нов тип борд „Docs & Files"',
          body: 'С текстови документи, редактируеми направо в платформата.' },
        { date: '07.04', tag: 'ui', title: 'Известията Hey!: разделени на непрочетени/прочетени',
          body: '' },
        { date: '07.04', tag: 'infra', title: 'Кодът на приложението е разбит на модули',
          body: '28 JS файла и 9 CSS файла вместо два монолитни, за по-лесна поддръжка.' },
        { date: '05.04', tag: 'feature', title: 'Нов дизайн на картите на бордовете',
          body: 'Картите на бордовете на началната страница сега имат Tinted Header дизайн — оцветена горна секция със заглавието и тъмно тяло с детайлите. По-чисто разделение и модерен вид.' },
        { date: '05.04', tag: 'fix', title: 'Dashboard: автоматично подреждане по дата при drag & drop',
          body: 'Когато преместите карта между колони в Dashboard, тя автоматично се нарежда по краен срок — най-спешните и просрочените са най-отгоре. Няма нужда от рефреш.' },
        { date: '05.04', tag: 'infra', title: 'Стабилност: smart deploy скрипт',
          body: 'Сървърът вече не се рестартира всяка минута. Новият deploy скрипт рестартира само при реални промени от GitHub. Старата Basecamp платформа е премахната от VPS.' },
        { date: '05.04', tag: 'feature', title: 'КП-Автоматизация: пълно преработване',
          body: 'Равномерно разпределение на дати за публикуване в конфигурируем прозорец (30 дни). Автоматично създаване на КП карти 15 работни дни преди следващия КП. 5 стъпки вместо 17.' },
        { date: '05.04', tag: 'feature', title: 'Система за цветове на крайни срокове',
          body: 'КП картите използват производствени дати (брейнсторм, заснемане, монтаж, качване) за определяне на цвета. Картите без краен срок са светло сиви. Цветовете работят навсякъде — Kanban, Dashboard, Календар.' },
        { date: '05.04', tag: 'feature', title: 'Google Calendar интеграция',
          body: 'Събитията от Производствен Календар се синхронизират автоматично с Google Calendar. Всяко събитие включва линк към картата в платформата. Часовете са коректни в Europe/Sofia часова зона.' },
        { date: '04.04', tag: 'feature', title: 'Производствен Календар',
          body: 'Google Calendar-стил седмичен изглед с drag & drop. Sidebar с ненасрочени карти, 15-минутна решетка, resize на блокове. Двоен клик отваря картата.' },
        { date: '04.04', tag: 'feature', title: 'Система за цветове на дедлайни',
          body: 'Цветово кодиране на картите според крайния срок: зелено (5+ дни), жълто (1-4), червено (днес), черно (просрочено). Работи във всички изгледи.' },
        { date: '04.04', tag: 'feature', title: '30-дневно кошче за карти',
          body: 'Изтритите карти отиват в кошче за 30 дни преди окончателно изтриване. Можете да възстановите всяка карта от Инструменти → Кошче.' },
        { date: '04.04', tag: 'feature', title: 'Mobile responsive + toast известия',
          body: 'Платформата сега се показва коректно на телефони и таблети. Всички действия показват toast известия (успех/грешка) вместо confirm/prompt диалози.' },
        { date: '04.04', tag: 'ui', title: 'Карта: преработен дизайн',
          body: 'Картата сега е до 1100px широка. Коментарите са с нов лейаут — разделители, дата колона, меню с три точки. Pinned sidebar за лесна навигация.' },
        { date: '04.04', tag: 'ui', title: 'Начална страница и навигация',
          body: 'Лого над контейнера, 4-колонна решетка за проекти. Dashboard е в главната навигация. Подобрен Hey! dropdown — 800px, центриран, пълна височина.' },
      ]
    },
    {
      month: 'Март 2026',
      entries: [
        { date: '31.03', tag: 'feature', title: 'Пълно стартиране на платформата',
          body: 'Старт на самостоятелната платформа ThePact. Kanban бордове, карти със стъпки, коментари, чат, WebSocket за real-time, JWT автентикация. Независима от Basecamp.' },
        { date: '31.03', tag: 'feature', title: 'Dashboard изглед',
          body: 'Пълен преглед на всички бордове с колони и карти, drag & drop между колони, статистики, on-hold секция, collapse/expand.' },
        { date: '31.03', tag: 'feature', title: 'Комуникация и файлове',
          body: 'Chat (DM + групови), Campfire чат, Message Board, известия с @mentions, файлов Vault с папки и качване до 50MB.' },
      ]
    }
  ];

  var tagLabels = { feature: 'Ново', fix: 'Поправка', ui: 'Дизайн', infra: 'Инфра', admin: 'Админ' };
  var tagColors = { feature: 'var(--accent)', fix: 'var(--green)', ui: '#a78bfa', infra: 'var(--orange)', admin: '#8a9aa3' };

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
// Two-step UX:
//   1. NORMAL: cards behave as normal links. Long-press (500ms) shows confirm modal.
//   2. REORDER MODE: after confirm, cards become draggable. User clicks "Готово" to exit.
// Persists to /api/boards/reorder. WebSocket broadcasts to all clients.
var _homeReorderMode = false;
var _homeDraggedBoardId = null;
var _homeLongPressTimer = null;
var _homeLongPressFired = false;

// Long-press detection on board cards (only when canManage and NOT in reorder mode).
function homeLongPressStart(e, boardId) {
  // Mouse: only main button. Touch/pen: any.
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  _homeLongPressFired = false;
  if (_homeLongPressTimer) clearTimeout(_homeLongPressTimer);
  _homeLongPressTimer = setTimeout(function() {
    _homeLongPressTimer = null;
    _homeLongPressFired = true;
    showConfirmModal(
      'Влез в режим на подреждане? След потвърждение ще можеш да влачиш бордовете и да ги пренареждаш. Промяната е за всички потребители.',
      enterHomeReorderMode,
      false,
      'Влез',
      function() {
        // Cancel — reset flag so the next click navigates normally
        _homeLongPressFired = false;
      }
    );
  }, 500);
}

function homeLongPressCancel() {
  if (_homeLongPressTimer) {
    clearTimeout(_homeLongPressTimer);
    _homeLongPressTimer = null;
  }
}

// Click guard — suppresses navigation if click is the residual after long-press fired
function homeBoardClickGuard(e) {
  if (_homeLongPressFired) {
    e.preventDefault();
    e.stopPropagation();
    _homeLongPressFired = false;
    return false;
  }
  return true;
}

function enterHomeReorderMode() {
  _homeReorderMode = true;
  _homeLongPressFired = false;
  router();
}

function exitHomeReorderMode() {
  _homeReorderMode = false;
  router();
}

// Reset reorder mode when navigating away from home — so it doesn't persist on other pages
window.addEventListener('hashchange', function() {
  if (_homeReorderMode && !location.hash.startsWith('#/home')) {
    _homeReorderMode = false;
  }
});

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

  // Optimistic UI: reorder DOM immediately so user sees the change.
  // Use insertBefore the "+ Ново" button so it always stays at the END.
  var newOrder = ids.map(function(id) {
    return cards.find(function(el) { return parseInt(el.dataset.boardId, 10) === id; });
  });
  var plusButton = grid.querySelector('.project-card-home--new');
  newOrder.forEach(function(el) {
    if (plusButton) {
      grid.insertBefore(el, plusButton);
    } else {
      grid.appendChild(el);
    }
  });

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
