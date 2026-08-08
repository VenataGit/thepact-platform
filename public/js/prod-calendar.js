// ==================== PRODUCTION CALENDAR (Basecamp-backed) ====================
// Replaces renderCalendar() defined in app.js.
// Data source: GET /api/bc-calendar (Production card-table cards from Basecamp).
//   { cards: [unscheduled, sorted by filming deadline], entries: [scheduled] }
// Sidebar = unscheduled Production cards (color by dl_class, click → open in Basecamp).
// Week view = scheduled entries; drag/drop/resize → POST/PUT/DELETE /api/bc-calendar
// (camelCase fields), which also syncs to Google Calendar with a link to the card.
// Обратната посока: GET /api/bc-calendar/external връща събитията, добавени
// директно в Google Calendar — рисуват се само за четене („зает час"), по седмици.

var _prodCal = {
  weekStart: null, // Monday Date object
  entries:   [],   // scheduled entries (all weeks)
  cards:     [],   // master Production card list (sidebar = these minus scheduled)
  external:  {},   // '<понеделник YYYY-MM-DD>' → Google събития за тази седмица (кеш)
  calendars: [],   // [{ id, name, is_default, can_write }] — от /api/bc-calendar
};

// ─── избор на календари ───────────────────────────────────────────────────────
// Кои календари гледам и в кой пиша е личен избор — стои в localStorage, не в
// базата. Гледането и писането са различни списъци: service account-ът чете
// всичко споделено с него, но пише само там, където има права.

var PC_LS_VISIBLE = 'thepact-pc-cals';
var PC_LS_TARGET  = 'thepact-pc-target-cal';
var _PC_CAL_COLORS = ['#8899a6', '#7e6bbf', '#3f8f8a', '#a9683f', '#8a6d9e', '#4f7ba8'];

function _pcDefaultCalId() {
  var d = _prodCal.calendars.find(function(c) { return c.is_default; });
  return d ? d.id : (_prodCal.calendars[0] ? _prodCal.calendars[0].id : null);
}

// Видимите календари; непознат/изтрит id се отсява, празен избор → всички.
function _pcVisibleCals() {
  var known = _prodCal.calendars.map(function(c) { return c.id; });
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(PC_LS_VISIBLE) || 'null'); } catch (e) {}
  if (!Array.isArray(saved)) return known;
  var kept = saved.filter(function(id) { return known.indexOf(id) >= 0; });
  return kept.length ? kept : known;
}

function _pcTargetCal() {
  var id = null;
  try { id = localStorage.getItem(PC_LS_TARGET); } catch (e) {}
  var hit = _prodCal.calendars.find(function(c) { return c.id === id && c.can_write; });
  return hit ? hit.id : _pcDefaultCalId();
}

function _pcCalColor(calId) {
  var i = _prodCal.calendars.findIndex(function(c) { return c.id === calId; });
  return _PC_CAL_COLORS[(i < 0 ? 0 : i) % _PC_CAL_COLORS.length];
}

function _pcCalName(calId) {
  var c = _prodCal.calendars.find(function(x) { return x.id === calId; });
  return c ? c.name : '';
}

// Смяна на видимите календари → кешът вече не е валиден (той е за друг набор).
// Менюто нарочно НЕ се пререндва, за да не се затваря след всяко чекче.
function pcToggleCalendar(calId, on, el) {
  var vis = _pcVisibleCals().slice();
  var i = vis.indexOf(calId);
  if (on && i < 0) vis.push(calId);
  if (!on && i >= 0) {
    if (vis.length === 1) { if (el) el.checked = true; return; } // последният остава
    vis.splice(i, 1);
  }
  try { localStorage.setItem(PC_LS_VISIBLE, JSON.stringify(vis)); } catch (e) {}
  _prodCal.external = {};
  _pcRefreshWeekView();
  var sum = document.querySelector('.pc-cal-picker > summary');
  if (sum) sum.textContent = '📆 Календари (' + vis.length + '/' + _prodCal.calendars.length + ')';
  pcLoadExternal();
}

