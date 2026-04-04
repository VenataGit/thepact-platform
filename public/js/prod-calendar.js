// ==================== PRODUCTION CALENDAR ====================
// Replaces renderCalendar() defined in app.js
// Provides a week-view scheduling board for production cards.

var _prodCal = {
  weekStart: null, // Monday Date object
  entries:   [],   // loaded from API for current week
  cards:     [],   // all active cards
  boards:    [],   // all boards
};

var _pcDrag = {
  type:       null,   // 'sidebar' | 'event'
  cardId:     null,
  entryId:    null,
  offsetMin:  0,      // minutes from block top when event-drag starts
};

var _pcResize = {
  entryId:  null,
  startY:   0,
  startDur: 0,
};

var PC_PX_MIN   = 1;   // 1 pixel = 1 minute → 60px per hour
var PC_H0       = 6;   // visible start: 06:00
var PC_H1       = 22;  // visible end:   22:00
var PC_SNAP     = 15;  // snap to 15-minute grid
var PC_COLORS   = [
  '#2da562', '#3b82f6', '#e8912d', '#a855f7',
  '#ef4444', '#eab308', '#06b6d4', '#ec4899',
];

// ─── helpers ──────────────────────────────────────────────────────────────────

function _pcDate(d) {
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

function _pcMinToTime(min) {
  var h = Math.floor(min / 60);
  var m = min % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

function _pcColor(boardId) {
  return PC_COLORS[(boardId || 0) % PC_COLORS.length];
}

function pcYToMinute(clientY) {
  var body = document.querySelector('.pc-body');
  if (!body) return PC_H0 * 60;
  var rect = body.getBoundingClientRect();
  var absY = clientY - rect.top + body.scrollTop;
  var raw  = PC_H0 * 60 + absY;
  var snapped = Math.round(raw / PC_SNAP) * PC_SNAP;
  return Math.max(PC_H0 * 60, Math.min(PC_H1 * 60 - 15, snapped));
}

// ─── data / API ───────────────────────────────────────────────────────────────

async function _pcLoadEntries() {
  var end = new Date(_prodCal.weekStart);
  end.setDate(end.getDate() + 6);
  try {
    var res  = await fetch('/api/production-calendar?from=' + _pcDate(_prodCal.weekStart) + '&to=' + _pcDate(end));
    var data = await res.json();
    _prodCal.entries = Array.isArray(data) ? data.map(function(e) {
      e.scheduled_date = (e.scheduled_date || '').toString().split('T')[0];
      return e;
    }) : [];
  } catch (e) { _prodCal.entries = []; }
}

async function pcCreateEntry(cardId, date, startMin, durMin) {
  try {
    var res = await fetch('/api/production-calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: cardId, scheduled_date: date, start_minute: startMin, duration_minutes: durMin || 60 }),
    });
    if (!res.ok) return;
    var entry = await res.json();
    entry.scheduled_date = (entry.scheduled_date || '').toString().split('T')[0];
    _prodCal.entries.push(entry);
    _pcRefreshWeekView();
    _pcRefreshSidebarCard(cardId);
  } catch (e) {}
}

async function pcMoveEntry(entryId, newDate, newStart) {
  try {
    var old = _prodCal.entries.find(function(e) { return e.id === entryId; });
    var oldDate = old ? old.scheduled_date : null;
    var res = await fetch('/api/production-calendar/' + entryId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduled_date: newDate, start_minute: newStart }),
    });
    if (!res.ok) return;
    var idx = _prodCal.entries.findIndex(function(e) { return e.id === entryId; });
    if (idx >= 0) {
      _prodCal.entries[idx].scheduled_date = newDate;
      _prodCal.entries[idx].start_minute   = newStart;
    }
    _pcRefreshWeekView();
  } catch (e) {}
}

async function pcUpdateDuration(entryId, durMin) {
  durMin = Math.max(15, Math.round(durMin / PC_SNAP) * PC_SNAP);
  try {
    await fetch('/api/production-calendar/' + entryId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration_minutes: durMin }),
    });
    var idx = _prodCal.entries.findIndex(function(e) { return e.id === entryId; });
    if (idx >= 0) _prodCal.entries[idx].duration_minutes = durMin;
  } catch (e) {}
}

