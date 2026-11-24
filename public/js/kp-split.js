// ==================== КП → задачи ("Създай задачи по КП") ====================
// Modal: pick a Pre-Production content-plan card + destination board → preview the
// videos that will be created → create them in the board's "Разпределение" column.
//
// От 21.08.2026 прегледът е и работно място (поискано от Венци):
//   • „Преглед" на всеки ред разгъва ЦЯЛАТА задача — описанието, което ще влезе в
//     картата, медията и стъпките с датите им;
//   • датата на всяко видео се редактира ПРЕДИ създаването — новата дата отива и в
//     самия контент план (бота го пренаписва), и в новата задача, и в стъпките;
//   • подготвените дати от главата на плана се следят: остане ли дата без видео,
//     излиза известие точно коя е.
//
// От 24.11.2026 (Венци): подредба на прегледа — „По номер" (както са разписани и
// номерирани в плана) или „По дата" (най-скорошна → най-далечна; видеата БЕЗ дата
// излизат най-горе). В режим „По дата" списъкът се пренарежда при всяка смяна на дата.
//
// От 24.11.2026 (Венци): чернова — сменените дати, „Пропусни" и подредбата се пазят
// автоматично в браузъра (localStorage, по контент план), докато задачите не са
// създадени. Рефреш или затваряне не ги губи — при „Преглед" на същия план се връщат.
var _kps = { init: null, cardId: null, videos: [], planDates: [], truncated: false, sort: 'num' };

async function showKpSplit() {
  if (typeof closeAllDropdowns === 'function') closeAllDropdowns();
  document.querySelectorAll('.kps-overlay').forEach(function (o) { o.remove(); });
  var ov = document.createElement('div');
  ov.className = 'modal-overlay kps-overlay';
  // tabindex="-1" прави прозореца фокусируем — иначе фокусът остава на страницата
  // отдолу и колелцето/стрелките скролват нея, а не съдържанието на прозореца
  // (Венци, 21.08.2026).
  ov.innerHTML =
    '<div class="kps-modal" tabindex="-1">' +
      '<div class="kps-modal__hdr"><strong>Създай задачи по КП</strong>' +
        '<button class="kps-close" aria-label="Затвори">✕</button></div>' +
      '<div class="kps-modal__body" id="kpsBody"><div class="kps-muted">Зареждам контент плановете…</div></div>' +
    '</div>';
  document.body.appendChild(ov);
  kpsLockPage(true);
  var modal = ov.querySelector('.kps-modal');
  modal.focus({ preventScroll: true });
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() { ov.remove(); document.removeEventListener('keydown', onKey); kpsLockPage(false); }
  ov.querySelector('.kps-close').addEventListener('click', close);
  // Нарочно НЯМА затваряне при цъкане отстрани (Венци, 26.08.2026) — прозорецът е
  // работно място с наредени дати и едно случайно цъкане до него изтриваше всичко.
  // Затваря се само с „✕" (или Escape).
  document.addEventListener('keydown', onKey);
  try {
    var res = await fetch('/api/kp-split/init');
    var data = await res.json();
    if (!res.ok || data.error) { kpsBody('<div class="kps-err">' + esc(data.error || 'Грешка при зареждане.') + '</div>'); return; }
    _kps.init = data;
    kpsRenderForm();
  } catch (e) { kpsBody('<div class="kps-err">Няма връзка със сървъра.</div>'); }
}

// Заключва страницата отдолу, докато прозорецът е отворен. Само `overscroll-behavior`
// на самия прозорец не стига — колелцето над тъмния кант около него (или след като
// прозорецът стигне края си) продължаваше да скролва платформата.
// Отключваме чак когато НЯМА останал такъв прозорец, за да не се отключи наполовина.
function kpsLockPage(on) {
  if (!on && document.querySelector('.kps-overlay')) return;
  var v = on ? 'hidden' : '';
  document.documentElement.style.overflow = v;
  document.body.style.overflow = v;
}

function kpsBody(html) { var b = document.getElementById('kpsBody'); if (b) b.innerHTML = html; }