function pcSetTargetCalendar(calId) {
  try { localStorage.setItem(PC_LS_TARGET, calId); } catch (e) {}
}

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
  didResize: false,  // suppresses card click after a resize drag
};

var PC_PX_MIN   = 1;   // 1 pixel = 1 minute → 60px per hour
var PC_H0       = 6;   // visible start: 06:00
var PC_H1       = 22;  // visible end:   22:00
var PC_SNAP     = 15;  // snap to 15-minute grid

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

async function pcCreateEntry(cardId, date, startMin, durMin) {
  var card = _prodCal.cards.find(function(c) { return String(c.id) === String(cardId); });
  try {
    var res = await fetch('/api/bc-calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: cardId,
        title: card ? card.title : null,
        url:   card ? card.url   : null,
        scheduledDate: date,
        startMinute: startMin,
        durationMinutes: durMin || 60,
        calendarId: _pcTargetCal(),
      }),
    });
    if (!res.ok) return;
    var entry = await res.json();
    entry.scheduled_date = (entry.scheduled_date || '').toString().split('T')[0];
    // POST does not echo dl_class — carry it from the card so the block colors correctly.
    if (entry.dl_class == null) entry.dl_class = card ? card.dl_class : 'dl-none';
    // POST upserts (ON CONFLICT card id) — replace in place rather than duplicate
    // if this card already has an entry (e.g. a fast double-drop before refresh).
    var ei = _prodCal.entries.findIndex(function(e) { return e.id === entry.id || String(e.card_id) === String(entry.card_id); });
    if (ei >= 0) _prodCal.entries[ei] = entry; else _prodCal.entries.push(entry);
    _pcRefreshWeekView();
    _pcRefreshSidebarCard(cardId);
  } catch (e) {}
}

async function pcMoveEntry(entryId, newDate, newStart) {
  try {
    var res = await fetch('/api/bc-calendar/' + entryId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledDate: newDate, startMinute: newStart }),
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
    var res = await fetch('/api/bc-calendar/' + entryId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationMinutes: durMin }),
    });
    // Revert the optimistic resize if the server rejected it (entries still hold
    // the old duration, so a redraw snaps the block back to its real height).
    if (!res.ok) { _pcRefreshWeekView(); return; }
    var idx = _prodCal.entries.findIndex(function(e) { return e.id === entryId; });
    if (idx >= 0) _prodCal.entries[idx].duration_minutes = durMin;
  } catch (e) { _pcRefreshWeekView(); }
}

// ─── Google събития за видимата седмица ───────────────────────────────────────

function _pcWeekKey() {
  return _pcDate(_prodCal.weekStart);
}

function _pcExternal() {
  return _prodCal.external[_pcWeekKey()] || [];
}

// Зарежда Google събитията за видимата седмица. Без force — само ако още ги няма
// в кеша. С force (периодичната проверка) дърпа наново и прерисува само при
// разлика, за да не мига екранът на всеки цикъл.
async function pcLoadExternal(force) {
  var key = _pcWeekKey();
  if (!force && _prodCal.external[key]) return;
  var end = new Date(_prodCal.weekStart);
  end.setDate(end.getDate() + 6);
  try {
    var res = await fetch('/api/bc-calendar/external?from=' + key + '&to=' + _pcDate(end) +
      '&calendars=' + encodeURIComponent(_pcVisibleCals().join(',')));
    if (!res.ok) return;
    var data = await res.json();
    var events = data.events || [];
    var changed = JSON.stringify(_prodCal.external[key] || null) !== JSON.stringify(events);
    _prodCal.external[key] = events;
    // Ако потребителят вече е сменил седмицата, само кешираме — без пререндване.
    if (changed && _pcWeekKey() === key) _pcRefreshWeekView();
  } catch (e) {}
}

// ─── лайв обновяване ──────────────────────────────────────────────────────────
// Календарът се обновява сам, без ръчно презареждане: проверка на всеки 30 сек,
// плюс веднага щом табът се върне на фокус (най-честият случай — човек добавя
// събитието в Google и се връща в платформата).