async function pcDeleteEntry(entryId) {
  try {
    var entry = _prodCal.entries.find(function(e) { return e.id === entryId; });
    if (!entry) return;
    var date   = entry.scheduled_date;
    var cardId = entry.card_id;
    var res = await fetch('/api/production-calendar/' + entryId, { method: 'DELETE' });
    if (!res.ok) return;
    _prodCal.entries = _prodCal.entries.filter(function(e) { return e.id !== entryId; });
    _pcRefreshWeekView();
    _pcRefreshSidebarCard(cardId);
  } catch (e) {}
}

// ─── partial DOM updates ───────────────────────────────────────────────────────

function _pcRedrawCol(dateStr) {
  var col = document.querySelector('.pc-day-col[data-date="' + dateStr + '"]');
  if (!col) return;
  col.querySelectorAll('.pc-event').forEach(function(el) { el.remove(); });
  _prodCal.entries
    .filter(function(e) { return e.scheduled_date === dateStr; })
    .sort(function(a, b) { return a.start_minute - b.start_minute; })
    .forEach(function(entry) { col.insertAdjacentHTML('beforeend', _pcEventHtml(entry)); });
}

function _pcRefreshSidebarCard(cardId) {
  var list = document.getElementById('pcSidebarList');
  if (!list) return;
  var q = (document.getElementById('pcSearch') || {}).value || '';
  list.innerHTML = _pcSidebarHtml(q);
}

function _pcRefreshWeekView() {
  var weekView = document.querySelector('.pc-week-view');
  if (!weekView) return;
  var body = weekView.querySelector('.pc-body');
  var scrollTop = body ? body.scrollTop : (8 - PC_H0) * 60;
  weekView.innerHTML = _pcWeekHtml();
  var newBody = weekView.querySelector('.pc-body');
  if (newBody) newBody.scrollTop = scrollTop;
}

// ─── HTML builders ────────────────────────────────────────────────────────────