function kpsRenderForm() {
  var d = _kps.init || {};
  var plans = d.plans || [], dests = d.destinations || [];
  if (!plans.length) { kpsBody('<div class="kps-err">Няма планове в колона „В продукция" (Pre-Production).</div>'); return; }
  if (!dests.length) { kpsBody('<div class="kps-err">Не намерих Production / Post-Production дъски.</div>'); return; }
  var planOpts = plans.map(function (p) {
    return '<option value="' + p.id + '">' + esc(p.title) + '</option>';
  }).join('');
  var destRadios = dests.map(function (b, i) {
    return '<label class="kps-radio"><input type="radio" name="kpsDest" value="' + b.id + '"' + (i === 0 ? ' checked' : '') + '> ' + esc(b.title) + '</label>';
  }).join('');
  kpsBody(
    '<div class="kps-field"><label>Контент план (от Pre-Production)</label><select id="kpsPlan" class="kps-select" onchange="kpsClearPreview()">' + planOpts + '</select></div>' +
    '<div class="kps-field"><label>Дестинация — мини-задачите отиват в „Разпределение"</label><div class="kps-radios">' + destRadios + '</div></div>' +
    '<button class="btn btn-primary kps-btn" onclick="kpsPreview()">Преглед</button>' +
    '<div id="kpsPreview"></div>'
  );
  // Ако има незавършена чернова — избираме направо този план (последно пипнатия).
  var best = null;
  plans.forEach(function (p) { var dr = kpsDraftLoad(p.id); if (dr && (!best || dr.savedAt > best.savedAt)) best = { id: p.id, savedAt: dr.savedAt }; });
  if (best) {
    var sel = document.getElementById('kpsPlan'); if (sel) sel.value = String(best.id);
    var prev = document.getElementById('kpsPreview');
    if (prev) prev.innerHTML = '<div class="kps-muted">Има запазени (още непуснати) дати за избрания план — натисни „Преглед“, за да ги видиш.</div>';
  }
}

// ---- Чернова (автоматично запазване) ----
function kpsDraftKey(cardId) { return 'kpsDraft:' + cardId; }
function kpsDraftLoad(cardId) {
  try { var d = JSON.parse(localStorage.getItem(kpsDraftKey(cardId)) || 'null'); return d && typeof d === 'object' ? d : null; }
  catch (e) { return null; }
}
function kpsDraftClear(cardId) { try { localStorage.removeItem(kpsDraftKey(cardId)); } catch (e) {} }
function kpsDraftSave() {
  if (!_kps.cardId || !(_kps.videos || []).length) return;
  var dates = {}, skip = [], n = 0;
  _kps.videos.forEach(function (v) {
    if (v.publishDate !== v.origDate) { dates[v.videoNumber] = v.publishDate; n++; }
    if (v.skip) { skip.push(v.videoNumber); n++; }
  });
  try {
    if (!n && _kps.sort === 'num') localStorage.removeItem(kpsDraftKey(_kps.cardId));
    else localStorage.setItem(kpsDraftKey(_kps.cardId), JSON.stringify({ dates: dates, skip: skip, sort: _kps.sort, savedAt: Date.now() }));
  } catch (e) { /* пълен/забранен localStorage — просто не пазим */ }
}
// Прилага черновата върху току-що заредения преглед. Връща колко неща е върнала.
function kpsDraftApply() {
  var d = kpsDraftLoad(_kps.cardId); if (!d) return 0;
  var dates = d.dates || {}, skip = d.skip || [], n = 0;
  _kps.videos.forEach(function (v, i) {
    if (Object.prototype.hasOwnProperty.call(dates, v.videoNumber) && dates[v.videoNumber] !== v.publishDate) {
      v.publishDate = dates[v.videoNumber] || ''; n++;
      kpsFetchSteps(i);
    }
    if (skip.indexOf(v.videoNumber) !== -1) { v.skip = true; n++; }
  });
  if (d.sort === 'date') _kps.sort = 'date';
  return n;
}
function kpsDraftDiscard() {
  if (!confirm('Да върна датите както са в контент плана? Запазените промени ще се изтрият.')) return;
  kpsDraftClear(_kps.cardId);
  kpsPreview();
}

// Преизчислява стъпките за видео i по текущата му дата.
async function kpsFetchSteps(i) {
  var v = _kps.videos[i]; if (!v) return;
  var date = v.publishDate;
  try {
    var res = await fetch('/api/kp-split/step-dates?date=' + encodeURIComponent(date));
    var data = await res.json();
    if (res.ok && data.steps && v.publishDate === date) v.steps = data.steps;
  } catch (e) { /* стъпките остават както са били */ }
  if (v.open) { var box = document.getElementById('kpsFull' + i); if (box) box.innerHTML = kpsFullHtml(v); }
}

