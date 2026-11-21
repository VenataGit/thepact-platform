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
  team:      [],   // хората от Basecamp [{ person_id, name, title, avatar_url }]
  extPeople: [],   // запомнените външни хора [{ id, name }]
  selectedId: null, // видеото, на което се разпределят хора (панелът вляво)
  draft:     null, // { entryId, picks: { ключ: { personId } | { name } } } — отметнатите, още незаписани
  focus:     null, // '<bc:id>' | '<ext:име>' — показва само снимките на този човек
  canManage: false, // мини админ на календара (⚙️ Настройки)
  column:    localStorage.getItem('thepact-pc-column') || '', // колоната от Production, чиито карти са вляво ('' = всички)
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
  // Избран човек със собствен календар → новите карти отиват там.
  var own = _pcFocusCals().filter(function(id) {
    return _prodCal.calendars.some(function(c) { return c.id === id && c.can_write; });
  });
  if (own.length) return own[0];
  var id = null;
  try { id = localStorage.getItem(PC_LS_TARGET); } catch (e) {}
  var hit = _prodCal.calendars.find(function(c) { return c.id === id && c.can_write; });
  return hit ? hit.id : _pcDefaultCalId();
}

// Календарите на избрания човек (свързани с него от ⚙️ Настройки).
function _pcFocusCals() {
  var f = _prodCal.focus;
  if (!f || f.indexOf('bc:') !== 0) return [];
  var pid = f.slice(3);
  return _prodCal.calendars.filter(function(c) { return c.person_id && String(c.person_id) === pid; })
    .map(function(c) { return c.id; });
}

// Избран човек → виждат се САМО неговите неща: видеата, на които е назначен, и
// всичко в неговия календар. Общите календари не се показват.
function _pcEntryVisible(e) {
  if (!_prodCal.focus) return true;
  return _pcHasPerson(e, _prodCal.focus) || _pcFocusCals().indexOf(e.calendar_id) >= 0;
}