function _pcEventHtml(entry) {
  var color  = _pcColor(entry.board_id || 0);
  var top    = (entry.start_minute - PC_H0 * 60) * PC_PX_MIN;
  var height = Math.max(20, entry.duration_minutes * PC_PX_MIN);
  var t0     = _pcMinToTime(entry.start_minute);
  var t1     = _pcMinToTime(entry.start_minute + entry.duration_minutes);
  var title  = (entry.card_title || '').replace(/"/g, '&quot;');
  var short  = entry.duration_minutes < 30;
  return '<div class="pc-event" data-entry-id="' + entry.id + '" data-card-id="' + entry.card_id + '"' +
    ' style="top:' + top + 'px;height:' + height + 'px;background:' + color + '"' +
    ' draggable="true"' +
    ' onclick="pcOpenCard(event,' + entry.card_id + ')"' +
    ' ondragstart="pcEventDragStart(event,' + entry.id + ',' + entry.start_minute + ')">' +
    '<button class="pc-event__del" title="Върни в списъка" onclick="event.stopPropagation();pcDeleteEntry(' + entry.id + ')">↩</button>' +
    '<div class="pc-event__title">' + (entry.card_title || '') + '</div>' +
    (short ? '' : '<div class="pc-event__time">' + t0 + ' – ' + t1 + '</div>') +
    '<div class="pc-event__resize" onmousedown="pcResizeStart(event,' + entry.id + ')" onclick="event.stopPropagation()"></div>' +
  '</div>';
}

function _pcSidebarHtml(searchQ) {
  var q = (searchQ || '').toLowerCase();
  var boardMap = {};
  _prodCal.boards.forEach(function(b) { boardMap[b.id] = b; });
  var scheduledIds = new Set(_prodCal.entries.map(function(e) { return e.card_id; }));

  // Group by board — skip already-scheduled cards
  var byBoard = {};
  _prodCal.cards.forEach(function(c) {
    if (scheduledIds.has(c.id)) return;
    if (q && !(c.title || '').toLowerCase().includes(q)) return;
    if (!byBoard[c.board_id]) byBoard[c.board_id] = [];
    byBoard[c.board_id].push(c);
  });

  var html = '';
  Object.keys(byBoard).forEach(function(bid) {
    var board = boardMap[bid];
    var bName = board ? board.title : 'Борд';
    html += '<div class="pc-board-label">' + bName + '</div>';
    byBoard[bid].forEach(function(card) {
      html +=
        '<div class="pc-mini-card"' +
        ' data-card-id="' + card.id + '"' +
        ' draggable="true"' +
        ' ondragstart="pcSidebarDragStart(event,' + card.id + ')">' +
        '<div class="pc-mini-card__title">' + (card.title || '') + '</div>' +
        (card.client_name
          ? '<div class="pc-mini-card__meta">' + card.client_name + '</div>'
          : '') +
        '</div>';
    });
  });
  return html || '<div class="pc-empty-msg">Всички карти са насрочени</div>';
}

function _pcWeekHtml() {
  var days = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(_prodCal.weekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  var todayStr = _pcDate(new Date());
  var DAY_BG   = ['Нд', 'Пон', 'Вт', 'Ср', 'Чет', 'Пет', 'Съб'];

  // ── day headers ──
  var hdr = '<div class="pc-week-hdr"><div class="pc-time-gutter"></div>';
  days.forEach(function(d) {
    var ds      = _pcDate(d);
    var isToday = ds === todayStr;
    hdr +=
      '<div class="pc-day-hdr' + (isToday ? ' today' : '') + '">' +
      '<div class="pc-day-hdr__name">' + DAY_BG[d.getDay()] + '</div>' +
      '<div class="pc-day-hdr__num' + (isToday ? ' today-num' : '') + '">' + d.getDate() + '</div>' +
      '</div>';
  });
  hdr += '</div>';

  // ── time labels ──
  var times = '<div class="pc-times">';
  for (var h = PC_H0; h <= PC_H1; h++) {
    times +=
      '<div class="pc-time-label" style="top:' + (h - PC_H0) * 60 + 'px">' +
      (h < 10 ? '0' : '') + h + ':00' +
      '</div>';
  }
  times += '</div>';

  // ── day columns ──
  var cols = days.map(function(d) {
    var ds         = _pcDate(d);
    var dayEntries = _prodCal.entries
      .filter(function(e) { return e.scheduled_date === ds; })
      .sort(function(a, b) { return a.start_minute - b.start_minute; });

    // grid lines
    var lines = '';
    for (var hr = 0; hr < (PC_H1 - PC_H0); hr++) {
      lines += '<div class="pc-hr-line" style="top:' + (hr * 60) + 'px"></div>';
      lines += '<div class="pc-hf-line" style="top:' + (hr * 60 + 30) + 'px"></div>';
    }

    return (
      '<div class="pc-day-col" data-date="' + ds + '"' +
      ' ondragover="pcDragOver(event)"' +
      ' ondrop="pcDrop(event)"' +
      ' ondragleave="pcDragLeave(event)">' +
      lines +
      dayEntries.map(function(e) { return _pcEventHtml(e); }).join('') +
      '</div>'
    );
  }).join('');

  return (
    hdr +
    '<div class="pc-body">' +
    times +
    '<div class="pc-days">' + cols + '</div>' +
    '</div>'
  );
}

function _pcToolbarHtml() {
  var end    = new Date(_prodCal.weekStart);
  end.setDate(end.getDate() + 6);
  var MONTHS = ['Яну','Фев','Мар','Апр','Май','Юни','Юли','Авг','Сеп','Окт','Ное','Дек'];
  var s      = _prodCal.weekStart;
  var title  = s.getDate() + ' ' + MONTHS[s.getMonth()] + ' – ' +
               end.getDate() + ' ' + MONTHS[end.getMonth()] + ' ' + end.getFullYear();
  return (
    '<div class="pc-toolbar">' +
    '<button class="btn btn-sm btn-ghost" onclick="pcNavWeek(-1)">← Предишна</button>' +
    '<button class="btn btn-sm btn-ghost" onclick="pcNavToday()">Днес</button>' +
    '<button class="btn btn-sm btn-ghost" onclick="pcNavWeek(1)">Следваща →</button>' +
    '<span class="pc-toolbar__title">' + title + '</span>' +
    '<span style="flex:1"></span>' +
    '<span class="pc-toolbar__hint">Влачи карта от панела → пусни в деня · Влачи блок за преместване · Дръж долния ръб за промяна на продължителност</span>' +
    '</div>'
  );
}

function _pcFullRender(el) {
  el.innerHTML =
    '<div class="pc-wrap">' +
      '<div class="pc-sidebar">' +
        '<div class="pc-sidebar__hdr">' +
          '<div class="pc-sidebar__title">Карти</div>' +
          '<input class="pc-sidebar__search" id="pcSearch" placeholder="Търси карта…" oninput="pcFilterCards(this.value)">' +
        '</div>' +
        '<div class="pc-sidebar__list" id="pcSidebarList">' + _pcSidebarHtml() + '</div>' +
      '</div>' +
      '<div class="pc-main">' +
        _pcToolbarHtml() +
        '<div class="pc-week-view">' + _pcWeekHtml() + '</div>' +
      '</div>' +
    '</div>';

  // scroll to 08:00
  var body = el.querySelector('.pc-body');
  if (body) body.scrollTop = (8 - PC_H0) * 60;
}

// ─── main entry point (overrides renderCalendar in app.js) ───────────────────

async function renderCalendar(el) {
  setBreadcrumb([{ label: 'Производствен Календар' }]);
  el.className = 'full-width';

  // init week to current Monday
  if (!_prodCal.weekStart) {
    var now = new Date();
    var dow = now.getDay() || 7; // 1=Mon … 7=Sun
    var mon = new Date(now);
    mon.setDate(now.getDate() - dow + 1);
    mon.setHours(0, 0, 0, 0);
    _prodCal.weekStart = mon;
  }

  el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Зареждане…</div>';

  try {
    var results = await Promise.all([
      fetch('/api/cards').then(function(r) { return r.json(); }),
      fetch('/api/boards').then(function(r) { return r.json(); }),
    ]);
    // Only show cards from boards named "Production" (case-insensitive)
    var allBoards = results[1];
    _prodCal.boards = allBoards.filter(function(b) {
      return (b.title || '').toLowerCase() === 'production';
    });
    var productionBoardIds = new Set(_prodCal.boards.map(function(b) { return b.id; }));
    _prodCal.cards = results[0].filter(function(c) {
      return !c.completed_at && !c.archived_at && productionBoardIds.has(c.board_id);
    });
    await _pcLoadEntries();
    _pcFullRender(el);
  } catch (e) {
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--red)">Грешка при зареждане</div>';
  }
}

// ─── drag & drop — sidebar ────────────────────────────────────────────────────

function pcSidebarDragStart(e, cardId) {
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(cardId));
  _pcDrag.type      = 'sidebar';
  _pcDrag.cardId    = cardId;
  _pcDrag.offsetMin = 0;
  e.currentTarget.style.opacity = '0.4';
}

