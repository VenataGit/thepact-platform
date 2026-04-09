// ==================== REPORTS + COLUMN VIEW ====================
function renderReportRow(c, tab) {
  const now = new Date(); now.setHours(0,0,0,0);
  const isOver = isCardOverdue(c, now);
  const priLabel = c.priority === 'urgent' ? '<span style="color:var(--red);font-weight:700;font-size:11px">\ud83d\udd34</span>' : c.priority === 'high' ? '<span style="color:var(--yellow);font-weight:700;font-size:11px">\u2191</span>' : '';
  return '<a class="task-row ' + (isOver ? 'overdue' : '') + '" href="#/card/' + c.id + '">' +
    '<span class="task-title">' + priLabel + (priLabel ? ' ' : '') + esc(c.title) + '</span>' +
    '<span class="task-meta">' +
      (c.client_name ? '<span style="color:var(--accent);font-weight:600">' + esc(c.client_name) + '</span>' : '') +
      (c.board_title ? '<span class="task-board">' + esc(c.board_title) + '</span>' : '') +
      (c.column_title ? '<span style="opacity:.6;font-size:11px">' + esc(c.column_title) + '</span>' : '') +
      (tab !== 'assignments' && c.assignee_name ? '<span style="color:var(--green)">' + esc(c.assignee_name) + '</span>' : '') +
      (c.due_on ? '<span class="task-due">' + formatDate(c.due_on) + '</span>' : '') +
    '</span></a>';
}
function renderReportRows(data, tab) {
  if (data.length === 0) return '<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма резултати</div>';
  if (tab === 'assignments') {
    const byPerson = {};
    data.forEach(c => { const k = c.assignee_name || 'Без отговорник'; if (!byPerson[k]) byPerson[k] = []; byPerson[k].push(c); });
    return Object.entries(byPerson).sort(([a],[b]) => a.localeCompare(b)).map(([name, cards]) =>
      '<div class="task-section-label" style="color:var(--accent)">' + esc(name) + ' (' + cards.length + ')</div>' +
      cards.map(c => renderReportRow(c, tab)).join('')
    ).join('');
  }
  return data.map(c => renderReportRow(c, tab)).join('');
}
async function renderReports(el) {
  setBreadcrumb(null); el.className = '';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const tab = params.get('tab') || 'overdue';

  try {
    let data;
    const days = parseInt(params.get('days')) || 7;
    if (tab === 'overdue') data = await (await fetch('/api/reports/overdue')).json();
    else if (tab === 'upcoming') data = await (await fetch('/api/reports/upcoming?days=' + days)).json();
    else if (tab === 'assignments') {
      const uid = params.get('user_id') || '';
      data = await (await fetch('/api/reports/assignments' + (uid ? '?user_id=' + uid : ''))).json();
    } else data = await (await fetch('/api/reports/unassigned')).json();

    const upcomingDaysHtml = tab === 'upcoming' ? `
      <div style="display:flex;gap:6px;justify-content:center;margin-bottom:12px">
        ${[7,14,30].map(d => `<a href="#/reports?tab=upcoming&days=${d}" class="btn btn-sm btn-ghost${days===d?' active':''}" style="${days===d?'background:var(--accent-dim);color:var(--accent)':''}">${d} дни</a>`).join('')}
      </div>` : '';

    el.innerHTML = `
      <div style="max-width:800px;margin:0 auto">
        <div class="page-header"><h1>\ud83d\udcca \u041e\u0442\u0447\u0435\u0442\u0438</h1><div class="page-subtitle">${data.length} \u0440\u0435\u0437\u0443\u043b\u0442\u0430\u0442\u0430</div></div>
        <div style="display:flex;gap:8px;justify-content:center;margin-bottom:16px">
          <a href="#/reports?tab=overdue" class="btn btn-sm ${tab==='overdue'?'btn-primary':''}">🔴 Просрочени</a>
          <a href="#/reports?tab=upcoming" class="btn btn-sm ${tab==='upcoming'?'btn-primary':''}">🟡 Предстоящи</a>
          <a href="#/reports?tab=assignments" class="btn btn-sm ${tab==='assignments'?'btn-primary':''}">👤 По хора</a>
          <a href="#/reports?tab=unassigned" class="btn btn-sm ${tab==='unassigned'?'btn-primary':''}">❓ Невъзложени</a>
        </div>
        ${upcomingDaysHtml}
        <div class="task-list">
          ${renderReportRows(data, tab)}
        </div>
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

// ==================== COLUMN PERMALINK VIEW ====================
async function renderColumnView(el, id) {
  setBreadcrumb(null); el.className = 'page-column';
  try {
    const [col, cards] = await Promise.all([
      (await fetch(`/api/boards/columns/${id}`)).json(),
      (await fetch(`/api/cards?column_id=${id}`)).json()
    ]);
    if (col.error) { el.innerHTML = `<div style="text-align:center;padding:60px;color:var(--red)">${esc(col.error)}</div>`; return; }

    setBreadcrumb([
      { label: col.board_title, href: `#/board/${col.board_id}` },
      { label: col.title }
    ]);

    const allCards = Array.isArray(cards) ? cards : [];
    const isDone = !!col.is_done_column;
    let cardsHtml = '';

    if (isDone) {
      // Done column: group cards by completion date, newest first
      const sorted = allCards.slice().sort((a, b) => {
        const da = a.completed_at ? new Date(a.completed_at) : new Date(0);
        const db = b.completed_at ? new Date(b.completed_at) : new Date(0);
        return db - da;
      });
      const groups = {};
      sorted.forEach(c => {
        const d = c.completed_at ? new Date(c.completed_at) : null;
        const key = d ? d.toISOString().slice(0, 10) : 'unknown';
        if (!groups[key]) groups[key] = [];
        groups[key].push(c);
      });
      const dateKeys = Object.keys(groups).sort().reverse();
      if (dateKeys.length === 0) {
        cardsHtml = '<div class="column-view__empty">Няма завършени карти</div>';
      } else {
        cardsHtml = dateKeys.map(key => {
          const label = key === 'unknown' ? 'Без дата' : _formatDoneDate(key);
          return `<div class="column-view__date-group">
            <div class="column-view__date-label">${label}</div>
            ${groups[key].map(c => renderKanbanCard(c, null)).join('')}
          </div>`;
        }).join('');
      }
    } else {
      // Regular column: active cards then on-hold
      const activeCards = allCards.filter(c => !c.is_on_hold);
      const holdCards = allCards.filter(c => c.is_on_hold);
      if (activeCards.length === 0 && holdCards.length === 0) {
        cardsHtml = '<div class="column-view__empty">Няма задачи в тази колона</div>';
      } else {
        cardsHtml = activeCards.map(c => renderKanbanCard(c, null)).join('');
        if (holdCards.length > 0) {
          cardsHtml += `<div class="column-view__section-label">На изчакване (${holdCards.length})</div>`;
          cardsHtml += holdCards.map(c => renderKanbanCard(c, null)).join('');
        }
      }
    }

    const subtitle = isDone
      ? `${allCards.length} завършени`
      : `${allCards.filter(c=>!c.is_on_hold).length} задачи${allCards.filter(c=>c.is_on_hold).length > 0 ? ` · ${allCards.filter(c=>c.is_on_hold).length} на изчакване` : ''}`;

    el.innerHTML = `
      <div class="column-view">
        <div class="column-view__header">
          <h1 class="column-view__title">${esc(col.title)}</h1>
          <div class="column-view__subtitle">${esc(col.board_title)} · ${subtitle}</div>
        </div>
        <div class="column-view__cards">
          ${cardsHtml}
        </div>
      </div>`;
  } catch(e) {
    el.innerHTML = `<div style="text-align:center;padding:60px;color:var(--red)">Грешка: ${esc(e.message)}</div>`;
  }
}

function _formatDoneDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (d.getTime() === today.getTime()) return 'Днес';
  if (d.getTime() === yesterday.getTime()) return 'Вчера';
  const months = ['януари','февруари','март','април','май','юни','юли','август','септември','октомври','ноември','декември'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// ==================== КП АВТОМАТИЗАЦИЯ ====================