// Кои календари да се четат от Google: при избран човек — само неговите.
function _pcActiveCals() {
  return _prodCal.focus ? _pcFocusCals() : _pcVisibleCals();
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
var PC_H0       = 0;   // visible start: 00:00 (цялото денонощие — и за много ранни/късни снимки)
var PC_H1       = 24;  // visible end:   24:00
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
    if (entry.warnings && entry.warnings.length) alert('Насрочено, но:\n' + entry.warnings.join('\n'));
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
  var cals = _pcActiveCals();
  if (!cals.length) { // избран човек без собствен календар → няма какво да се чете
    var had = (_prodCal.external[key] || []).length;
    _prodCal.external[key] = [];
    if (had) _pcRefreshWeekView();
    return;
  }
  try {
    var res = await fetch('/api/bc-calendar/external?from=' + key + '&to=' + _pcDate(end) +
      '&calendars=' + encodeURIComponent(cals.join(',')));
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
    if (_prodCal.selectedId === entryId) _prodCal.selectedId = null;
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
    .filter(function(e) { return e.scheduled_date === dateStr && _pcEntryVisible(e); })
    .sort(function(a, b) { return a.start_minute - b.start_minute; })
    .forEach(function(entry) { col.insertAdjacentHTML('beforeend', _pcEventHtml(entry)); });
}

function _pcRefreshSidebarCard(cardId) {
  if (_prodCal.selectedId) { _pcRenderSidebar(); return; }
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
  var people = entry.people || [];
  var cls = 'pc-event' +
    (_prodCal.selectedId === entry.id ? ' pc-event--selected' : '');
  return '<div class="' + cls + '" data-entry-id="' + entry.id + '" data-card-id="' + entry.card_id + '"' +
    ' data-url="' + esc(entry.card_url || '') + '"' +
    ' style="' + _pcLaneStyle(entry) + 'top:' + top + 'px;height:' + height + 'px;background:' + color + '"' +
    ' draggable="true"' +
    ' title="Клик → хора за това видео"' +
    ' onclick="pcSelectEntry(event,' + entry.id + ')"' +
    ' ondragstart="pcEventDragStart(event,' + entry.id + ',' + entry.start_minute + ')">' +
    '<button class="pc-event__del" title="Върни в списъка" onclick="event.stopPropagation();pcDeleteEntry(' + entry.id + ')">↩</button>' +
    '<div class="pc-event__title">' + esc(entry.card_title || '') + '</div>' +
    (short ? '' : '<div class="pc-event__time">' + t0 + ' – ' + t1 + '</div>') +
    (people.length && !short ? '<div class="pc-event__people">' + people.map(_pcAvatarHtml).join('') + '</div>' : '') +
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
    if (_prodCal.column && c.column !== _prodCal.column) return;
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
  return html || '<div class="pc-empty-msg">' + (_prodCal.column ? 'Няма ненасрочени карти в „' + esc(_prodCal.column) + '“' : 'Всички карти са насрочени') + '</div>';
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
  var MON_BG   = ['яну','фев','мар','апр','май','юни','юли','авг','сеп','окт','ное','дек'];
  var external = _pcExternal();
  if (_prodCal.focus) {
    var fc = _pcFocusCals();
    external = external.filter(function(e) { return fc.indexOf(e.calendar_id) >= 0; });
  }

  // ── day headers (+ целодневните Google събития) ──
  var hdr = '<div class="pc-week-hdr"><div class="pc-time-gutter"></div>';
  days.forEach(function(d) {
    var ds      = _pcDate(d);
    var isToday = ds === todayStr;
    var allDay  = external.filter(function(e) { return e.all_day && e.date === ds; });
    hdr +=
      '<div class="pc-day-hdr' + (isToday ? ' today' : '') + '">' +
      '<div class="pc-day-hdr__name">' + DAY_BG[d.getDay()] +
        ((d === days[0] || d.getDate() === 1) ? ' · ' + MON_BG[d.getMonth()] : '') + '</div>' +
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
      if (e.scheduled_date !== ds || !_pcEntryVisible(e)) return;
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
  return (
    '<div class="pc-toolbar">' +
    '<button class="btn btn-sm btn-ghost" onclick="pcNavWeek(-1)">← Предишна</button>' +
    '<button class="btn btn-sm btn-ghost" onclick="pcNavToday()">Днес</button>' +
    '<button class="btn btn-sm btn-ghost" onclick="pcNavWeek(1)">Следваща →</button>' +
    _pcCalendarPickerHtml() +
    _pcPersonFilterHtml() +
    _pcHistoryHtml() +
    (_prodCal.canManage ? '<a class="btn btn-sm btn-ghost" href="#/calendar/settings" title="Календари, чий е всеки, видеографи, мини админи">⚙️ Настройки</a>' : '') +
    '<span style="flex:1"></span>' +
    '<span class="pc-toolbar__hint">Влачи карта от панела → пусни в деня · Клик на видео → хора · Дръж долния ръб за продължителност · 📅 = от Google Calendar</span>' +
    '</div>'
  );
}

// „Хора“ — избираш човек по име и в календара остават ярки само неговите снимки
// (същото като 👁 в панела с хората). Видеографите са най-отгоре.
function _pcIsVideographer(p) {
  if (typeof p.videographer === 'boolean') return p.videographer; // по длъжност или ръчно от ⚙️
  return /videograph|видеограф|head of production/i.test(p.title || '');
}

function _pcPersonFilterHtml() {
  var team = _prodCal.team || [];
  if (!team.length && !_prodCal.extPeople.length) return '';
  var opt = function(key, name) {
    return '<option value="' + esc(key) + '"' + (_prodCal.focus === key ? ' selected' : '') + '>' + esc(name) + '</option>';
  };
  var vg = team.filter(_pcIsVideographer), rest = team.filter(function(p) { return !_pcIsVideographer(p); });
  var group = function(label, list) {
    return list.length ? '<optgroup label="' + label + '">' + list.map(function(p) { return opt('bc:' + p.person_id, p.name); }).join('') + '</optgroup>' : '';
  };
  return '<label class="pc-cal-target" title="Покажи само снимките на този човек">👤' +
    '<select onchange="pcSetFocus(this.value)">' +
    '<option value="">Всички хора</option>' +
    group('Видеографи', vg) + group('Останалият екип', rest) +
    (_prodCal.extPeople.length
      ? '<optgroup label="Външни">' + _prodCal.extPeople.map(function(x) { return opt('ext:' + String(x.name).toLowerCase(), x.name); }).join('') + '</optgroup>'
      : '') +
    '</select></label>';
}

function pcSetFocus(key) {
  _prodCal.focus = key || null;
  _pcAfterFocus();
}

function _pcAfterFocus() {
  _prodCal.external = {}; // кешът е за друг набор календари
  _pcRenderSidebar();
  _pcRefreshWeekView();
  _pcRefreshToolbar();
  pcLoadExternal();
}

function _pcRefreshToolbar() {
  var toolbar = document.querySelector('.pc-toolbar');
  if (toolbar) toolbar.outerHTML = _pcToolbarHtml();
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

var _PC_ACTION_ICONS = { add: '➕', reschedule: '🔀', move: '↔️', resize: '↕️', remove: '↩️', assign: '👤', unassign: '👤', settings: '⚙️' };

function _pcHistoryHtml() {
  return '<details class="pc-cal-picker pc-history" ontoggle="if(this.open){_pcPlaceHistory(this);pcLoadHistory()}">' +
    '<summary>🕘 История</summary>' +
    '<div class="pc-cal-menu pc-history__menu" id="pcHistoryList">' +
      '<div class="pc-history__empty">Зареждане…</div>' +
    '</div></details>';
}

// Панелът е fixed, иначе `.pc-wrap` (overflow: hidden) го реже отдясно и отдолу.
// Слага се под бутона и се държи изцяло в прозореца на браузъра.
function _pcPlaceHistory(details) {
  var menu = details.querySelector('.pc-history__menu');
  if (!menu) return;
  var r = details.querySelector('summary').getBoundingClientRect();
  var w = Math.min(560, window.innerWidth - 24);
  menu.style.width = w + 'px';
  menu.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
  menu.style.top = (r.bottom + 6) + 'px';
  menu.style.maxHeight = Math.max(200, window.innerHeight - r.bottom - 24) + 'px';
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
          (r.card_title || r.basecamp_card_id ? '<span class="pc-history__card"> · ' + esc(r.card_title || ('Карта ' + r.basecamp_card_id)) + '</span>' : '') +
        '</span>' +
        '<span class="pc-history__ago" title="' + esc(new Date(r.created_at).toLocaleString('bg-BG')) + '">' + esc(_pcAgo(r.created_at)) + '</span>' +
      '</div>';
    }).join('');
  } catch (e) {
    host.innerHTML = '<div class="pc-history__empty">Грешка при зареждане.</div>';
  }
}

// Панелът вляво: картите за насрочване или — когато е избрано видео — хората.
function _pcSidebarInner() {
  var entry = _prodCal.selectedId && _prodCal.entries.find(function(e) { return e.id === _prodCal.selectedId; });
  if (entry) return _pcPeoplePanelHtml(entry);
  _prodCal.selectedId = null;
  return '<div class="pc-sidebar__hdr">' +
      '<div class="pc-sidebar__title">Карти за снимки</div>' +
      _pcColumnSelectHtml() +
      '<input class="pc-sidebar__search" id="pcSearch" placeholder="Търси карта…" oninput="pcFilterCards(this.value)">' +
    '</div>' +
    '<div class="pc-sidebar__list" id="pcSidebarList">' + _pcSidebarHtml() + '</div>';
}

// Колоните от таблото Production (Разпределение, Външни, Студио, Вики…) в реда
// на таблото — избраната оставя вляво само нейните карти. Изборът е личен.
function _pcColumnNames() {
  var seen = {}, out = [];
  _prodCal.cards.forEach(function(c) {
    if (c.column && !seen[c.column]) { seen[c.column] = true; out.push(c.column); }
  });
  return out;
}

function _pcColumnSelectHtml() {
  var cols = _pcColumnNames();
  if (_prodCal.column && cols.indexOf(_prodCal.column) < 0) cols.push(_prodCal.column);
  return '<select class="pc-sidebar__search pc-sidebar__col" title="Колона от таблото Production" onchange="pcSetColumn(this.value)">' +
    '<option value="">Всички колони</option>' +
    cols.map(function(c) {
      return '<option value="' + esc(c) + '"' + (c === _prodCal.column ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('') +
    '</select>';
}

function pcSetColumn(col) {
  _prodCal.column = col || '';
  try { localStorage.setItem('thepact-pc-column', _prodCal.column); } catch (e) {}
  _pcRefreshSidebarCard();
}

function _pcRenderSidebar() {
  var side = document.querySelector('.pc-sidebar');
  if (!side) return;
  var list = side.querySelector('.pc-sidebar__list');
  var scroll = list ? list.scrollTop : 0;
  side.innerHTML = _pcSidebarInner();
  list = side.querySelector('.pc-sidebar__list');
  if (list && _prodCal.selectedId) list.scrollTop = scroll;
}

// ─── хора към видеото ─────────────────────────────────────────────────────────
// Клик на видео → вляво излизат хората (Basecamp + запомнени външни). Отмятат се
// колкото трябва и „Запази“ ги праща наведнъж (чернова в _prodCal.draft). Човек
// може и да се влачи върху друго видео — това назначава веднага. Хората от
// Basecamp стават assignee на картата и ботът пуска ЕДИН коментар с таг към
// всички — това го прави сървърът. 👁 до човека = показва само неговите снимки.

function _pcPersonKey(p) {
  return p.kind === 'ext' || (!p.person_id && p.name) ? 'ext:' + String(p.name).toLowerCase() : 'bc:' + p.person_id;
}

function _pcHasPerson(entry, key) {
  return (entry.people || []).some(function(p) { return _pcPersonKey(p) === key; });
}

function _pcAvatarHtml(p) {
  var ext = p.kind === 'ext';
  var tip = p.name + (ext ? ' (външен)' : '');
  if (!ext && p.avatar_url) {
    return '<span class="pc-av" title="' + esc(tip) + '"><img src="' + esc(p.avatar_url) + '" alt=""></span>';
  }
  return '<span class="pc-av' + (ext ? ' pc-av--ext' : '') + '" title="' + esc(tip) + '"' +
    (ext ? '' : ' style="background:' + _avColor(p.name) + '"') + '>' + esc(initials(p.name)) + '</span>';
}

// Брой снимки на човек във видимата седмица — за да личи кой колко е натоварен.
function _pcWeekCount(key) {
  var from = _pcDate(_prodCal.weekStart);
  var end = new Date(_prodCal.weekStart); end.setDate(end.getDate() + 6);
  var to = _pcDate(end);
  return _prodCal.entries.filter(function(e) {
    return e.scheduled_date >= from && e.scheduled_date <= to && _pcHasPerson(e, key);
  }).length;
}

// Черновата на избраното видео: кой е отметнат, преди да се натисне „Запази“.
function _pcDraft(entry) {
  if (!_prodCal.draft || _prodCal.draft.entryId !== entry.id) {
    var picks = {};
    (entry.people || []).forEach(function(p) {
      picks[_pcPersonKey(p)] = p.kind === 'ext' ? { name: p.name } : { personId: p.person_id };
    });
    _prodCal.draft = { entryId: entry.id, picks: picks };
  }
  return _prodCal.draft;
}

// Разликата между черновата и записаното: { add: [payload], remove: [assignId] }
function _pcDraftDiff(entry) {
  var picks = _pcDraft(entry).picks;
  var add = Object.keys(picks).filter(function(k) { return !_pcHasPerson(entry, k); })
    .map(function(k) { return picks[k]; });
  var remove = (entry.people || []).filter(function(p) { return !picks[_pcPersonKey(p)]; })
    .map(function(p) { return p.id; });
  return { add: add, remove: remove };
}

function _pcPersonRowHtml(p, entry) {
  var key = _pcPersonKey(p);
  var on = !!_pcDraft(entry).picks[key];
  var cnt = _pcWeekCount(key);
  var data = p.kind === 'ext' ? 'data-name="' + esc(p.name) + '"' : 'data-person="' + esc(p.person_id) + '"';
  return '<div class="pc-person' + (on ? ' pc-person--on' : '') + (p.kind === 'ext' ? ' pc-person--ext' : '') + '"' +
    ' ' + data + ' draggable="true"' +
    ' title="' + (on ? 'Махни отметката' : 'Отметни') + ' (или влачи върху друго видео)"' +
    ' onclick="pcTogglePerson(this)" ondragstart="pcPersonDragStart(event,this)" ondragend="pcPersonDragEnd()">' +
    _pcAvatarHtml(p) +
    '<div class="pc-person__name">' + esc(p.name) +
      (p.title ? '<div class="pc-person__sub">' + esc(p.title) + '</div>' : '') +
    '</div>' +
    '<span class="pc-person__cnt" title="Снимки тази седмица">' + cnt + '</span>' +
    '<button class="pc-person__btn' + (_prodCal.focus === key ? ' on' : '') + '" title="Покажи само неговите снимки"' +
      ' onclick="event.stopPropagation();pcFocusPerson(' + esc(JSON.stringify(key)) + ')">👁</button>' +
    (p.kind === 'ext' && p.id
      ? '<button class="pc-person__btn" title="Забрави този външен човек" onclick="event.stopPropagation();pcForgetExternal(' + p.id + ')">×</button>'
      : '') +
    (on ? '<span class="pc-person__check">✓</span>' : '') +
  '</div>';
}

function _pcPeoplePanelHtml(entry) {
  var t0 = _pcMinToTime(entry.start_minute);
  var t1 = _pcMinToTime(entry.start_minute + entry.duration_minutes);
  var d = new Date(entry.scheduled_date + 'T12:00:00');
  var DAY = ['Нд', 'Пон', 'Вт', 'Ср', 'Чет', 'Пет', 'Съб'];
  var when = DAY[d.getDay()] + ', ' + d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0') + ' · ' + t0 + ' – ' + t1;

  // Външни: запомнените + назначени, които междувременно са „забравени“.
  var ext = _prodCal.extPeople.map(function(x) { return { kind: 'ext', id: x.id, name: x.name }; });
  // плюс новите, написани в черновата.
  var picks = _pcDraft(entry).picks;
  Object.keys(picks).forEach(function(k) {
    if (picks[k].name && !ext.some(function(x) { return _pcPersonKey(x) === k; })) ext.push({ kind: 'ext', name: picks[k].name });
  });
  var diff = _pcDraftDiff(entry);
  var changes = diff.add.length + diff.remove.length;

  // Фокусът е върху видеографите; останалите са в сгънато меню — отворено само ако
  // някой от тях вече е отметнат, за да не се скрие назначен човек.
  var bcRow = function(p) { return _pcPersonRowHtml({ kind: 'bc', person_id: p.person_id, name: p.name, title: p.title, avatar_url: p.avatar_url, videographer: p.videographer }, entry); };
  var vgRows = _prodCal.team.filter(_pcIsVideographer).map(bcRow).join('');
  var restList = _prodCal.team.filter(function(p) { return !_pcIsVideographer(p); });
  var restRows = restList.map(bcRow).join('');
  var restOpen = restList.some(function(p) { return picks['bc:' + p.person_id]; });

  return '<div class="pc-sidebar__hdr">' +
      '<button class="pc-people__back" onclick="pcSelectEntry(null,null)">← Карти за снимки</button>' +
      '<div class="pc-sidebar__title pc-people__title">' + esc(entry.card_title || '') + '</div>' +
      '<div class="pc-people__when">' + when + '</div>' +
      _pcEntryCalendarHtml(entry) +
      (entry.card_url ? '<a class="pc-people__open" href="' + esc(entry.card_url) + '" target="_blank" rel="noopener">Отвори в Basecamp ↗</a>' : '') +
    '</div>' +
    '<div class="pc-sidebar__list">' +
      '<div class="pc-board-label">Видеографи</div>' +
      (_prodCal.team.length
        ? (vgRows || '<div class="pc-empty-msg">Няма човек с длъжност „Videographer“ в Basecamp</div>')
        : '<div class="pc-empty-msg">Зареждане…</div>') +
      (restRows
        ? '<details class="pc-people__more"' + (restOpen ? ' open' : '') + '>' +
            '<summary class="pc-board-label">Останалият екип (' + restList.length + ')</summary>' + restRows +
          '</details>'
        : '') +
      '<div class="pc-board-label">Външни хора</div>' +
      ext.map(function(p) { return _pcPersonRowHtml(p, entry); }).join('') +
      '<div class="pc-people__add">' +
        '<input class="pc-sidebar__search" id="pcExtName" placeholder="+ Външен човек (име и Enter)" maxlength="120"' +
        ' onkeydown="if(event.key===\'Enter\')pcAddExternal()">' +
      '</div>' +
      '<div class="pc-people__hint">Отметни всички нужни хора и натисни „Запази“. Хората от Basecamp стават assignee на картата и ботът ги тагва с един коментар за деня и часа. Всички се записват и в събитието в Google Calendar.</div>' +
    '</div>' +
    '<div class="pc-people__save">' +
      '<button class="btn btn-sm btn-primary" id="pcPeopleSave" onclick="pcSavePeople()"' + (changes ? '' : ' disabled') + '>' +
        (changes ? 'Запази (' + changes + ')' : 'Няма промени') + '</button>' +
      (changes ? '<button class="btn btn-sm btn-ghost" onclick="pcDiscardPeople()">Откажи</button>' : '') +
    '</div>';
}

// „Календар:" на избраното видео — преместване в календара на друг човек.
// Сървърът маха стария човек и назначава (и тагва) новия.
function _pcEntryCalendarHtml(entry) {
  var cals = _prodCal.calendars.filter(function(c) { return c.can_write; });
  if (cals.length < 2) return '';
  var cur = entry.calendar_id || _pcDefaultCalId();
  return '<label class="pc-people__cal">Календар: <select onchange="pcMoveToCalendar(' + entry.id + ', this.value)">' +
    cals.map(function(c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === cur ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('') + '</select></label>';
}

async function pcMoveToCalendar(entryId, calId) {
  var entry = _prodCal.entries.find(function(e) { return e.id === entryId; });
  if (!entry) return;
  try {
    var res = await fetch('/api/bc-calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: entry.card_id, title: entry.card_title, url: entry.card_url,
        scheduledDate: entry.scheduled_date, startMinute: entry.start_minute,
        durationMinutes: entry.duration_minutes, calendarId: calId,
      }),
    });
    if (!res.ok) { showToast && showToast('Не стана преместването', 'error'); return; }
    var data = await res.json();
    entry.calendar_id = data.calendar_id;
    _prodCal.draft = null;
    _pcAfterSave(entry, data, 'Преместено');
    _pcRenderSidebar();
    _pcRefreshWeekView();
  } catch (e) {}
}

async function pcLoadPeople() {
  try {
    var res = await fetch('/api/bc-calendar/people');
    if (!res.ok) return;
    var data = await res.json();
    _prodCal.team = data.team || [];
    _prodCal.extPeople = data.external || [];
    _prodCal.canManage = !!data.canManage;
    if (_prodCal.selectedId) _pcRenderSidebar();
    _pcRefreshToolbar();
  } catch (e) {}
}

function _pcHasUnsaved() {
  var entry = _prodCal.draft && _prodCal.entries.find(function(x) { return x.id === _prodCal.draft.entryId; });
  if (!entry) return false;
  var d = _pcDraftDiff(entry);
  return d.add.length + d.remove.length > 0;
}

function pcSelectEntry(e, entryId) {
  if (e) e.stopPropagation();
  // Клик точно след дърпане на долния ръб не е избор.
  if (_pcResize.didResize) { _pcResize.didResize = false; return; }
  var next = (entryId && _prodCal.selectedId !== entryId) ? entryId : null;
  if (next !== _prodCal.selectedId && _pcHasUnsaved() && !confirm('Има незапазени промени по хората. Да ги откажа?')) return;
  _prodCal.draft = null;
  _prodCal.selectedId = next;
  _pcRenderSidebar();
  _pcRefreshWeekView();
}

function pcFocusPerson(key) {
  _prodCal.focus = _prodCal.focus === key ? null : key;
  _pcAfterFocus();
}

function _pcPersonPayload(el) {
  return el.dataset.person ? { personId: el.dataset.person } : { name: el.dataset.name };
}

function _pcAfterSave(entry, data, label) {
  entry.people = data.people || [];
  var known = _prodCal.extPeople.map(function(x) { return x.name.toLowerCase(); });
  if (entry.people.some(function(p) { return p.kind === 'ext' && known.indexOf(p.name.toLowerCase()) < 0; })) pcLoadPeople();
  if (data.warnings && data.warnings.length) alert(label + ', но:\n' + data.warnings.join('\n'));
}

// Влачене върху видео → веднага, без чернова.
async function _pcAssign(entryId, payload) {
  var entry = _prodCal.entries.find(function(e) { return e.id === entryId; });
  if (!entry) return;
  try {
    var res = await fetch('/api/bc-calendar/' + entryId + '/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok) { alert(data.error || 'Грешка при назначаване'); return; }
    _pcAfterSave(entry, data, 'Назначен(а) е в календара');
    // Ако е избраното видео — човекът влиза и в черновата, за да не се махне при „Запази“.
    if (_prodCal.draft && _prodCal.draft.entryId === entryId) {
      _prodCal.draft.picks[payload.personId ? 'bc:' + payload.personId : 'ext:' + String(payload.name).toLowerCase()] = payload;
    }
  } catch (e) { alert('Грешка при назначаване'); }
  _pcRenderSidebar();
  _pcRefreshWeekView();
}

async function pcSavePeople() {
  var entry = _prodCal.selectedId && _prodCal.entries.find(function(e) { return e.id === _prodCal.selectedId; });
  if (!entry) return;
  var diff = _pcDraftDiff(entry);
  if (!diff.add.length && !diff.remove.length) return;
  var btn = document.getElementById('pcPeopleSave');
  if (btn) { btn.disabled = true; btn.textContent = 'Записване…'; }
  try {
    var res = await fetch('/api/bc-calendar/' + entry.id + '/people', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(diff),
    });
    var data = await res.json().catch(function() { return {}; });
    if (!res.ok) { alert(data.error || 'Грешка при записване'); }
    else { _pcAfterSave(entry, data, 'Записано е в календара'); _prodCal.draft = null; }
  } catch (e) { alert('Грешка при записване'); }
  _pcRenderSidebar();
  _pcRefreshWeekView();
}

function pcDiscardPeople() {
  _prodCal.draft = null;
  _pcRenderSidebar();
}

function pcTogglePerson(el) {
  var entryId = _prodCal.selectedId;
  var entry = entryId && _prodCal.entries.find(function(e) { return e.id === entryId; });
  if (!entry) return;
  var picks = _pcDraft(entry).picks;
  var key = el.dataset.person ? 'bc:' + el.dataset.person : 'ext:' + String(el.dataset.name).toLowerCase();
  if (picks[key]) delete picks[key]; else picks[key] = _pcPersonPayload(el);
  _pcRenderSidebar();
}

function pcAddExternal() {
  var inp = document.getElementById('pcExtName');
  var name = inp ? inp.value.trim() : '';
  var entry = _prodCal.selectedId && _prodCal.entries.find(function(e) { return e.id === _prodCal.selectedId; });
  if (!name || !entry) return;
  _pcDraft(entry).picks['ext:' + name.toLowerCase()] = { name: name };
  _pcRenderSidebar();
  var next = document.getElementById('pcExtName');
  if (next) next.focus();
}

async function pcForgetExternal(id) {
  var p = _prodCal.extPeople.find(function(x) { return x.id === id; });
  if (!p || !confirm('Да забравя „' + p.name + '“ от списъка с външни хора?\n(Където вече е назначен(а), остава.)')) return;
  try { await fetch('/api/bc-calendar/people/external/' + id, { method: 'DELETE' }); } catch (e) {}
  _prodCal.extPeople = _prodCal.extPeople.filter(function(x) { return x.id !== id; });
  _pcRenderSidebar();
}

// Влачене на човек върху видео (което и да е — не само избраното).
var _pcPersonDrag = null;

function pcPersonDragStart(e, el) {
  _pcPersonDrag = _pcPersonPayload(el);
  _pcDrag.type = 'person';
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('text/plain', 'person');
}

function pcPersonDragEnd() {
  _pcPersonDrag = null;
  if (_pcDrag.type === 'person') _pcDrag.type = null;
  document.querySelectorAll('.pc-event--drop').forEach(function(x) { x.classList.remove('pc-event--drop'); });
}

function _pcPersonDragOver(e) {
  var ev = e.target.closest && e.target.closest('.pc-event[data-entry-id]');
  document.querySelectorAll('.pc-event--drop').forEach(function(x) { if (x !== ev) x.classList.remove('pc-event--drop'); });
  if (!ev) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  ev.classList.add('pc-event--drop');
}

function _pcPersonDrop(e) {
  var ev = e.target.closest && e.target.closest('.pc-event[data-entry-id]');
  var payload = _pcPersonDrag;
  pcPersonDragEnd();
  if (!ev || !payload) return;
  e.preventDefault();
  var entryId = parseInt(ev.dataset.entryId, 10);
  var entry = _prodCal.entries.find(function(x) { return x.id === entryId; });
  var key = payload.personId ? 'bc:' + payload.personId : 'ext:' + String(payload.name).toLowerCase();
  if (!entry || _pcHasPerson(entry, key)) return;
  _pcAssign(entryId, payload);
}

function _pcFullRender(el) {
  el.innerHTML =
    '<div class="pc-wrap">' +
      '<div class="pc-sidebar">' + _pcSidebarInner() + '</div>' +
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

async function renderCalendar(el, sub) {
  setBreadcrumb(null);
  el.className = 'full-width';
  if (sub === 'settings') return renderPcSettings(el);

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
    _prodCal.selectedId = null;
    _prodCal.draft = null;

    _pcFullRender(el);
    pcLoadPeople();    // хората за панела „кой снима" — отделно, не бавят календара
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
  if (_pcDrag.type === 'person') { _pcPersonDragOver(e); return; }
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
  if (_pcDrag.type === 'person') { _pcPersonDrop(e); return; }
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

// ─── ⚙️ Настройки на производствения календар (#/calendar/settings) ──────────
// Цяла страница. Мини админът (общ за целия календар) добавя календари, казва чий
// е всеки и кои са видеографи. Мини админи дава само пълният админ.

var _pcSet = null;

async function renderPcSettings(el) {
  pcStopPolling();
  el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Зареждане…</div>';
  try {
    var res = await fetch('/api/bc-calendar/settings');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _pcSet = await res.json();
  } catch (e) {
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--red)">Грешка при зареждане</div>';
    return;
  }
  el.innerHTML = _pcSettingsHtml();
}

function _pcSettingsHtml() {
  var d = _pcSet, ro = !d.canManage;
  var dis = ro ? ' disabled' : '';
  var personOpts = function(sel) {
    var vg = d.people.filter(function(p) { return p.by_title || p.extra; });
    var rest = d.people.filter(function(p) { return !(p.by_title || p.extra); });
    var o = function(p) { return '<option value="' + esc(p.person_id) + '"' + (p.person_id === sel ? ' selected' : '') + '>' + esc(p.name) + '</option>'; };
    return '<option value="">— общ календар (без човек) —</option>' +
      (vg.length ? '<optgroup label="Видеографи">' + vg.map(o).join('') + '</optgroup>' : '') +
      (rest.length ? '<optgroup label="Останалият екип">' + rest.map(o).join('') + '</optgroup>' : '');
  };

  var cals = d.calendars.map(function(c) {
    var state = c.can_write === true ? '<span class="pcs-ok">може да се добавят карти</span>'
      : c.can_write === false ? '<span class="pcs-warn">само четене — дай на бота „Make changes to events“</span>'
      : '<span class="pcs-dim">достъпът още не е проверен</span>';
    return '<div class="pcs-row">' +
      '<div class="pcs-row__main"><strong>' + esc(c.name) + '</strong>' + (c.is_default ? ' <span class="pcs-dim">(основен)</span>' : '') +
        (c.enabled === false ? ' <span class="pcs-dim">(изключен)</span>' : '') +
        '<div class="pcs-sub">' + state + (c.last_error ? ' · <span class="pcs-warn">' + esc(c.last_error) + '</span>' : '') + '</div></div>' +
      (c.feed_id
        ? '<select class="pcs-select" onchange="pcsSetOwner(' + c.feed_id + ', this.value)"' + dis + '>' + personOpts(c.person_id) + '</select>'
        : '<span class="pcs-dim">общ</span>') +
    '</div>';
  }).join('');

  var vgRows = d.people.map(function(p) {
    var on = p.by_title || p.extra;
    return '<label class="pcs-check">' +
      '<input type="checkbox"' + (on ? ' checked' : '') + (p.by_title || ro ? ' disabled' : '') +
      ' onchange="pcsSetVideographer(' + jsq(p.person_id) + ', this.checked)">' +
      '<span>' + esc(p.name) + '</span><span class="pcs-dim">' + esc(p.title) + (p.by_title ? ' · по длъжност' : '') + '</span></label>';
  }).join('');

  var admins = d.admins.map(function(u) {
    return '<label class="pcs-check">' +
      '<input type="checkbox"' + (u.granted ? ' checked' : '') + (u.is_admin || !d.fullAdmin ? ' disabled' : '') +
      ' onchange="pcsSetAdmin(' + u.id + ', this.checked)">' +
      '<span>' + esc(u.name) + '</span>' + (u.is_admin ? '<span class="pcs-dim">админ</span>' : '') + '</label>';
  }).join('');

  return '<div class="pcs-page">' +
    '<div class="pcs-hdr"><a class="btn btn-sm btn-ghost" href="#/calendar">← Към календара</a>' +
      '<h2>⚙️ Настройки — Производствен календар</h2></div>' +
    (ro ? '<div class="pcs-note">Можеш само да разглеждаш. Промени правят мини админите на календара.</div>' : '') +
    '<div class="pcs-grid">' +
    '<section class="pcs-card"><h3>📆 Календари и чий е всеки</h3>' +
      '<p class="pcs-desc">Пуснеш ли карта в календара на човек, той става assignee и ботът го тагва в картата с деня, часа и продължителността. Преместиш ли я в календара на друг, първият се маха, а новият се тагва. Календар без човек е общ.</p>' +
      cals +
      (ro ? '' :
        '<div class="pcs-add"><input id="pcsNewCal" class="pcs-input" placeholder="Calendar ID (…@group.calendar.google.com) или линк">' +
        '<select id="pcsNewOwner" class="pcs-select">' + personOpts(null) + '</select>' +
        '<button class="btn btn-sm btn-primary" onclick="pcsAddCalendar()">Добави</button></div>' +
        '<p class="pcs-desc">Нов календар: създай го в Google Calendar → Settings and sharing → сподели го с <code>' + esc(d.serviceEmail || 'service account-а') + '</code> с права <strong>„Make changes to events“</strong> → копирай Calendar ID-то оттам.</p>') +
    '</section>' +
    '<section class="pcs-card"><h3>🎥 Видеографи</h3>' +
      '<p class="pcs-desc">Видеографите са най-отгоре при назначаване и в менюто с хората. Тези по длъжност в Basecamp са отметнати сами. Тук можеш да отметнеш още хора.</p>' +
      '<div class="pcs-list">' + vgRows + '</div>' +
    '</section>' +
    '<section class="pcs-card"><h3>🛡 Мини админи</h3>' +
      '<p class="pcs-desc">Мини админът е общ за целия производствен календар и може да променя всичко на тази страница. ' + (d.fullAdmin ? 'Отметни кой да е мини админ.' : 'Мини админи дава само админ.') + '</p>' +
      '<div class="pcs-list">' + admins + '</div>' +
    '</section>' +
    '</div></div>';
}

async function _pcsSend(url, method, body) {
  var res = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  var data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) { showToast((data && data.error) || 'Грешка', 'error'); return null; }
  return data;
}

async function pcsSetOwner(feedId, personId) {
  if (await _pcsSend('/api/bc-calendar/settings/calendars/' + feedId, 'PUT', { personId: personId || null })) showToast('Запазено');
  _prodCal.calendars = []; // календарът ще ги прочете наново
}

async function pcsSetVideographer(personId, on) {
  if (await _pcsSend('/api/bc-calendar/settings/videographers/' + encodeURIComponent(personId), 'PUT', { on: on })) showToast('Запазено');
}

async function pcsSetAdmin(userId, granted) {
  if (await _pcsSend('/api/bc-calendar/settings/admins/' + userId, 'PUT', { granted: granted })) showToast('Запазено');
}

async function pcsAddCalendar() {
  var inp = document.getElementById('pcsNewCal');
  var owner = document.getElementById('pcsNewOwner');
  if (!inp || !inp.value.trim()) return;
  var data = await _pcsSend('/api/bc-calendar/settings/calendars', 'POST', { calendar: inp.value.trim(), personId: owner ? owner.value : null });
  if (!data) return;
  if (data.access && !data.access.ok) showToast('Добавен, но Google не го дава: ' + (data.access.error || ''), 'error');
  else showToast('Календарът е добавен');
  renderPcSettings(document.getElementById('pageContent'));
}
