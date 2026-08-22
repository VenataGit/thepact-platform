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
var _kps = { init: null, cardId: null, videos: [], planDates: [] };

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
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
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
  _kps.cardId = cardId; // lock in the previewed plan so Create uses exactly this one
  var box = document.getElementById('kpsPreview');
  box.innerHTML = '<div class="kps-muted">Чета плана…</div>';
  try {
    var res = await fetch('/api/kp-split/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardId: cardId }) });
    var data = await res.json();
    if (!res.ok || data.error) { box.innerHTML = '<div class="kps-err">' + esc(data.error || 'Грешка.') + '</div>'; return; }
    if (!data.count) { box.innerHTML = '<div class="kps-err">Не разпознах „Видео N - …" секции в този план. Провери формата.</div>'; return; }
    _kps.planDates = data.planDates || [];
    _kps.videos = (data.videos || []).map(function (v) {
      return {
        videoNumber: v.videoNumber, cardTitle: v.cardTitle, snippet: v.snippet,
        mediaCount: v.mediaCount, body: v.body, steps: v.steps || [],
        publishDate: v.publishDate || '', origDate: v.publishDate || '', open: false,
      };
    });
    box.innerHTML =
      '<div class="kps-preview">' +
        '<div class="kps-preview__hdr">Ще се създадат <b>' + data.count + '</b> задачи' + (data.truncated ? ' (ограничено)' : '') + ':</div>' +
        '<div id="kpsDatesWarn"></div>' +
        '<ol class="kps-vlist">' + _kps.videos.map(kpsRowHtml).join('') + '</ol>' +
        '<button class="btn btn-primary kps-btn" onclick="kpsCreate()">Създай ' + data.count + ' задачи</button>' +
        '<div id="kpsResult"></div>' +
      '</div>';
    kpsRenderWarn();
  } catch (e) { box.innerHTML = '<div class="kps-err">Грешка при преглед.</div>'; }
}

function kpsRowHtml(v, i) {
  var media = v.mediaCount ? '<span class="kps-vmedia" title="прикачени файлове">📎 ' + v.mediaCount + '</span>' : '';
  return '<li class="kps-v">' +
    '<div class="kps-vhead">' +
      '<div class="kps-vtitle">' + esc(v.cardTitle) + '</div>' +
      '<div class="kps-vctl">' + media +
        '<input type="date" id="kpsDate' + i + '" class="kps-vdate-inp' + (v.publishDate ? '' : ' kps-vdate-inp--none') + '"' +
          ' value="' + esc(v.publishDate) + '" title="Дата за публикуване — може да се смени преди създаването"' +
          ' onchange="kpsDateChange(' + i + ', this.value)">' +
        '<button type="button" class="kps-vtoggle" id="kpsTgl' + i + '" onclick="kpsToggle(' + i + ')">Преглед</button>' +
      '</div>' +
    '</div>' +
    (v.snippet ? '<div class="kps-vsnip">' + esc(v.snippet) + '…</div>' : '') +
    '<div class="kps-vfull" id="kpsFull' + i + '" hidden></div>' +
  '</li>';
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
  try {
    var res = await fetch('/api/kp-split/step-dates?date=' + encodeURIComponent(v.publishDate));
    var data = await res.json();
    if (res.ok && data.steps) v.steps = data.steps;
  } catch (e) { /* стъпките остават както са били */ }
  if (v.open) { var box = document.getElementById('kpsFull' + i); if (box) box.innerHTML = kpsFullHtml(v); }
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

async function kpsCreate() {
  var cardId = _kps.cardId; // the plan that was actually previewed
  var destEl = document.querySelector('input[name="kpsDest"]:checked');
  var destBoardId = destEl && destEl.value;
  if (!cardId || !destBoardId) return;
  var dates = {};
  (_kps.videos || []).forEach(function (v) { if (v.publishDate) dates[v.videoNumber] = v.publishDate; });
  var rbox = document.getElementById('kpsResult');
  var btns = Array.prototype.slice.call(document.querySelectorAll('.kps-btn'));
  btns.forEach(function (b) { b.disabled = true; });
  if (rbox) rbox.innerHTML = '<div class="kps-muted">Създавам задачите в Basecamp и прехвърлям медията… може да отнеме малко (не затваряй прозореца).</div>';
  try {
    var res = await fetch('/api/kp-split/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardId: cardId, destBoardId: destBoardId, dates: dates }) });
    var data = await res.json();
    if (!res.ok || data.error) { if (rbox) rbox.innerHTML = '<div class="kps-err">' + esc(data.error || 'Грешка.') + '</div>'; btns.forEach(function (b) { b.disabled = false; }); return; }
    var ok = (data.created || []).length, errs = (data.errors || []), skip = (data.skipped || []), merr = (data.mediaErrors || []);
    var html = '<div class="kps-ok">✓ Създадени <b>' + ok + '</b> задачи в „' + esc(data.column || 'Разпределение') + '" (' + esc(data.board || '') + ').</div>';
    var pu = data.planUpdate || {};
    if (pu.changed) {
      if (pu.ok && !(pu.failed || []).length) html += '<div class="kps-muted">Сменените ' + pu.changed + ' дати са записани и в самия контент план.</div>';
      else if (pu.ok) html += '<div class="kps-err">Контент планът е обновен, но ' + pu.failed.length + ' дати не намериха реда си в текста — провери ги ръчно.</div>';
      else html += '<div class="kps-err">Задачите са с новите дати, но контент планът НЕ можа да се обнови' + (pu.error ? ': ' + esc(pu.error) : '') + ' — смени датите там ръчно.</div>';
    }
    if ((data.unusedDates || []).length) {
      html += '<div class="kps-warn">⚠ Дати без насрочено видео: <b>' +
        data.unusedDates.map(function (d) { return esc(formatDate(d)); }).join(', ') + '</b></div>';
    }
    if (skip.length) html += '<div class="kps-muted">Пропуснати ' + skip.length + ' (вече съществуват със същото заглавие).</div>';
    if (data.truncated) html += '<div class="kps-muted">⚠ Планът има повече видеа от лимита — създадени са само първите.</div>';
    if (merr.length) html += '<div class="kps-err">' + merr.length + ' медийни файла не се прехвърлиха:<br>' + merr.map(function (m) { return esc((m.filename || '') + ' — ' + (m.error || '')); }).join('<br>') + '</div>';
    if (errs.length) html += '<div class="kps-err">' + errs.length + ' неуспешни задачи: ' + esc(errs.map(function (e) { return e.title; }).join('; ')) + '</div>';
    html += '<div class="kps-muted">Видеата без дата излизат с оранжев сигнал „Няма дата" — сложи Due date и стъпките се попълват автоматично.</div>';
    if (rbox) rbox.innerHTML = html;
  } catch (e) { if (rbox) rbox.innerHTML = '<div class="kps-err">Грешка при създаване.</div>'; btns.forEach(function (b) { b.disabled = false; }); }
}