// ─── drag & drop — event move ─────────────────────────────────────────────────

function pcEventDragStart(e, entryId, startMin) {
  e.stopPropagation();
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(entryId));
  _pcDrag.type      = 'event';
  _pcDrag.entryId   = entryId;
  // how far from the top of the block was the mouse?
  var offset = pcYToMinute(e.clientY) - startMin;
  _pcDrag.offsetMin = Math.max(0, Math.min(45, offset));
}

// ─── drag & drop — column handlers ───────────────────────────────────────────

function pcDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  var col = e.currentTarget;
  col.classList.add('drag-over');

  var dropMin = pcYToMinute(e.clientY) - _pcDrag.offsetMin;
  dropMin = Math.round(dropMin / PC_SNAP) * PC_SNAP;
  var top = (dropMin - PC_H0 * 60) * PC_PX_MIN;

  var dur = 60;
  if (_pcDrag.type === 'event') {
    var entry = _prodCal.entries.find(function(en) { return en.id === _pcDrag.entryId; });
    if (entry) dur = entry.duration_minutes;
  }

  var prev = col.querySelector('.pc-drag-preview');
  if (!prev) {
    prev = document.createElement('div');
    prev.className = 'pc-drag-preview';
    col.appendChild(prev);
  }
  prev.style.top    = Math.max(0, top) + 'px';
  prev.style.height = (dur * PC_PX_MIN) + 'px';
}

function pcDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drag-over');
    var prev = e.currentTarget.querySelector('.pc-drag-preview');
    if (prev) prev.remove();
  }
}

function pcDrop(e) {
  e.preventDefault();
  var col  = e.currentTarget;
  col.classList.remove('drag-over');
  var prev = col.querySelector('.pc-drag-preview');
  if (prev) prev.remove();

  var date    = col.dataset.date;
  var dropMin = pcYToMinute(e.clientY) - _pcDrag.offsetMin;
  dropMin = Math.max(PC_H0 * 60, Math.min(PC_H1 * 60 - 15, Math.round(dropMin / PC_SNAP) * PC_SNAP));

  if (_pcDrag.type === 'sidebar' && _pcDrag.cardId) {
    // restore opacity
    var miniCard = document.querySelector('.pc-mini-card[data-card-id="' + _pcDrag.cardId + '"]');
    if (miniCard) miniCard.style.opacity = '';
    pcCreateEntry(_pcDrag.cardId, date, dropMin, 60);

  } else if (_pcDrag.type === 'event' && _pcDrag.entryId) {
    var existing = _prodCal.entries.find(function(en) { return en.id === _pcDrag.entryId; });
    if (!existing) return;
    if (existing.scheduled_date === date && existing.start_minute === dropMin) return;
    pcMoveEntry(_pcDrag.entryId, date, dropMin);
  }

  _pcDrag.type = null; _pcDrag.cardId = null; _pcDrag.entryId = null;
}