var PC_POLL_MS = 30000;
var _pcPollTimer = null;

function pcStartPolling() {
  pcStopPolling();
  _pcPollTimer = setInterval(pcPollExternal, PC_POLL_MS);
  document.addEventListener('visibilitychange', pcOnVisible);
  window.addEventListener('focus', pcOnVisible);
}

function pcStopPolling() {
  if (_pcPollTimer) { clearInterval(_pcPollTimer); _pcPollTimer = null; }
  document.removeEventListener('visibilitychange', pcOnVisible);
  window.removeEventListener('focus', pcOnVisible);
}

function pcOnVisible() {
  if (!document.hidden) pcPollExternal();
}

function pcPollExternal() {
  // Излязъл от календара → таймерът се самоспира (няма кой друг да го спре).
  if (!document.querySelector('.pc-week-view')) { pcStopPolling(); return; }
  if (document.hidden) return;
  // По време на влачене/преоразмеряване не пипаме DOM-а под ръцете на човека.
  if (_pcDrag.type || _pcResize.entryId) return;
  pcLoadExternal(true);
}

async function pcDeleteEntry(entryId) {
  try {
    var entry = _prodCal.entries.find(function(e) { return e.id === entryId; });
    if (!entry) return;
    var cardId = entry.card_id;
    var res = await fetch('/api/bc-calendar/' + entryId, { method: 'DELETE' });
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

var _PC_DL_COLORS = { 'dl-green': '#2a9d5c', 'dl-yellow': '#c4930a', 'dl-red': '#c0392b', 'dl-black': '#555', 'dl-none': '#8899a6' };

// ─── подредба при застъпване ──────────────────────────────────────────────────
// Блоковете, които се застъпват по час в един ден, се разделят на равни писти,
// за да се вижда, че са няколко. Сам блок си остава на цялата ширина.
// Очаква обекти с _s / _e (минути от полунощ); записва _lane и _lanes.

function _pcAssignLanes(items) {
  var sorted = items.slice().sort(function(a, b) { return (a._s - b._s) || (b._e - a._e); });
  var cluster = [], laneEnds = [], clusterEnd = -1;

  function flush() {
    var lanes = laneEnds.length || 1;
    cluster.forEach(function(it) { it._lanes = lanes; });
    cluster = []; laneEnds = []; clusterEnd = -1;
  }

  sorted.forEach(function(it) {
    // Нов блок, който не застъпва нищо от текущата група → групата приключва.
    if (cluster.length && it._s >= clusterEnd) flush();
    var lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] > it._s) lane++;
    it._lane = lane;
    laneEnds[lane] = it._e;
    cluster.push(it);
    if (it._e > clusterEnd) clusterEnd = it._e;
  });
  flush();
  return items;
}

// Празен стринг при една писта → блокът пада на стиловете по подразбиране (цяла ширина).
function _pcLaneStyle(it) {
  var lanes = it._lanes || 1;
  if (lanes < 2) return '';
  var w = 100 / lanes;
  return 'left:calc(' + (it._lane * w) + '% + 2px);width:calc(' + w + '% - 4px);right:auto;';
}