function kpsClearPreview() {
  var b = document.getElementById('kpsPreview');
  if (b) b.innerHTML = '';
  _kps.cardId = null; _kps.videos = []; _kps.planDates = [];
  kpsSetWide(false);
}

// „Разширява екрана" — модалът става широк, докато поне един ред е разгънат.
function kpsSetWide(on) {
  var m = document.querySelector('.kps-overlay .kps-modal');
  if (m) m.classList.toggle('kps-modal--wide', !!on);
}

async function kpsPreview() {
  var planEl = document.getElementById('kpsPlan');
  var cardId = planEl && planEl.value;
  if (!cardId) return;
  var destEl = document.querySelector('input[name="kpsDest"]:checked');
  var destBoardId = destEl && destEl.value;
  _kps.cardId = cardId; // lock in the previewed plan so Create uses exactly this one
  var box = document.getElementById('kpsPreview');
  box.innerHTML = '<div class="kps-muted">Чета плана…</div>';
  try {
    var res = await fetch('/api/kp-split/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardId: cardId, destBoardId: destBoardId }) });
    var data = await res.json();
    if (!res.ok || data.error) { box.innerHTML = '<div class="kps-err">' + esc(data.error || 'Грешка.') + '</div>'; return; }
    if (!data.count) { box.innerHTML = '<div class="kps-err">Не разпознах „Видео N - …" секции в този план. Провери формата.</div>'; return; }
    _kps.planDates = data.planDates || [];
    _kps.truncated = !!data.truncated;
    _kps.videos = (data.videos || []).map(function (v) {
      return {
        videoNumber: v.videoNumber, cardTitle: v.cardTitle, snippet: v.snippet,
        mediaCount: v.mediaCount, body: v.body, steps: v.steps || [],
        publishDate: v.publishDate || '', origDate: v.publishDate || '', open: false,
        skip: false, existingCardUrl: v.existingCardUrl || null,
      };
    });
    _kps.sort = 'num';
    var restored = kpsDraftApply();
    box.innerHTML =
      '<div class="kps-preview">' +
        '<div class="kps-preview__hdr" id="kpsCreateHdr">Ще се създадат <b>' + data.count + '</b> задачи' + (data.truncated ? ' (ограничено)' : '') + ':</div>' +
        (restored ? '<div class="kps-okline" id="kpsDraftNote">↺ Върнати са запазените ти промени (' + restored + ') — още не са пуснати. ' +
          '<button type="button" class="kps-vtoggle" onclick="kpsDraftDiscard()">Върни датите от плана</button></div>' : '') +
        '<div id="kpsDatesWarn"></div>' +
        '<div class="kps-sortbar">Подреди: ' +
          '<button type="button" class="kps-vtoggle kps-sortbtn" data-sort="num" onclick="kpsSetSort(this.dataset.sort)">По номер на видеото</button>' +
          '<button type="button" class="kps-vtoggle kps-sortbtn" data-sort="date" onclick="kpsSetSort(this.dataset.sort)">По дата (най-скорошна първа)</button>' +
        '</div>' +
        '<ol class="kps-vlist" id="kpsVList"></ol>' +
        '<button class="btn btn-primary kps-btn" id="kpsCreateBtn" onclick="kpsCreate()">Създай ' + data.count + ' задачи</button>' +
        '<div id="kpsResult"></div>' +
      '</div>';
    kpsRenderList();
    kpsRenderWarn();
    kpsUpdateCreateCount();
  } catch (e) { box.innerHTML = '<div class="kps-err">Грешка при преглед.</div>'; }
}

// Редът, в който се показват видеата (индексите в _kps.videos остават същите).
function kpsOrder() {
  var idx = (_kps.videos || []).map(function (v, i) { return i; });
  if (_kps.sort === 'date') {
    idx.sort(function (a, b) {
      var A = _kps.videos[a], B = _kps.videos[b];
      var da = A.publishDate || '', db = B.publishDate || '';
      if (!da !== !db) return da ? 1 : -1;          // без дата → най-горе
      if (da !== db) return da < db ? -1 : 1;       // най-скорошна → най-далечна
      return a - b;                                 // при еднаква дата — по номер
    });
  }
  return idx;
}

function kpsRenderList() {
  var ol = document.getElementById('kpsVList'); if (!ol) return;
  var focusedId = document.activeElement && document.activeElement.id;
  ol.innerHTML = kpsOrder().map(function (i) { return kpsRowHtml(_kps.videos[i], i); }).join('');
  document.querySelectorAll('.kps-sortbtn').forEach(function (b) {
    b.classList.toggle('kps-sortbtn--on', b.getAttribute('data-sort') === _kps.sort);
  });
  if (focusedId) { var f = document.getElementById(focusedId); if (f) f.focus({ preventScroll: true }); }
}

function kpsSetSort(mode) {
  _kps.sort = mode === 'date' ? 'date' : 'num';
  kpsRenderList();
  kpsDraftSave();
}

function kpsRowHtml(v, i) {
  var media = v.mediaCount ? '<span class="kps-vmedia" title="прикачени файлове">📎 ' + v.mediaCount + '</span>' : '';
  var existing = v.existingCardUrl
    ? '<div class="kps-vexistrow"><a class="kps-vexist" href="' + esc(v.existingCardUrl) + '" target="_blank" rel="noopener"' +
      ' title="Вече има задача с това заглавие в Basecamp — отвори я в нов прозорец">⚠ вече съществува като задача — отвори</a></div>'
    : '';
  // value=i+1 — номерът в списъка остава номерът на видеото и при подредба по дата.
  return '<li class="kps-v' + (v.skip ? ' kps-v--skip' : '') + '" id="kpsRow' + i + '" value="' + (i + 1) + '">' + existing +
    '<div class="kps-vhead">' +
      '<div class="kps-vtitle">' + esc(v.cardTitle) + '</div>' +
      '<div class="kps-vctl">' + media +
        '<input type="date" id="kpsDate' + i + '" class="kps-vdate-inp' + (v.publishDate ? '' : ' kps-vdate-inp--none') + (v.publishDate !== v.origDate ? ' kps-vdate-inp--changed' : '') + '"' +
          ' value="' + esc(v.publishDate) + '" title="Дата за публикуване — може да се смени преди създаването"' +
          (v.skip ? ' disabled' : '') +
          ' onchange="kpsDateChange(' + i + ', this.value)">' +
        '<button type="button" class="kps-vtoggle" id="kpsTgl' + i + '" onclick="kpsToggle(' + i + ')">' + (v.open ? 'Скрий' : 'Преглед') + '</button>' +
        '<button type="button" class="kps-vskip" id="kpsSkip' + i + '" onclick="kpsSkipToggle(' + i + ')">' + (v.skip ? 'Включи' : 'Пропусни') + '</button>' +
      '</div>' +
    '</div>' +
    (v.snippet ? '<div class="kps-vsnip">' + esc(v.snippet) + '…</div>' : '') +
    '<div class="kps-vfull" id="kpsFull' + i + '"' + (v.open ? '>' + kpsFullHtml(v) : ' hidden>') + '</div>' +
  '</li>';
}

// Маркира видео да НЕ се създава — оставя го в плана, но извън тази операция
// (Венци, 28.08.2026: контент планът често има идеи, за които вече е пусната отделна
// задача, или клиентът не е избрал точно тях).
function kpsSkipToggle(i) {
  var v = _kps.videos[i]; if (!v) return;
  v.skip = !v.skip;
  var li = document.getElementById('kpsRow' + i);
  if (li) li.classList.toggle('kps-v--skip', v.skip);
  var btn = document.getElementById('kpsSkip' + i);
  if (btn) btn.textContent = v.skip ? 'Включи' : 'Пропусни';
  var dateInp = document.getElementById('kpsDate' + i);
  if (dateInp) dateInp.disabled = v.skip;
  kpsUpdateCreateCount();
  kpsDraftSave();
}

function kpsUpdateCreateCount() {
  var n = (_kps.videos || []).filter(function (v) { return !v.skip; }).length;
  var hdr = document.getElementById('kpsCreateHdr');
  if (hdr) hdr.innerHTML = 'Ще се създадат <b>' + n + '</b> задачи' + (_kps.truncated ? ' (ограничено)' : '') + ':';
  var btn = document.getElementById('kpsCreateBtn');
  if (btn) { btn.textContent = 'Създай ' + n + ' задачи'; btn.disabled = n === 0; }
}

function kpsToggle(i) {
  var v = _kps.videos[i]; if (!v) return;
  v.open = !v.open;
  var box = document.getElementById('kpsFull' + i);
  var btn = document.getElementById('kpsTgl' + i);
  if (box) { box.hidden = !v.open; if (v.open) box.innerHTML = kpsFullHtml(v); }
  if (btn) btn.textContent = v.open ? 'Скрий' : 'Преглед';
  kpsSetWide(_kps.videos.some(function (x) { return x.open; }));
}

function kpsFullHtml(v) {
  var steps = (v.steps || []).map(function (s) {
    return '<li><span class="kps-stitle">' + esc(s.title) + '</span>' +
      (s.due_on ? '<span class="kps-sdate">' + esc(formatDate(s.due_on)) + '</span>'
                : '<span class="kps-sdate kps-sdate--none">без дата</span>') + '</li>';
  }).join('');
  return '<div class="kps-full">' +
    '<div class="kps-full__lbl">Заглавие на задачата</div>' +
    '<div class="kps-full__val">' + esc(v.cardTitle) + '</div>' +
    '<div class="kps-full__lbl">Due date (дата за публикуване)</div>' +
    '<div class="kps-full__val">' + (v.publishDate ? esc(formatDate(v.publishDate)) : '⚠ няма дата') + '</div>' +
    '<div class="kps-full__lbl">Описание, което ще влезе в задачата</div>' +
    '<pre class="kps-full__pre">' + esc(v.body || '(празно)') + '</pre>' +
    '<div class="kps-full__lbl">Стъпки, които ще се създадат</div>' +
    '<ul class="kps-steplist">' + steps + '</ul>' +
  '</div>';
}

// Смяна на датата в прегледа: препокрива датата от плана, преизчислява стъпките и
// обновява известието за неизползвани дати. Записва се чак при „Създай".
async function kpsDateChange(i, val) {
  var v = _kps.videos[i]; if (!v) return;
  v.publishDate = val || '';
  var inp = document.getElementById('kpsDate' + i);
  if (inp) {
    inp.classList.toggle('kps-vdate-inp--none', !v.publishDate);
    inp.classList.toggle('kps-vdate-inp--changed', v.publishDate !== v.origDate);
  }
  kpsRenderWarn();
  kpsDraftSave();
  if (_kps.sort === 'date') kpsRenderList(); // пренарежда веднага, докато се слагат датите
  await kpsFetchSteps(i);
}

// Кои от подготвените горе в плана дати остават без видео.
function kpsUnusedDates() {
  var used = {};
  (_kps.videos || []).forEach(function (v) { if (v.publishDate) used[v.publishDate] = 1; });
  return (_kps.planDates || []).filter(function (d) { return !used[d]; });
}

function kpsRenderWarn() {
  var el = document.getElementById('kpsDatesWarn'); if (!el) return;
  var pd = _kps.planDates || [], unused = kpsUnusedDates();
  var noDate = (_kps.videos || []).filter(function (v) { return !v.publishDate; }).length;
  var html = '';
  if (pd.length && unused.length) {
    html += '<div class="kps-warn">⚠ ' + unused.length + ' от подготвените дати остават без видео: <b>' +
      unused.map(function (d) { return esc(formatDate(d)); }).join(', ') + '</b></div>';
  } else if (pd.length) {
    html += '<div class="kps-okline">✓ Всички ' + pd.length + ' подготвени дати са насрочени.</div>';
  }
  if (noDate) html += '<div class="kps-warn">⚠ ' + noDate + ' видео без дата — сложи дата, за да се сметнат стъпките.</div>';
  el.innerHTML = html;
}

// Какво стана с архива и с главната карта след създаването (Венци, 22.08.2026).
function kpsArchiveHtml(data) {
  var a = data.archive, m = data.movedToDone, out = '';
  if (a) {
    if (a.basecamp) {
      var b = a.basecamp;
      out += '<div class="kps-muted">Архивирано в Docs &amp; Files → папка <b>' + esc(b.folder) + '</b>' +
        (b.folderCreated ? ' (новосъздадена)' : '') +
        (b.docUrl ? ' → <a href="' + esc(b.docUrl) + '" target="_blank" rel="noopener">' + esc(b.doc) + '</a>' : ' → ' + esc(b.doc)) +
        (b.master ? ' + дописано в „' + esc(b.master) + '"' : '') + '.</div>';
    }
    if (a.basecampError) out += '<div class="kps-err">Архивът в Basecamp не стана: ' + esc(a.basecampError) + '</div>';
    else if (a.masterError) out += '<div class="kps-err">Общият документ на клиента не се допълни: ' + esc(a.masterError) + '</div>';
    if (a.server) out += '<div class="kps-muted">За вътрешния сървър са пуснати заявки: <code>' + esc(a.server.file) + '</code>' +
      (a.server.masterFile ? ' и <code>' + esc(a.server.masterFile) + '</code>' : '') + ' (агентът ги изпълнява до 2 мин).</div>';
    if (a.serverError) out += '<div class="kps-err">Архивът на сървъра не се пусна: ' + esc(a.serverError) + '</div>';
  }
  if (m && m.ok) {
    out += '<div class="kps-muted">Контент планът ' + (m.already ? 'вече беше в' : 'е преместен в') +
      ' „' + esc(m.column) + '".</div>';
  } else if (m) {
    out += '<div class="kps-err">Контент планът НЕ отиде в Not now: ' + esc(m.error) + ' — премести го ръчно.</div>';
  }
  return out;
}

async function kpsCreate() {
  var cardId = _kps.cardId; // the plan that was actually previewed
  var destEl = document.querySelector('input[name="kpsDest"]:checked');
  var destBoardId = destEl && destEl.value;
  if (!cardId || !destBoardId) return;
  var dates = {}, skipNums = [];
  (_kps.videos || []).forEach(function (v) {
    if (v.skip) { skipNums.push(v.videoNumber); return; }
    if (v.publishDate) dates[v.videoNumber] = v.publishDate;
  });
  var rbox = document.getElementById('kpsResult');
  var btns = Array.prototype.slice.call(document.querySelectorAll('.kps-btn'));
  btns.forEach(function (b) { b.disabled = true; });
  if (rbox) rbox.innerHTML = '<div class="kps-muted">Създавам задачите в Basecamp и прехвърлям медията… може да отнеме малко (не затваряй прозореца).</div>';
  try {
    var res = await fetch('/api/kp-split/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardId: cardId, destBoardId: destBoardId, dates: dates, skip: skipNums }) });
    var data = await res.json();
    if (!res.ok || data.error) { if (rbox) rbox.innerHTML = '<div class="kps-err">' + esc(data.error || 'Грешка.') + '</div>'; btns.forEach(function (b) { b.disabled = false; }); return; }
    kpsDraftClear(cardId); // задачите са пуснати — черновата вече не трябва
    var ok = (data.created || []).length, errs = (data.errors || []), skip = (data.skipped || []), merr = (data.mediaErrors || []);
    var html = '<div class="kps-ok">✓ Създадени <b>' + ok + '</b> задачи в „' + esc(data.column || 'Разпределение') + '" (' + esc(data.board || '') + ').</div>';
    var pu = data.planUpdate || {};
    if (pu.changed) {
      if (pu.ok && !(pu.failed || []).length) html += '<div class="kps-muted">Сменените ' + pu.changed + ' дати са записани и в самия контент план.</div>';
      else if (pu.ok) html += '<div class="kps-err">Контент планът е обновен, но ' + pu.failed.length + ' дати не намериха реда си в текста — провери ги ръчно.</div>';
      else html += '<div class="kps-err">Задачите са с новите дати, но контент планът НЕ можа да се обнови' + (pu.error ? ': ' + esc(pu.error) : '') + ' — смени датите там ръчно.</div>';
    }
    html += kpsArchiveHtml(data);
    if ((data.unusedDates || []).length) {
      html += '<div class="kps-warn">⚠ Дати без насрочено видео: <b>' +
        data.unusedDates.map(function (d) { return esc(formatDate(d)); }).join(', ') + '</b></div>';
    }
    if (skip.length) html += '<div class="kps-muted">Пропуснати ' + skip.length + ' (вече съществуват със същото заглавие).</div>';
    if (data.skippedByUser) html += '<div class="kps-muted">Пропуснати ръчно ' + data.skippedByUser + ' (маркирани „Пропусни").</div>';
    if (data.truncated) html += '<div class="kps-muted">⚠ Планът има повече видеа от лимита — създадени са само първите.</div>';
    if (merr.length) html += '<div class="kps-err">' + merr.length + ' медийни файла не се прехвърлиха:<br>' + merr.map(function (m) { return esc((m.filename || '') + ' — ' + (m.error || '')); }).join('<br>') + '</div>';
    if (errs.length) html += '<div class="kps-err">' + errs.length + ' неуспешни задачи: ' + esc(errs.map(function (e) { return e.title; }).join('; ')) + '</div>';
    html += '<div class="kps-muted">Видеата без дата излизат с оранжев сигнал „Няма дата" — сложи Due date и стъпките се попълват автоматично.</div>';
    if (rbox) rbox.innerHTML = html;
  } catch (e) { if (rbox) rbox.innerHTML = '<div class="kps-err">Грешка при създаване.</div>'; btns.forEach(function (b) { b.disabled = false; }); }
}