// ─── resize ───────────────────────────────────────────────────────────────────

function pcResizeStart(e, entryId) {
  e.stopPropagation();
  e.preventDefault();
  var entry = _prodCal.entries.find(function(en) { return en.id === entryId; });
  _pcResize.entryId  = entryId;
  _pcResize.startY   = e.clientY;
  _pcResize.startDur = entry ? entry.duration_minutes : 60;
  document.addEventListener('mousemove', pcResizeMove);
  document.addEventListener('mouseup',   pcResizeEnd);
}

function pcResizeMove(e) {
  if (!_pcResize.entryId) return;
  var dy     = e.clientY - _pcResize.startY;
  var newDur = Math.max(15, Math.round((_pcResize.startDur + dy) / PC_SNAP) * PC_SNAP);
  var el     = document.querySelector('.pc-event[data-entry-id="' + _pcResize.entryId + '"]');
  if (!el) return;
  el.style.height = newDur + 'px';
  var timeEl = el.querySelector('.pc-event__time');
  if (timeEl) {
    var entry = _prodCal.entries.find(function(en) { return en.id === _pcResize.entryId; });
    if (entry) timeEl.textContent = _pcMinToTime(entry.start_minute) + ' – ' + _pcMinToTime(entry.start_minute + newDur);
  }
}

async function pcResizeEnd(e) {
  document.removeEventListener('mousemove', pcResizeMove);
  document.removeEventListener('mouseup',   pcResizeEnd);
  if (!_pcResize.entryId) return;
  var dy     = e.clientY - _pcResize.startY;
  var newDur = Math.max(15, Math.round((_pcResize.startDur + dy) / PC_SNAP) * PC_SNAP);
  var id     = _pcResize.entryId;
  _pcResize.entryId = null;
  await pcUpdateDuration(id, newDur);
}

// ─── navigation ───────────────────────────────────────────────────────────────

function pcNavWeek(dir) {
  _prodCal.weekStart.setDate(_prodCal.weekStart.getDate() + dir * 7);
  var el = document.getElementById('pageContent');
  if (!el) return;
  el.querySelector('.pc-toolbar__title') && (el.querySelector('.pc-toolbar__title').textContent = '…');
  _pcLoadEntries().then(function() {
    // just rebuild week + toolbar, keep sidebar
    var weekView = el.querySelector('.pc-week-view');
    var toolbar  = el.querySelector('.pc-toolbar');
    var end = new Date(_prodCal.weekStart); end.setDate(end.getDate() + 6);
    var MONTHS = ['Яну','Фев','Мар','Апр','Май','Юни','Юли','Авг','Сеп','Окт','Ное','Дек'];
    var s = _prodCal.weekStart;
    var title = s.getDate()+' '+MONTHS[s.getMonth()]+' – '+end.getDate()+' '+MONTHS[end.getMonth()]+' '+end.getFullYear();
    if (toolbar) toolbar.outerHTML = _pcToolbarHtml();
    if (weekView) weekView.innerHTML = _pcWeekHtml();
    // re-scroll
    var body = el.querySelector('.pc-body');
    if (body) body.scrollTop = (8 - PC_H0) * 60;
  });
}

function pcNavToday() {
  var now = new Date(), dow = now.getDay() || 7;
  var mon = new Date(now);
  mon.setDate(now.getDate() - dow + 1);
  mon.setHours(0, 0, 0, 0);
  _prodCal.weekStart = mon;
  pcNavWeek(0);
}

// ─── sidebar filter ───────────────────────────────────────────────────────────

function pcFilterCards(q) {
  var list = document.getElementById('pcSidebarList');
  if (!list) return;
  list.innerHTML = _pcSidebarHtml(q);
}

// ─── open card ────────────────────────────────────────────────────────────────

function pcOpenCard(e, cardId) {
  // drag events cancel click automatically — this only fires on a plain click
  location.hash = '#/card/' + cardId;
}