function _pcEventHtml(entry) {
  var dlClass = entry.dl_class || 'dl-none';
  var color   = _PC_DL_COLORS[dlClass] || _PC_DL_COLORS['dl-none'];
  var top    = (entry.start_minute - PC_H0 * 60) * PC_PX_MIN;
  var height = Math.max(20, entry.duration_minutes * PC_PX_MIN);
  var t0     = _pcMinToTime(entry.start_minute);
  var t1     = _pcMinToTime(entry.start_minute + entry.duration_minutes);
  var short  = entry.duration_minutes < 30;
  return '<div class="pc-event" data-entry-id="' + entry.id + '" data-card-id="' + entry.card_id + '"' +
    ' data-url="' + esc(entry.card_url || '') + '"' +
    ' style="' + _pcLaneStyle(entry) + 'top:' + top + 'px;height:' + height + 'px;background:' + color + '"' +
    ' draggable="true"' +
    ' ondblclick="pcOpenCard(event)"' +
    ' ondragstart="pcEventDragStart(event,' + entry.id + ',' + entry.start_minute + ')">' +
    '<button class="pc-event__del" title="Върни в списъка" onclick="event.stopPropagation();pcDeleteEntry(' + entry.id + ')">↩</button>' +
    '<div class="pc-event__title">' + esc(entry.card_title || '') + '</div>' +
    (short ? '' : '<div class="pc-event__time">' + t0 + ' – ' + t1 + '</div>') +
    '<div class="pc-event__resize" onmousedown="pcResizeStart(event,' + entry.id + ')" onclick="event.stopPropagation()"></div>' +
  '</div>';
}

// Събитие от Google Calendar — изглежда като останалите блокове (Венци: „същият
// като тези досега като визия"); отличава се само по 📅 пред заглавието. Само за
// четене: не се влачи и не се преоразмерява, клик отваря събитието в Google.
function _pcExtEventHtml(ev) {
  var start  = ev.start_minute;
  var end    = ev.start_minute + ev.duration_minutes;
  var colH   = (PC_H1 - PC_H0) * 60 * PC_PX_MIN;
  var top    = (start - PC_H0 * 60) * PC_PX_MIN;
  var height = ev.duration_minutes * PC_PX_MIN;
  // Отрязване до видимия прозорец 06:00–22:00. Събитие изцяло извън него остава
  // като лентичка на съответния ръб — часовете му се четат от етикета/tooltip-а.
  if (top < 0) { height += top; top = 0; }
  top    = Math.max(0, Math.min(top, colH - 20));
  height = Math.max(20, Math.min(height, colH - top));

  var label = _pcMinToTime(start) + ' – ' + _pcMinToTime(end);
  var calName = ev.calendar_name || _pcCalName(ev.calendar_id);
  var tip = ev.title + ' · ' + label +
    (calName ? '\n📆 ' + calName : '') +
    (ev.creator  ? '\nЗапазено от: ' + ev.creator : '') +
    (ev.location ? '\n📍 ' + ev.location : '') +
    '\n(добавено директно в Google Calendar)';

  return '<div class="pc-event pc-event--ext"' +
    ' style="' + _pcLaneStyle(ev) + 'top:' + top + 'px;height:' + height + 'px;background:' + _pcCalColor(ev.calendar_id) + '"' +
    ' title="' + esc(tip) + '"' +
    ' data-url="' + esc(ev.url || '') + '"' +
    ' onclick="pcOpenExternal(event)">' +
    '<div class="pc-event__title">📅 ' + esc(ev.title) + '</div>' +
    (height >= 30 ? '<div class="pc-event__time">' + label + '</div>' : '') +
  '</div>';
}

// Целодневно Google събитие — чипче под номера на деня (в грида няма къде да стои).
function _pcExtAllDayHtml(ev) {
  var calName = ev.calendar_name || _pcCalName(ev.calendar_id);
  var tip = ev.title + ' · цял ден' +
    (calName ? '\n📆 ' + calName : '') +
    (ev.creator ? '\nЗапазено от: ' + ev.creator : '') +
    '\n(добавено директно в Google Calendar)';
  return '<div class="pc-allday-chip" style="background:' + _pcCalColor(ev.calendar_id) + '" title="' + esc(tip) + '"' +
    ' data-url="' + esc(ev.url || '') + '"' +
    ' onclick="pcOpenExternal(event)">📅 ' + esc(ev.title) + '</div>';
}

