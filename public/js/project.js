// ==================== PROJECT PAGE + BOARD CREATION ====================
async function renderProject(el, projectId) {
  setBreadcrumb(null);
  el.className = 'wide';
  try {
    const [boards, cards] = await Promise.all([
      (await fetch('/api/boards')).json(),
      (await fetch('/api/cards')).json()
    ]);
    allBoards = boards;

    el.innerHTML = `
      <div class="page-header" style="margin-bottom:16px">
        <img src="/img/logo-white.svg" alt="The Pact" style="height:40px;margin-bottom:8px">
        <div style="font-size:13px;color:var(--text-dim)">Видео Продукция</div>
      </div>

      <div class="projects-home-grid" style="grid-template-columns:repeat(3, 1fr);max-width:900px">
        ${boards.map((board, bi) => {
          const now = new Date(); now.setHours(0,0,0,0);
          const bc = cards.filter(c => c.board_id === board.id && !c.completed_at && !c.archived_at);
          const overdue = bc.filter(c => isCardOverdue(c, now)).length;
          return '<a href="#/board/' + board.id + '" class="project-card-home">' +
            '<div class="project-card-home__header">' +
              '<div style="display:flex;justify-content:space-between;align-items:center">' +
                '<div class="project-card-home__title">' + esc(board.title) + '</div>' +
                (overdue > 0 ? '<span style="background:rgba(239,68,68,.2);color:var(--red);font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px">\u26a0 ' + overdue + '</span>' : '') +
              '</div>' +
            '</div>' +
            '<div class="project-card-home__body">' +
              '<div style="font-size:11px;color:var(--text-dim)">' + bc.length + ' карти \xb7 ' + (board.columns?.filter(c=>!c.is_done_column).length || 0) + ' колони</div>' +
            '</div>' +
          '</a>';
        }).join('')}

        <a href="#/campfire/1" class="project-card-home">
          <div class="project-card-home__header"><div class="project-card-home__title">\ud83d\udd25 Campfire</div></div>
          <div class="project-card-home__body"><div style="font-size:11px;color:var(--text-dim)">\u0427\u0430\u0442</div></div>
        </a>

        <a href="#/schedule" class="project-card-home">
          <div class="project-card-home__header"><div class="project-card-home__title">\ud83d\udcc5 \u0413\u0440\u0430\u0444\u0438\u043a</div></div>
          <div class="project-card-home__body"><div style="font-size:11px;color:var(--text-dim)">\u0421\u044a\u0431\u0438\u0442\u0438\u044f</div></div>
        </a>

        <a href="#/checkins" class="project-card-home">
          <div class="project-card-home__header"><div class="project-card-home__title">\u270b \u0414\u0435\u0439\u043d\u043e\u0441\u0442\u0438</div></div>
          <div class="project-card-home__body"><div style="font-size:11px;color:var(--text-dim)">\u0412\u044a\u043f\u0440\u043e\u0441\u0438</div></div>
        </a>

        <a href="#/chat" class="project-card-home">
          <div class="project-card-home__header"><div class="project-card-home__title">\ud83d\udcac \u0427\u0430\u0442</div></div>
          <div class="project-card-home__body"><div style="font-size:11px;color:var(--text-dim)">\u0421\u044a\u043e\u0431\u0449\u0435\u043d\u0438\u044f</div></div>
        </a>

        <a href="#/messages" class="project-card-home">
          <div class="project-card-home__header"><div class="project-card-home__title">\ud83d\udce2 \u0418\u0437\u0432\u0435\u0441\u0442\u0438\u044f</div></div>
          <div class="project-card-home__body"><div style="font-size:11px;color:var(--text-dim)">\u0411\u043e\u0440\u0434</div></div>
        </a>

        <a href="#/vault" class="project-card-home">
          <div class="project-card-home__header"><div class="project-card-home__title">\ud83d\udcc1 \u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0438</div></div>
          <div class="project-card-home__body"><div style="font-size:11px;color:var(--text-dim)">\u0424\u0430\u0439\u043b\u043e\u0432\u0435</div></div>
        </a>

        ${canManage() ? `
        <div class="project-card-home project-card-home--new" style="cursor:pointer" onclick="promptCreateBoard()">
          <div class="project-card-home__header"></div>
          <div class="project-card-home__body" style="align-items:center;justify-content:center">
            <div class="project-card-home__title" style="font-size:14px">+ \u0414\u043e\u0431\u0430\u0432\u0438</div>
          </div>
        </div>` : ''}
      </div>

      <div style="margin-top:48px;max-width:700px;margin-left:auto;margin-right:auto">
        <h2 style="text-align:center;font-size:16px;font-weight:700;color:#fff;margin-bottom:20px">Активност по проекта</h2>
        <div id="projectActivity" style="color:var(--text-dim);text-align:center;padding:20px">Зареждане...</div>
      </div>
    `;
    // Load project activity
    loadProjectActivity();
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

async function loadProjectActivity() {
  try {
    const items = await (await fetch('/api/activity?limit=20')).json();
    const container = document.getElementById('projectActivity');
    if (!container) return;
    container.innerHTML = items.length === 0
      ? '<div style="color:var(--text-dim)">Няма активност все още</div>'
      : items.map(a => `
          <div class="activity-entry" style="text-align:left">
            <div class="activity-avatar" style="background:${a.user_avatar ? 'none' : _avColor(a.user_name)};width:28px;height:28px;font-size:10px">${_avInner(a.user_name || '', a.user_avatar)}</div>
            <div class="activity-body">
              <div class="activity-text"><strong>${esc(a.user_name || '')}</strong> ${a.action === 'created' ? 'създаде' : a.action === 'commented' ? 'коментира' : a.action === 'moved' ? 'премести' : a.action === 'completed' ? 'завърши' : a.action === 'checked_off' ? 'отметна стъпка на' : a.action === 'archived' ? 'архивира' : a.action === 'updated' ? 'обнови' : a.action} ${a.target_type === 'card' ? `<a href="#/card/${a.target_id}">${esc(a.target_title || '')}</a>` : esc(a.target_title || '')}</div>
              <div class="activity-meta">${timeAgo(a.created_at)}</div>
            </div>
          </div>
        `).join('');
  } catch {}
}

function promptCreateBoard() {
  var ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box" style="max-width:400px">' +
    '<p class="confirm-modal-msg" style="margin-bottom:16px">Какво искаш да създадеш?</p>' +
    '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<button class="btn-create-choice" onclick="promptCreateBoardType(\'board\');this.closest(\'.modal-overlay\').remove()">' +
        '<span class="btn-create-choice__icon">📋</span>' +
        '<div><div class="btn-create-choice__title">Борд</div>' +
        '<div class="btn-create-choice__desc">Kanban борд с колони за управление на задачи</div></div>' +
      '</button>' +
      '<button class="btn-create-choice" onclick="promptCreateBoardType(\'docs\');this.closest(\'.modal-overlay\').remove()">' +
        '<span class="btn-create-choice__icon">📁</span>' +
        '<div><div class="btn-create-choice__title">Docs & Files</div>' +
        '<div class="btn-create-choice__desc">Споделяне и организиране на документи, таблици, снимки и други файлове</div></div>' +
      '</button>' +
    '</div>' +
    '<div class="confirm-modal-actions" style="margin-top:16px"><button class="btn btn-ghost" onclick="this.closest(\'.modal-overlay\').remove()">Отказ</button></div>' +
  '</div>';
  document.body.appendChild(ov);
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
}
function promptCreateBoardType(type) {
  var label = type === 'docs' ? 'Docs & Files' : 'Нов борд';
  showPromptModal(label, 'Въведи заглавие…', '', async function(title) {
    try {
      await fetch('/api/boards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title, type: type }) });
      showToast(type === 'docs' ? 'Docs & Files е създаден' : 'Бордът е създаден', 'success');
      router();
    } catch { showToast('Грешка при създаване', 'error'); }
  });
}

// ==================== BOARD (CARD TABLE) ====================
