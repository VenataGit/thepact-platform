// ==================== ACTIVITY + MY STUFF + NOTIFICATIONS + MESSAGE BOARD + BOOKMARKS ====================
function filterActivity(board, btn) {
  document.querySelectorAll('.activity-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const toShow = board === 'all' ? _activityItems : board === 'mine' ? _activityItems.filter(a => a.user_id === currentUser.id) : _activityItems.filter(a => a.board_title === board);
  const container = document.getElementById('activityList');
  if (!container) return;
  const grouped = {};
  toShow.forEach(a => {
    const d = new Date(a.created_at);
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
    const dateKey = d >= today ? 'ДНЕС' : d >= yesterday ? 'ВЧЕРА' : d.toLocaleDateString('bg', { month: 'long', day: 'numeric', year: 'numeric' });
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(a);
  });
  container.innerHTML = toShow.length === 0 ? '<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма активност</div>' :
    Object.entries(grouped).map(([date, entries]) =>
      '<div style="margin-bottom:24px"><div style="font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;padding:8px 0;border-bottom:1px solid var(--border);margin-bottom:8px">' + date + '</div>' +
      entries.map(a =>
        '<div class="activity-entry"><div class="activity-avatar" style="background:' + (a.user_avatar ? 'none' : _avColor(a.user_name)) + '">' + _avInner(a.user_name||'', a.user_avatar) + '</div>' +
        '<div class="activity-body"><div class="activity-text"><strong>' + esc(a.user_name||'') + '</strong> ' +
        (a.action==='created'?'създаде':a.action==='commented'?'коментира':a.action==='moved'?'премести':a.action==='completed'?'завърши':a.action==='checked_off'?'отметна стъпка на':a.action==='archived'?'архивира':a.action==='updated'?'обнови':a.action) + ' ' +
        (a.target_type==='card' ? '<a href="#/card/' + a.target_id + '">' + esc(a.target_title||'') + '</a>' : esc(a.target_title||'')) + '</div>' +
        (a.excerpt ? '<div class="activity-excerpt">' + esc(a.excerpt).substring(0,150) + '</div>' : '') +
        '<div class="activity-meta">' + (a.board_title ? esc(a.board_title) + ' · ' : '') + timeAgo(a.created_at) + '</div></div></div>'
      ).join('') + '</div>'
    ).join('');
}
async function renderActivity(el) {
  setBreadcrumb(null); el.className = '';
  try {
    const _actRes = await fetch('/api/activity?limit=50');
    const _actData = await _actRes.json();
    const items = Array.isArray(_actData) ? _actData : [];
    _activityItems = items;
    // Group by date
    const grouped = {};
    items.forEach(a => {
      const d = new Date(a.created_at);
      const today = new Date(); today.setHours(0,0,0,0);
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
      const dateKey = d >= today ? 'ДНЕС' : d >= yesterday ? 'ВЧЕРА' : d.toLocaleDateString('bg', { month: 'long', day: 'numeric', year: 'numeric' });
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push(a);
    });

    const actionText = (a) => {
      if (a.action === 'created') return 'създаде';
      if (a.action === 'commented') return 'коментира';
      if (a.action === 'moved') return 'премести';
      if (a.action === 'completed') return 'завърши';
      if (a.action === 'checked_off') return 'отметна стъпка на';
      if (a.action === 'archived') return 'архивира';
      if (a.action === 'updated') return 'обнови';
      return a.action;
    };

    window._activityOffset = items.length;
    el.innerHTML = `
      <div class="home-content-box">
      <div class="page-header"><h1>Последна активност</h1></div>
      <div style="display:flex;justify-content:center;gap:8px;margin-bottom:24px;flex-wrap:wrap">
        <button class="btn btn-sm activity-filter-btn active" style="background:var(--accent-dim);color:var(--accent);border-color:var(--accent)" onclick="filterActivity('all',this)">\u0412\u0441\u0438\u0447\u043a\u043e</button>
        <button class="btn btn-sm activity-filter-btn" onclick="filterActivity('mine',this)">\ud83d\udc64 \u041c\u043e\u0438\u0442\u0435</button>
        ${[...new Set(items.filter(a=>a.board_title).map(a=>a.board_title))].slice(0,5).map(b=>`<button class="btn btn-sm activity-filter-btn" onclick="filterActivity('${b.replace(/'/g,'')}',this)">${esc(b)}</button>`).join('')}
      </div>
      <div id="activityList" style="max-width:700px;margin:0 auto">
        ${items.length===0?'<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма активност все още</div>':
          Object.entries(grouped).map(([date, entries]) => `
            <div style="margin-bottom:24px">
              <div style="font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;padding:8px 0;border-bottom:1px solid var(--border);margin-bottom:8px">${date}</div>
              ${entries.map(a=>`
                <div class="activity-entry">
                  <div class="activity-avatar" style="background:${a.user_avatar ? 'none' : _avColor(a.user_name)}">${_avInner(a.user_name||'', a.user_avatar)}</div>
                  <div class="activity-body">
                    <div class="activity-text"><strong>${esc(a.user_name||'')}</strong> ${actionText(a)} ${a.target_type==='card'?`<a href="#/card/${a.target_id}">${esc(a.target_title||'')}</a>`:esc(a.target_title||'')}</div>
                    ${a.excerpt ? `<div class="activity-excerpt">${esc(a.excerpt).substring(0,150)}</div>` : ''}
                    <div class="activity-meta">${a.board_title ? esc(a.board_title) + ' · ' : ''}${timeAgo(a.created_at)}</div>
                  </div>
                </div>`).join('')}
            </div>`).join('')}
      </div>
      ${items.length >= 50 ? `<div style="text-align:center;padding:24px"><button class="btn btn-sm btn-ghost" id="loadMoreActivityBtn" onclick="loadMoreActivity(this)">\u0417\u0430\u0440\u0435\u0434\u0438 \u043f\u043e\u0432\u0435\u0447\u0435</button></div>` : ''}
      </div>
      `;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

async function loadMoreActivity(btn) {
  if (!btn) return;
  btn.disabled = true; btn.textContent = '\u0417\u0430\u0440\u0435\u0436\u0434\u0430\u043d\u0435\u2026';
  try {
    const offset = window._activityOffset || 50;
    const more = await (await fetch('/api/activity?limit=50&offset=' + offset)).json();
    window._activityOffset = offset + more.length;
    if (!Array.isArray(more) || more.length === 0) { btn.parentElement.remove(); return; }
    _activityItems = (_activityItems || []).concat(more);
    const list = document.getElementById('activityList');
    if (!list) return;
    const actionText = a => { if(a.action==='created')return'\u0441\u044a\u0437\u0434\u0430\u0434\u0435'; if(a.action==='commented')return'\u043a\u043e\u043c\u0435\u043d\u0442\u0438\u0440\u0430'; if(a.action==='moved')return'\u043f\u0440\u0435\u043c\u0435\u0441\u0442\u0438'; if(a.action==='completed')return'\u0437\u0430\u0432\u044a\u0440\u0448\u0438'; if(a.action==='checked_off')return'\u043e\u0442\u043c\u0435\u0442\u043d\u0430 \u0441\u0442\u044a\u043f\u043a\u0430 \u043d\u0430'; if(a.action==='archived')return'\u0430\u0440\u0445\u0438\u0432\u0438\u0440\u0430'; if(a.action==='updated')return'\u043e\u0431\u043d\u043e\u0432\u0438'; return a.action; };
    const frag = document.createDocumentFragment();
    const div = document.createElement('div');
    div.innerHTML = more.map(a => `<div class="activity-entry">
      <div class="activity-avatar" style="background:${a.user_avatar ? 'none' : _avColor(a.user_name)}">${_avInner(a.user_name||'', a.user_avatar)}</div>
      <div class="activity-body">
        <div class="activity-text"><strong>${esc(a.user_name||'')}</strong> ${actionText(a)} ${a.target_type==='card'?`<a href="#/card/${a.target_id}">${esc(a.target_title||'')}</a>`:esc(a.target_title||'')}</div>
        ${a.excerpt ? `<div class="activity-excerpt">${esc(a.excerpt).substring(0,150)}</div>` : ''}
        <div class="activity-meta">${a.board_title ? esc(a.board_title) + ' \u00b7 ' : ''}${timeAgo(a.created_at)}</div>
      </div></div>`).join('');
    list.appendChild(div);
    if (more.length < 50) btn.parentElement.remove();
    else { btn.disabled = false; btn.textContent = '\u0417\u0430\u0440\u0435\u0434\u0438 \u043f\u043e\u0432\u0435\u0447\u0435'; }
  } catch { btn.disabled = false; btn.textContent = '\u0413\u0440\u0435\u0448\u043a\u0430 — \u043f\u0440\u043e\u0431\u0432\u0430\u0439 \u043f\u0430\u043a'; }
}

// ==================== MY STUFF ====================
async function renderMyStuff(el) {
  setBreadcrumb(null); el.className = '';
  try {
    const cards = await (await fetch(`/api/cards?assignee_id=${currentUser.id}`)).json();
    const now = new Date(); now.setHours(0,0,0,0);
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const overdue  = cards.filter(c => isCardOverdue(c, now));
    const upcoming = cards.filter(c => {
      const ed = getCardEarliestDeadline(c);
      return ed && ed >= now && !overdue.includes(c);
    });
    const noDate   = cards.filter(c => getCardRelevantDates(c).length === 0);
    const renderCard = c => {
      const pri = c.priority === 'urgent' ? '\ud83d\udd34 ' : c.priority === 'high' ? '\u2191 ' : '';
      const cls = getCardColorClass(c);
      const dueStyle = cls==='overdue' ? 'color:var(--red);font-weight:600' : cls==='deadline-today' ? 'color:var(--yellow);font-weight:600' : '';
      const duePrefix = cls==='overdue' ? '\u26a0 ' : cls==='deadline-today' ? '\u23f0 ' : '';
      return `<a class="task-row ${cls}" href="#/card/${c.id}">
        <span class="task-title">${pri}${esc(c.title)}</span>
        <span class="task-meta">
          ${c.client_name ? `<span class="task-board" style="color:var(--accent)">${esc(c.client_name)}</span>` : ''}
          ${c.board_title ? `<span class="task-board">${esc(c.board_title)}</span>` : ''}
          ${c.column_title ? `<span class="task-board" style="opacity:0.6">${esc(c.column_title)}</span>` : ''}
          ${c.steps_total > 0 ? `<span style="font-size:10px;color:var(--green)">✓ ${c.steps_done}/${c.steps_total}</span>` : ''}
          ${c.due_on ? `<span class="task-due" style="${dueStyle}">${duePrefix}${formatDate(c.due_on)}</span>` : ''}
        </span>
      </a>`;
    };
    el.innerHTML = `
      <div class="home-content-box">
      <div class="page-header"><h1>Моите задачи</h1><div class="page-subtitle">${cards.length} задачи</div></div>
      <div class="task-list">
        ${cards.length===0 ? '<div style="text-align:center;padding:40px;color:var(--text-dim)"><div style="font-size:48px;opacity:0.3;margin-bottom:8px">✓</div>Нямаш задачи в момента</div>' : ''}
        ${overdue.length  > 0 ? `<div class="task-section-label" style="color:var(--red)">🔴 Просрочени (${overdue.length})</div>${overdue.map(renderCard).join('')}` : ''}
        ${upcoming.length > 0 ? `<div class="task-section-label">📅 Предстоящи (${upcoming.length})</div>${upcoming.map(renderCard).join('')}` : ''}
        ${noDate.length   > 0 ? `<div class="task-section-label" style="opacity:0.6">Без дата (${noDate.length})</div>${noDate.map(renderCard).join('')}` : ''}
      </div>
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

// ==================== NOTIFICATIONS ====================
async function renderNotifications(el) {
  setBreadcrumb(null); el.className = '';
  try {
    const items = await (await fetch('/api/notifications')).json();
    const unread = items.filter(n => !n.is_read);
    const read = items.filter(n => n.is_read);

    function _renderFullItem(n) {
      const senderName = n.sender_name || '';
      const savUrl = _findAvatar(senderName);
      const link = n.reference_type === 'card' ? '#/card/' + n.reference_id : '#';
      const scrollId = (n.reference_type === 'card' && n.comment_id) ? n.comment_id : null;
      return '<a class="hey-item' + (n.is_read ? '' : ' unread') + '" href="' + link + '"' +
        (scrollId ? ' onclick="heyClickItem('+n.id+','+scrollId+')"' : (n.is_read ? '' : ' onclick="heyClickItem('+n.id+',null)"')) + '>' +
        '<div class="hey-item__av" style="background:' + (savUrl ? 'none' : _avColor(senderName)) + '">' + _avInner(senderName, savUrl) + '</div>' +
        '<div class="hey-item__content">' +
          '<div class="hey-item__subject">' + esc(n.title) + '</div>' +
          (n.body ? '<div class="hey-item__preview">' + esc(n.body) + '</div>' : '') +
          '<div class="hey-item__meta">' + (n.type === 'reminder' ? 'Напомняне · ' : '') + timeAgo(n.created_at) + '</div>' +
        '</div>' +
        (!n.is_read ? '<div class="hey-item__unread-dot"></div>' : '') +
      '</a>';
    }

    var listHtml = '';
    if (items.length === 0) {
      listHtml = '<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма известия.</div>';
    } else {
      if (unread.length > 0) {
        listHtml += '<div class="hey-section-label hey-section-label--new">Нови (' + unread.length + ')</div>';
        listHtml += unread.map(_renderFullItem).join('');
      }
      if (read.length > 0) {
        listHtml += '<div class="hey-section-label hey-section-label--read">Прочетени</div>';
        listHtml += read.map(_renderFullItem).join('');
      }
    }

    // Mark unread as read after rendering (so user sees them highlighted first)
    if (unread.length > 0) {
      fetch('/api/notifications/read-all', { method:'PUT' });
      updateHeyBadge();
    }

    el.innerHTML = `
      <div class="home-content-box">
      <div class="page-header">
        <h1>Hey!</h1>
        <div class="page-subtitle">Твоите известия</div>
      </div>
      <div style="border-radius:8px;overflow:hidden;border:1px solid var(--border)">
        ${listHtml}
      </div>
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

// ==================== CHAT (PINGS) ====================
let _chatSelectedUsers = [];
let _activeChatChannel = null;
async function renderMessageBoard(el) {
  setBreadcrumb([{label:'Съобщения'}]); el.className='';
  try {
    const msgs = await (await fetch('/api/messageboard')).json();
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <button class="btn btn-primary btn-sm" onclick="createMessage()">+ Ново съобщение</button>
        <h1 style="font-size:22px;font-weight:800;color:#fff;text-align:center;flex:1">Съобщения</h1>
        ${canManage()?'<button class="btn btn-sm" onclick="generateDailyReport()">\ud83d\udcca Дневен отчет</button>':'<div></div>'}
      </div>
      <div style="max-width:700px;margin:0 auto">
        ${msgs.map(m=>`<div class="message-item ${m.pinned?'pinned':''}"><div class="message-header"><strong>${esc(m.user_name||'Система')}</strong><span class="badge">${esc(m.category)}</span>${m.pinned?'<span class="badge badge-accent">📌</span>':''}<span class="hint">${timeAgo(m.created_at)}</span></div><h3>${esc(m.title)}</h3><div class="message-content">${esc(m.content||'').replace(/\n/g,'<br>')}</div></div>`).join('')}
        ${msgs.length===0?'<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма съобщения все още</div>':''}
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
function createMessage() {
  var ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box"><p class="confirm-modal-msg">\u041d\u043e\u0432\u043e \u0441\u044a\u043e\u0431\u0449\u0435\u043d\u0438\u0435</p>' +
    '<input class="confirm-modal-input" id="msgTitle" placeholder="\u0417\u0430\u0433\u043b\u0430\u0432\u0438\u0435\u2026">' +
    '<textarea class="confirm-modal-input" id="msgContent" rows="4" placeholder="\u0421\u044a\u0434\u044a\u0440\u0436\u0430\u043d\u0438\u0435 (\u043d\u0435\u0437\u0430\u0434\u044a\u043b\u0436\u0438\u0442\u0435\u043b\u043d\u043e)\u2026" style="resize:vertical"></textarea>' +
    '<div class="confirm-modal-actions"><button class="btn btn-primary" id="msgOk">\u0421\u044a\u0437\u0434\u0430\u0439</button><button class="btn btn-ghost" id="msgCancel">\u041e\u0442\u043a\u0430\u0437</button></div></div>';
  document.body.appendChild(ov);
  var inp = ov.querySelector('#msgTitle'); setTimeout(function(){ inp.focus(); }, 50);
  ov.querySelector('#msgOk').onclick = async function() {
    var t = ov.querySelector('#msgTitle').value.trim(); if (!t) { ov.querySelector('#msgTitle').focus(); return; }
    var c = ov.querySelector('#msgContent').value;
    ov.remove();
    try { await fetch('/api/messageboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t,content:c})}); showToast('\u0421\u044a\u043e\u0431\u0449\u0435\u043d\u0438\u0435\u0442\u043e \u0435 \u043f\u0443\u0431\u043b\u0438\u043a\u0443\u0432\u0430\u043d\u043e', 'success'); router(); } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u043f\u0443\u0431\u043b\u0438\u043a\u0443\u0432\u0430\u043d\u0435', 'error'); }
  };
  ov.querySelector('#msgCancel').onclick = function() { ov.remove(); };
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
  ov.querySelector('#msgTitle').onkeydown = function(e) { if (e.key === 'Escape') ov.remove(); };
}
async function generateDailyReport() {
  try { await fetch('/api/messageboard/daily-report',{method:'POST'}); showToast('\u0420\u0430\u043f\u043e\u0440\u0442\u044a\u0442 \u0435 \u0433\u0435\u043d\u0435\u0440\u0438\u0440\u0430\u043d', 'success'); router(); } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0433\u0435\u043d\u0435\u0440\u0438\u0440\u0430\u043d\u0435 \u043d\u0430 \u0440\u0430\u043f\u043e\u0440\u0442', 'error'); }
}

// ==================== VAULT ====================
async function renderBookmarks(el) {
  setBreadcrumb(null); el.className = '';
  try {
    const bookmarks = await (await fetch('/api/bookmarks')).json();
    el.innerHTML = `
      <div style="max-width:700px;margin:0 auto">
        <div class="page-header"><h1>⚑ Отметки</h1></div>
        <div class="task-list">
          ${bookmarks.length === 0 ? '<div style="text-align:center;padding:40px;color:var(--text-dim)"><div style="font-size:48px;opacity:0.3;margin-bottom:8px">⚑</div>Нямаш запазени отметки.<br>Натисни ⚑ на карта за да я добавиш тук.</div>' :
            bookmarks.map(b => {
              const href = b.target_type === 'card' ? '#/card/' + b.target_id : '#';
              const typeLabel = b.target_type === 'card' ? '📋 Карта' : b.target_type === 'message' ? '📢 Съобщение' : esc(b.target_type);
              const board = b.board_title ? esc(b.board_title) : '';
              return '<a class="task-row ' + (b.color_class || '') + '" href="' + href + '" style="text-decoration:none">' +
                '<span class="task-title">' + esc(b.title || 'Без заглавие') + '</span>' +
                '<span class="task-meta">' +
                  '<span class="task-board" style="opacity:.6">' + typeLabel + '</span>' +
                  (board ? '<span class="task-board">' + board + '</span>' : '') +
                  (b.saved_at ? '<span style="font-size:10px;color:var(--text-dim)">' + timeAgo(b.saved_at) + '</span>' : '') +
                  '<button class="btn btn-sm" onclick="event.preventDefault();removeBookmark(' + b.id + ')" style="color:var(--text-dim);margin-left:4px">✕</button>' +
                '</span>' +
              '</a>';
            }).join('')}
        </div>
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
async function toggleBookmark(type, id, title) {
  try {
    const bookmarks = await (await fetch('/api/bookmarks')).json();
    const existing = bookmarks.find(b => b.target_type === type && b.target_id === id);
    if (existing) {
      await fetch(`/api/bookmarks/${existing.id}`, {method:'DELETE'});
    } else {
      await fetch('/api/bookmarks', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target_type:type,target_id:id,title})});
    }
    router();
  } catch {}
}
async function removeBookmark(id) {
  try { await fetch(`/api/bookmarks/${id}`, {method:'DELETE'}); router(); } catch {}
}
async function toggleCardReminder(cardId, title) {
  try {
    var res = await fetch('/api/notifications/reminder', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({card_id:cardId,title:title})});
    var data = await res.json();
    showToast(data.removed ? 'Махнато от Не забравяй' : 'Добавено в Не забравяй', 'success');
    updateHeyBadge();
  } catch {}
}