function _pcSidebarHtml(searchQ) {
  var q = (searchQ || '').toLowerCase();
  var scheduledIds = new Set(_prodCal.entries.map(function(e) { return String(e.card_id); }));

  // Unscheduled Production cards that match the search.
  var visible = [];
  _prodCal.cards.forEach(function(c) {
    if (scheduledIds.has(String(c.id))) return;
    if (q && !(c.title || '').toLowerCase().includes(q)) return;
    visible.push(c);
  });

  // Sort by filming deadline ascending, nulls last (keeps order stable after a
  // local schedule/unschedule; the server already returns this order on load).
  visible.sort(function(a, b) {
    var da = a.deadline || null, db = b.deadline || null;
    if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
    return da < db ? -1 : da > db ? 1 : 0;
  });

  var html = '';
  visible.forEach(function(card) {
    var dlClass   = card.dl_class || 'dl-none';
    var dlDateStr = card.deadline ? formatDate(card.deadline) : '';
    html +=
      '<div class="pc-mini-card ' + dlClass + '"' +
      ' data-card-id="' + card.id + '"' +
      ' data-url="' + esc(card.url || '') + '"' +
      ' draggable="true"' +
      ' onclick="pcOpenCard(event)"' +
      ' ondragstart="pcSidebarDragStart(event,' + card.id + ')"' +
      ' ondragend="this.style.opacity=\'\'">' +
      '<div class="pc-mini-card__title">' + esc(card.title || '') + '</div>' +
      (card.column
        ? '<div class="pc-mini-card__meta">' + esc(card.column) + '</div>'
        : '') +
      (dlDateStr
        ? '<div class="pc-mini-card__dl ' + dlClass + '">📷 ' + dlDateStr + '</div>'
        : '') +
      '</div>';
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
  var external = _pcExternal();

  // ── day headers (+ целодневните Google събития) ──
  var hdr = '<div class="pc-week-hdr"><div class="pc-time-gutter"></div>';
  days.forEach(function(d) {
    var ds      = _pcDate(d);
    var isToday = ds === todayStr;
    var allDay  = external.filter(function(e) { return e.all_day && e.date === ds; });
    hdr +=
      '<div class="pc-day-hdr' + (isToday ? ' today' : '') + '">' +
      '<div class="pc-day-hdr__name">' + DAY_BG[d.getDay()] + '</div>' +
      '<div class="pc-day-hdr__num' + (isToday ? ' today-num' : '') + '">' + d.getDate() + '</div>' +
      allDay.map(_pcExtAllDayHtml).join('') +
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
    // Насрочените карти и Google събитията се подреждат заедно — застъпят ли се
    // по час, всички участници в застъпването се свиват на равни писти.
    var dayItems = [];
    _prodCal.entries.forEach(function(e) {
      if (e.scheduled_date !== ds) return;
      e._ext = false; e._s = e.start_minute; e._e = e.start_minute + e.duration_minutes;
      dayItems.push(e);
    });
    external.forEach(function(e) {
      if (e.all_day || e.date !== ds) return;
      e._ext = true; e._s = e.start_minute; e._e = e.start_minute + e.duration_minutes;
      dayItems.push(e);
    });
    _pcAssignLanes(dayItems);
    dayItems.sort(function(a, b) { return a._s - b._s; });

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
      dayItems.map(function(e) { return e._ext ? _pcExtEventHtml(e) : _pcEventHtml(e); }).join('') +
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
    _pcCalendarPickerHtml() +
    _pcHistoryHtml() +
    '<span style="flex:1"></span>' +
    '<span class="pc-toolbar__hint">Влачи карта от панела → пусни в деня · Дръж долния ръб за продължителност · 📅 = от Google Calendar</span>' +
    '</div>'
  );
}

// „Календари" (кои виждам) + „Добавяй в" (къде отива новата карта).
// При един-единствен календар няма какво да се избира — контролите се крият.
function _pcCalendarPickerHtml() {
  var cals = _prodCal.calendars;
  if (cals.length < 2) return '';
  var vis = _pcVisibleCals();
  var target = _pcTargetCal();

  var boxes = cals.map(function(c) {
    var on = vis.indexOf(c.id) >= 0;
    return '<label class="pc-cal-opt">' +
      '<input type="checkbox"' + (on ? ' checked' : '') +
      ' onchange="pcToggleCalendar(' + JSON.stringify(c.id).replace(/"/g, '&quot;') + ', this.checked, this)">' +
      '<span class="pc-cal-dot" style="background:' + _pcCalColor(c.id) + '"></span>' +
      '<span class="pc-cal-name">' + esc(c.name) + '</span>' +
      (c.can_write ? '' : '<span class="pc-cal-ro" title="Service account-ът няма права за писане в този календар">само четене</span>') +
      '</label>';
  }).join('');

  // „Добавяй в" се показва винаги при повече от един календар — иначе не се вижда
  // изобщо къде отива картата. Календарите без права за писане стоят в списъка,
  // но заключени, за да е ясно защо не стават за цел.
  var targetSel =
    '<label class="pc-cal-target" title="Тук отива картата, която пуснеш в календара">Добавяй в:' +
    '<select onchange="pcSetTargetCalendar(this.value)">' +
    cals.map(function(c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === target ? ' selected' : '') +
        (c.can_write ? '' : ' disabled') + '>' +
        esc(c.name) + (c.can_write ? '' : ' — няма права за писане') + '</option>';
    }).join('') +
    '</select></label>';

  return '<details class="pc-cal-picker">' +
    '<summary>📆 Календари (' + vis.length + '/' + cals.length + ')</summary>' +
    '<div class="pc-cal-menu">' + boxes + '</div>' +
    '</details>' + targetSel;
}

// ─── история ──────────────────────────────────────────────────────────────────
// Кой какво е пипал в календара. Зарежда се чак при отваряне на панела, за да
// не тежи на самия изглед.

var _PC_ACTION_ICONS = { add: '➕', reschedule: '🔀', move: '↔️', resize: '↕️', remove: '↩️' };

function _pcHistoryHtml() {
  return '<details class="pc-cal-picker pc-history" ontoggle="if(this.open)pcLoadHistory()">' +
    '<summary>🕘 История</summary>' +
    '<div class="pc-cal-menu pc-history__menu" id="pcHistoryList">' +
      '<div class="pc-history__empty">Зареждане…</div>' +
    '</div></details>';
}

function _pcAgo(iso) {
  var diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'сега';
  if (diff < 3600) return 'преди ' + Math.floor(diff / 60) + ' мин';
  if (diff < 86400) return 'преди ' + Math.floor(diff / 3600) + ' ч';
  var d = new Date(iso);
  return d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0') + ', ' +
         String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

async function pcLoadHistory() {
  var host = document.getElementById('pcHistoryList');
  if (!host) return;
  try {
    var res = await fetch('/api/bc-calendar/log?limit=60');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    var rows = data.entries || [];
    if (!rows.length) { host.innerHTML = '<div class="pc-history__empty">Още няма записани промени.</div>'; return; }
    host.innerHTML = rows.map(function(r) {
      return '<div class="pc-history__row">' +
        '<span class="pc-history__icon">' + (_PC_ACTION_ICONS[r.action] || '•') + '</span>' +
        '<span class="pc-history__text">' +
          '<strong>' + esc(r.user_name || 'някой') + '</strong> ' + esc(r.details || r.action) +
          '<span class="pc-history__card"> · ' + esc(r.card_title || ('Карта ' + r.basecamp_card_id)) + '</span>' +
        '</span>' +
        '<span class="pc-history__ago">' + esc(_pcAgo(r.created_at)) + '</span>' +
      '</div>';
    }).join('');
  } catch (e) {
    host.innerHTML = '<div class="pc-history__empty">Грешка при зареждане.</div>';
  }
}

function _pcFullRender(el) {
  el.innerHTML =
    '<div class="pc-wrap">' +
      '<div class="pc-sidebar">' +
        '<div class="pc-sidebar__hdr">' +
          '<div class="pc-sidebar__title">Карти за снимки</div>' +
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
  setBreadcrumb(null);
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
    var res = await fetch('/api/bc-calendar');
    if (!res.ok) {
      var msg = res.status === 401
        ? 'Връзката с Basecamp е изтекла. Излез и влез отново през Basecamp.'
        : 'Грешка при зареждане от Basecamp';
      el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--red)">' + msg + '</div>';
      return;
    }
    var data = await res.json();
    _prodCal.calendars = data.calendars || [];

    var entries = (data.entries || []).map(function(e) {
      e.scheduled_date = (e.scheduled_date || '').toString().split('T')[0];
      return e;
    });
    _prodCal.entries = entries;

    // Master card list = unscheduled (full fidelity) + already-scheduled cards
    // reconstructed from their entries, so unscheduling restores them to the sidebar.
    var cards = (data.cards || []).slice();
    var known = {};
    cards.forEach(function(c) { known[String(c.id)] = true; });
    entries.forEach(function(e) {
      if (!known[String(e.card_id)]) {
        cards.push({ id: e.card_id, title: e.card_title, url: e.card_url, due_on: null, column: '', deadline: null, dl_class: e.dl_class || 'dl-none' });
        known[String(e.card_id)] = true;
      }
    });
    _prodCal.cards = cards;

    _pcFullRender(el);
    pcLoadExternal();  // Google събитията идват отделно — не бавят календара
    pcStartPolling();  // и оттам нататък се обновяват сами
  } catch (e) {
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--red)">Грешка при зареждане</div>';
  }
}

// ─── drag ghost helper ────────────────────────────────────────────────────────

function _pcMakeInvisibleGhost() {
  var ghost = document.createElement('div');
  ghost.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;';
  document.body.appendChild(ghost);
  return ghost;
}

// ─── drag & drop — sidebar ────────────────────────────────────────────────────

function pcSidebarDragStart(e, cardId) {
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(cardId));
  _pcDrag.type      = 'sidebar';
  _pcDrag.cardId    = cardId;
  _pcDrag.offsetMin = 0;
  e.currentTarget.style.opacity = '0.4';
  var ghost = _pcMakeInvisibleGhost();
  e.dataTransfer.setDragImage(ghost, 0, 0);
  setTimeout(function() { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 0);
}

// ─── drag & drop — event move ─────────────────────────────────────────────────

function pcEventDragStart(e, entryId, startMin) {
  e.stopPropagation();
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(entryId));
  _pcDrag.type      = 'event';
  _pcDrag.entryId   = entryId;
  // Preserve grab point within the block (cursor stays at same relative position)
  var offset = pcYToMinute(e.clientY) - startMin;
  _pcDrag.offsetMin = Math.max(0, Math.min(45, offset));
  // Invisible ghost — blue preview is the only visual indicator
  var ghost = _pcMakeInvisibleGhost();
  e.dataTransfer.setDragImage(ghost, 0, 0);
  setTimeout(function() { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 0);
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
  _pcResize.didResize = false;
  document.addEventListener('mousemove', pcResizeMove);
  document.addEventListener('mouseup',   pcResizeEnd);
}

function pcResizeMove(e) {
  if (!_pcResize.entryId) return;
  _pcResize.didResize = true;
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
  // All entries already in memory — just re-render toolbar + week view instantly
  var toolbar = el.querySelector('.pc-toolbar');
  if (toolbar) toolbar.outerHTML = _pcToolbarHtml();
  _pcRefreshWeekView();
  pcLoadExternal(); // Google събитията за новата седмица (от кеша или наново)
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

// ─── open card (in Basecamp) ──────────────────────────────────────────────────

function pcOpenCard(e) {
  // Suppress open if the user just finished a resize drag
  if (_pcResize.didResize) { _pcResize.didResize = false; return; }
  var url = (e.currentTarget && e.currentTarget.dataset.url) || '';
  if (url) window.open(url, '_blank', 'noopener');
}

// ─── open external event (in Google Calendar) ─────────────────────────────────

function pcOpenExternal(e) {
  e.stopPropagation();
  var url = (e.currentTarget && e.currentTarget.dataset.url) || '';
  if (url) window.open(url, '_blank', 'noopener');
}
