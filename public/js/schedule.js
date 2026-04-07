// ==================== SCHEDULE + CALENDAR + CHECK-INS ====================
async function renderSchedule(el) {
  setBreadcrumb([{label:'График',href:'#/schedule'}]);
  el.className = '';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const now = new Date();
  const year = parseInt(params.get('y')) || now.getFullYear();
  const month = parseInt(params.get('m')) || now.getMonth();
  const monthStr = `${year}-${String(month+1).padStart(2,'0')}`;

  try {
    const events = await (await fetch(`/api/schedule?month=${monthStr}`)).json();
    const monthName = new Date(year, month).toLocaleDateString('bg', {month:'long', year:'numeric'});
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = now.getDate();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
    const dayNames = ['НД','ПН','ВТ','СР','ЧТ','ПТ','СБ'];

    const prevM = month === 0 ? 11 : month - 1;
    const prevY = month === 0 ? year - 1 : year;
    const nextM = month === 11 ? 0 : month + 1;
    const nextY = month === 11 ? year + 1 : year;

    // Build day cells
    let cells = '';
    for (let i = 0; i < firstDay; i++) cells += '<div class="schedule-day schedule-day--empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayEvents = events.filter(e => e.starts_at?.startsWith(dateStr));
      const isToday = isCurrentMonth && d === today;
      cells += `<div class="schedule-day ${isToday ? 'schedule-day--today' : ''} ${dayEvents.length ? 'schedule-day--has-events' : ''}">
        <div class="schedule-day__num">${d}</div>
        ${dayEvents.slice(0,3).map(e => `<div class="schedule-event" style="background:${e.color || 'var(--accent-dim)'}; color:${e.color ? '#fff' : 'var(--accent)'}" title="${esc(e.title)}">${esc(e.title)}</div>`).join('')}
        ${dayEvents.length > 3 ? `<div class="schedule-event-more">+${dayEvents.length - 3} още</div>` : ''}
      </div>`;
    }

    el.innerHTML = `
      <div style="max-width:900px;margin:0 auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
          <button class="btn btn-sm" onclick="location.hash='#/schedule?y=${prevY}&m=${prevM}'">&larr; Предишен</button>
          <h1 style="font-size:22px;font-weight:800;color:#fff;text-transform:capitalize">${monthName}</h1>
          <div style="display:flex;gap:8px">
            ${canManage() ? '<button class="btn btn-primary btn-sm" onclick="createScheduleEvent()">+ Събитие</button>' : ''}
            <button class="btn btn-sm" onclick="location.hash='#/schedule?y=${nextY}&m=${nextM}'">Следващ &rarr;</button>
          </div>
        </div>
        <div class="schedule-calendar">
          <div class="schedule-header">${dayNames.map(d => `<div class="schedule-header__day">${d}</div>`).join('')}</div>
          <div class="schedule-grid">${cells}</div>
        </div>
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
function createScheduleEvent() {
  var today = new Date().toISOString().split('T')[0];
  var ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box"><p class="confirm-modal-msg">\u041d\u043e\u0432\u043e \u0441\u044a\u0431\u0438\u0442\u0438\u0435</p>' +
    '<input class="confirm-modal-input" id="evTitle" placeholder="\u0417\u0430\u0433\u043b\u0430\u0432\u0438\u0435\u2026">' +
    '<button class="bc-date-btn" id="evDate" data-value="' + today + '" onclick="event.stopPropagation();showDatePickerPopup(this,this.dataset.value,function(d){var b=document.getElementById(\'evDate\');if(b){b.dataset.value=d||\'\';b.textContent=d?formatDate(d):\'Избери дата\u2026\';b.className=d?\'bc-date-btn\':\'bc-date-btn bc-date-btn--placeholder\';}})" style="margin-bottom:8px;width:100%;text-align:left">' + formatDate(today) + '</button>' +
    '<div class="confirm-modal-actions"><button class="btn btn-primary" id="evOk">\u0421\u044a\u0437\u0434\u0430\u0439</button><button class="btn btn-ghost" id="evCancel">\u041e\u0442\u043a\u0430\u0437</button></div></div>';
  document.body.appendChild(ov);
  setTimeout(function(){ ov.querySelector('#evTitle').focus(); }, 50);
  ov.querySelector('#evOk').onclick = async function() {
    var t = ov.querySelector('#evTitle').value.trim(); if (!t) { ov.querySelector('#evTitle').focus(); return; }
    var d = ov.querySelector('#evDate').dataset.value; if (!d) { showToast('\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430', 'warn'); return; }
    ov.remove();
    try { await fetch('/api/schedule', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t,starts_at:d+'T09:00:00',all_day:true})}); showToast('\u0421\u044a\u0431\u0438\u0442\u0438\u0435\u0442\u043e \u0435 \u0434\u043e\u0431\u0430\u0432\u0435\u043d\u043e', 'success'); router(); } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0434\u043e\u0431\u0430\u0432\u044f\u043d\u0435 \u043d\u0430 \u0441\u044a\u0431\u0438\u0442\u0438\u0435', 'error'); }
  };
  ov.querySelector('#evCancel').onclick = function() { ov.remove(); };
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
  ov.querySelector('#evTitle').onkeydown = function(e) { if (e.key === 'Escape') ov.remove(); };
}

// ==================== AUTOMATIC CHECK-INS ====================
async function renderCheckins(el) {
  setBreadcrumb([{label:'✋ Дейности'}]);
  el.className = '';
  try {
    const [questions, pending] = await Promise.all([
      (await fetch('/api/checkins/questions')).json(),
      (await fetch('/api/checkins/my-pending')).json()
    ]);

    el.innerHTML = `
      <div style="max-width:700px;margin:0 auto">
        <div class="page-header">
          <h1>✋ Дейности</h1>
          <p class="page-subtitle">Автоматични въпроси към екипа</p>
        </div>

        ${pending.length > 0 ? `
          <div style="margin-bottom:32px">
            <h2 style="font-size:16px;font-weight:700;color:var(--yellow);margin-bottom:16px">📝 Чакат твоя отговор</h2>
            ${pending.map(q => `
              <div class="checkin-question">
                <div class="checkin-question__text">${esc(q.question)}</div>
                <div class="checkin-response-form">
                  <textarea id="checkinResponse${q.id}" placeholder="Твоят отговор..." rows="3"></textarea>
                  <button class="btn btn-primary btn-sm" onclick="submitCheckinResponse(${q.id})">Изпрати</button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<div style="text-align:center;padding:20px;color:var(--green);margin-bottom:24px">✅ Нямаш чакащи check-ins!</div>'}

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="font-size:16px;font-weight:700;color:#fff">Всички въпроси</h2>
          ${canManage() ? '<button class="btn btn-primary btn-sm" onclick="createCheckinQuestion()">+ Нов въпрос</button>' : ''}
        </div>
        <div class="checkin-list">
          ${questions.length === 0 ? '<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма конфигурирани check-in въпроси.</div>' :
            questions.map(q => `
              <div class="checkin-question" onclick="viewCheckinResponses(${q.id})" style="cursor:pointer">
                <div class="checkin-question__text">${esc(q.question)}</div>
                <div style="font-size:11px;color:var(--text-dim);margin-top:4px">Cron: ${esc(q.schedule_cron)} · ${q.is_active ? '<span style="color:var(--green)">Активен</span>' : '<span style="color:var(--red)">Неактивен</span>'}</div>
              </div>
            `).join('')}
        </div>
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
async function submitCheckinResponse(questionId) {
  const c = document.getElementById(`checkinResponse${questionId}`)?.value?.trim(); if(!c) return;
  try { await fetch(`/api/checkins/questions/${questionId}/responses`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:c})}); showToast('\u041e\u0442\u0433\u043e\u0432\u043e\u0440\u044a\u0442 \u0435 \u0438\u0437\u043f\u0440\u0430\u0442\u0435\u043d', 'success'); router(); } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0438\u0437\u043f\u0440\u0430\u0449\u0430\u043d\u0435', 'error'); }
}
function createCheckinQuestion() {
  var ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box"><p class="confirm-modal-msg">\u041d\u043e\u0432 \u0447\u0435\u043a-\u0438\u043d \u0432\u044a\u043f\u0440\u043e\u0441</p>' +
    '<input class="confirm-modal-input" id="ciQ" placeholder="\u041d\u0430\u043f\u0440. \u201e\u041a\u0430\u043a\u0432\u043e \u0441\u0432\u044a\u0440\u0448\u0438 \u0434\u043d\u0435\u0441?\u201c">' +
    '<input class="confirm-modal-input" id="ciCron" value="0 9 * * 1-5" placeholder="Cron \u0438\u0437\u0440\u0430\u0437\u2026">' +
    '<div style="font-size:11px;color:var(--text-dim);margin:-10px 0 14px">\u041f\u043e \u043f\u043e\u0434\u0440\u0430\u0437\u0431\u0438\u0440\u0430\u043d\u0435: \u0432\u0441\u0435\u043a\u0438 \u0434\u0435\u043b\u043d\u0438\u0447\u0435\u043d \u0434\u0435\u043d \u0432 9:00</div>' +
    '<div class="confirm-modal-actions"><button class="btn btn-primary" id="ciOk">\u0421\u044a\u0437\u0434\u0430\u0439</button><button class="btn btn-ghost" id="ciCancel">\u041e\u0442\u043a\u0430\u0437</button></div></div>';
  document.body.appendChild(ov);
  setTimeout(function(){ ov.querySelector('#ciQ').focus(); }, 50);
  ov.querySelector('#ciOk').onclick = async function() {
    var q = ov.querySelector('#ciQ').value.trim(); if (!q) { ov.querySelector('#ciQ').focus(); return; }
    var cron = ov.querySelector('#ciCron').value || '0 9 * * 1-5';
    ov.remove();
    try { await fetch('/api/checkins/questions', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q,schedule_cron:cron})}); showToast('\u0427\u0435\u043a-\u0438\u043d \u0432\u044a\u043f\u0440\u043e\u0441\u044a\u0442 \u0435 \u0441\u044a\u0437\u0434\u0430\u0434\u0435\u043d', 'success'); router(); } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0441\u044a\u0437\u0434\u0430\u0432\u0430\u043d\u0435', 'error'); }
  };
  ov.querySelector('#ciCancel').onclick = function() { ov.remove(); };
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
  ov.querySelector('#ciQ').onkeydown = function(e) { if (e.key === 'Escape') ov.remove(); };
}
async function viewCheckinResponses(questionId) {
  try {
    const responses = await (await fetch(`/api/checkins/questions/${questionId}/responses`)).json();
    const campColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308'];
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    var inner = document.createElement('div');
    inner.style.cssText = 'background:var(--bg-card);border:1px solid var(--border);border-radius:12px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;padding:24px';
    inner.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
      '<h3 style="font-size:16px;font-weight:700;color:#fff">\u041e\u0442\u0433\u043e\u0432\u043e\u0440\u0438 (' + responses.length + ')</h3>' +
      '<button onclick="this.closest(\'.modal-overlay\').remove()" style="background:none;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;line-height:1">\u2715</button>' +
      '</div>' +
      (responses.length === 0
        ? '<div style="text-align:center;color:var(--text-dim);padding:24px">\u041d\u044f\u043c\u0430 \u043e\u0442\u0433\u043e\u0432\u043e\u0440\u0438 \u0432\u0441\u0435 \u043e\u0449\u0435</div>'
        : responses.map(function(r) {
            var col = campColors[(r.user_name||'').length % campColors.length];
            return '<div style="padding:12px 0;border-bottom:1px solid var(--border)">' +
              '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
              '<div style="width:28px;height:28px;border-radius:50%;background:' + (r.user_avatar ? 'none' : col) + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden">' + _avInner(r.user_name||'', r.user_avatar) + '</div>' +
              '<strong style="font-size:13px;color:#fff">' + esc(r.user_name||'') + '</strong>' +
              '<span style="font-size:11px;color:var(--text-dim);margin-left:6px">' + timeAgo(r.created_at) + '</span>' +
              '</div>' +
              '<div style="font-size:13px;color:var(--text-secondary);padding-left:36px">' + esc(r.content||'') + '</div>' +
              '</div>';
          }).join(''));
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
  } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0437\u0430\u0440\u0435\u0436\u0434\u0430\u043d\u0435', 'error'); }
}

// ==================== ADMIN PANEL ====================
