// ==================== КП → задачи ("Създай задачи по КП") ====================
// Modal: pick a Pre-Production content-plan card + destination board → preview the
// videos that will be created → create them in the board's "Разпределение" column.
var _kps = { init: null };

async function showKpSplit() {
  if (typeof closeAllDropdowns === 'function') closeAllDropdowns();
  document.querySelectorAll('.kps-overlay').forEach(function (o) { o.remove(); });
  var ov = document.createElement('div');
  ov.className = 'modal-overlay kps-overlay';
  ov.innerHTML =
    '<div class="kps-modal">' +
      '<div class="kps-modal__hdr"><strong>Създай задачи по КП</strong>' +
        '<button class="kps-close" aria-label="Затвори">✕</button></div>' +
      '<div class="kps-modal__body" id="kpsBody"><div class="kps-muted">Зареждам контент плановете…</div></div>' +
    '</div>';
  document.body.appendChild(ov);
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
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

function kpsClearPreview() { var b = document.getElementById('kpsPreview'); if (b) b.innerHTML = ''; _kps.cardId = null; }

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
    var rows = data.videos.map(function (v) {
      return '<li><div class="kps-vtitle">' + esc(v.cardTitle) + '</div>' + (v.snippet ? '<div class="kps-vsnip">' + esc(v.snippet) + '…</div>' : '') + '</li>';
    }).join('');
    box.innerHTML =
      '<div class="kps-preview">' +
        '<div class="kps-preview__hdr">Ще се създадат <b>' + data.count + '</b> задачи' + (data.truncated ? ' (ограничено)' : '') + ':</div>' +
        '<ol class="kps-vlist">' + rows + '</ol>' +
        '<button class="btn btn-primary kps-btn" onclick="kpsCreate()">Създай ' + data.count + ' задачи</button>' +
        '<div id="kpsResult"></div>' +
      '</div>';
  } catch (e) { box.innerHTML = '<div class="kps-err">Грешка при преглед.</div>'; }
}

async function kpsCreate() {
  var cardId = _kps.cardId; // the plan that was actually previewed
  var destEl = document.querySelector('input[name="kpsDest"]:checked');
  var destBoardId = destEl && destEl.value;
  if (!cardId || !destBoardId) return;
  var rbox = document.getElementById('kpsResult');
  var btns = Array.prototype.slice.call(document.querySelectorAll('.kps-btn'));
  btns.forEach(function (b) { b.disabled = true; });
  if (rbox) rbox.innerHTML = '<div class="kps-muted">Създавам задачите в Basecamp… (не затваряй прозореца)</div>';
  try {
    var res = await fetch('/api/kp-split/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardId: cardId, destBoardId: destBoardId }) });
    var data = await res.json();
    if (!res.ok || data.error) { if (rbox) rbox.innerHTML = '<div class="kps-err">' + esc(data.error || 'Грешка.') + '</div>'; btns.forEach(function (b) { b.disabled = false; }); return; }
    var ok = (data.created || []).length, errs = (data.errors || []), skip = (data.skipped || []);
    var html = '<div class="kps-ok">✓ Създадени <b>' + ok + '</b> задачи в „' + esc(data.column || 'Разпределение') + '" (' + esc(data.board || '') + ').</div>';
    if (skip.length) html += '<div class="kps-muted">Пропуснати ' + skip.length + ' (вече съществуват със същото заглавие).</div>';
    if (data.truncated) html += '<div class="kps-muted">⚠ Планът има повече видеа от лимита — създадени са само първите.</div>';
    if (errs.length) html += '<div class="kps-err">' + errs.length + ' неуспешни: ' + esc(errs.map(function (e) { return e.title; }).join('; ')) + '</div>';
    html += '<div class="kps-muted">Картите излизат с оранжев сигнал „Няма дата" — сложи Due date и стъпките ще се попълнят автоматично.</div>';
    if (rbox) rbox.innerHTML = html;
  } catch (e) { if (rbox) rbox.innerHTML = '<div class="kps-err">Грешка при създаване.</div>'; btns.forEach(function (b) { b.disabled = false; }); }
}
