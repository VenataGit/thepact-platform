// ==================== СЪЗДАВАНЕ НА ЗАДАЧИ (#/create-task) ====================
// Инструмент в More, достъпен за всички. Две форми:
//   „Измисляне"       → карта в Pre-Production → Измисляне с шаблона на контент плана
//                        и избран брой видео секции.
//   „Единична задача" → карта в избрана дъска/колона със стъпките на системата;
//                        първата попълнена дата смята останалите, после човекът
//                        има пълен контрол (бутонът ↻ преизчислява от дадено поле).
// Картите се създават от бот профила ThePactAlerts — кой ги е поръчал се пази в
// платформата (Настройки → Създаване на задачи).
var _tcr = { init: null, tab: 'plan', busy: false };

async function renderTaskCreator(el) {
  setBreadcrumb([{ label: 'Създаване на задачи', href: '#/create-task' }]);
  el.className = 'flush-top';
  el.innerHTML =
    '<div class="home-content-box">' +
      '<div class="page-header" style="margin-bottom:20px">' +
        '<h1>🧾 Създаване на задачи</h1>' +
        '<div class="page-subtitle">Поръчай карта в Basecamp, без да отваряш Basecamp. Картата се създава от бот профила <strong>ThePactAlerts</strong>, а в платформата остава запис кой я е поръчал.</div>' +
      '</div>' +
      '<div id="tcrBody"><div style="color:var(--text-dim);font-size:13px">Зареждам дъските…</div></div>' +
    '</div>';

  try {
    var res = await fetch('/api/task-creator/init');
    var data = await res.json();
    if (!res.ok || data.error) { tcrBody('<div class="tcr-err">' + esc(data.error || 'Грешка при зареждане.') + '</div>'); return; }
    _tcr.init = data;
    tcrRender();
  } catch (e) { tcrBody('<div class="tcr-err">Няма връзка със сървъра.</div>'); }
}

function tcrBody(html) { var b = document.getElementById('tcrBody'); if (b) b.innerHTML = html; }

function tcrTab(tab) { _tcr.tab = tab; tcrRender(); }

function tcrRender() {
  var d = _tcr.init || {};
  var tabs =
    '<div class="tcr-tabs">' +
      '<button class="tcr-tab' + (_tcr.tab === 'plan' ? ' tcr-tab--on' : '') + '" onclick="tcrTab(\'plan\')">💡 Измисляне (контент план)</button>' +
      '<button class="tcr-tab' + (_tcr.tab === 'single' ? ' tcr-tab--on' : '') + '" onclick="tcrTab(\'single\')">🎬 Единична задача</button>' +
    '</div>';
  tcrBody(tabs + '<div id="tcrForm">' + (_tcr.tab === 'plan' ? tcrPlanForm(d) : tcrSingleForm(d)) + '</div><div id="tcrResult"></div>');
  if (_tcr.tab === 'single') tcrSyncColumns();
}

// ---------- Измисляне ----------

function tcrPlanForm(d) {
  if (!d.plan) {
    return '<div class="tcr-err">' + esc(d.planError || 'Не намерих дъската за задачите „Измисляне".') + '</div>';
  }
  var max = d.maxVideos || 30;
  var def = d.defaultVideos || 10;
  return '<div class="tcr-card">' +
    '<div class="tcr-dest">Задачата отива в <strong>' + esc(d.plan.boardTitle) + '</strong> → <strong>' + esc(d.plan.columnTitle) + '</strong></div>' +
    '<label class="tcr-field"><span class="tcr-label">Име на задачата</span>' +
      '<input type="text" id="tcrPlanTitle" class="tcr-input" maxlength="200" placeholder="напр. Fornetti КП-4"></label>' +
    '<div class="tcr-grid">' +
      '<label class="tcr-field"><span class="tcr-label">Краен срок (due date)</span>' +
        '<input type="date" id="tcrPlanDue" class="tcr-input"></label>' +
      '<label class="tcr-field"><span class="tcr-label">Колко видеа</span>' +
        '<input type="number" id="tcrPlanCount" class="tcr-input" min="1" max="' + max + '" value="' + def + '">' +
        '<span class="tcr-note">Толкова „Видео N" секции влизат в шаблона (макс. ' + max + ').</span></label>' +
    '</div>' +
    '<label class="tcr-field"><span class="tcr-label">Допълнителна информация</span>' +
      '<textarea id="tcrPlanExtra" class="tcr-input tcr-textarea" rows="5" placeholder="Всичко нужно допълнително — то влиза в самата задача."></textarea>' +
      '<span class="tcr-note">Влиза на реда „Допълнителна информация" в шаблона; ако го няма, се добавя най-отдолу.</span></label>' +
    '<button class="btn btn-primary tcr-btn" onclick="tcrCreatePlan()">Създай задачата</button>' +
  '</div>';
}

async function tcrCreatePlan() {
  if (_tcr.busy) return;
  var title = (document.getElementById('tcrPlanTitle') || {}).value || '';
  var due = (document.getElementById('tcrPlanDue') || {}).value || '';
  var count = parseInt((document.getElementById('tcrPlanCount') || {}).value, 10);
  if (!title.trim()) { tcrResult('<div class="tcr-err">Напиши име на задачата.</div>'); return; }
  await tcrPost('/api/task-creator/plan', {
    title: title, dueOn: due || null, videoCount: count,
    extraInfo: (document.getElementById('tcrPlanExtra') || {}).value || '',
  });
}

// ---------- Единична задача ----------

function tcrSingleForm(d) {
  var boards = d.boards || [];
  if (!boards.length) return '<div class="tcr-err">Не намерих дъски в Basecamp.</div>';
  var boardOpts = boards.map(function (b, i) {
    return '<option value="' + esc(b.id) + '"' + (i === 0 ? ' selected' : '') + '>' + esc(b.title) + '</option>';
  }).join('');
  // Датите вървят в реда на процеса: измисляне → заснемане → монтаж → насрочване →
  // публикуване. Стъпките идват вече подредени от сървъра, а „Дата за публикуване"
  // (Due date на картата) е последна, защото всичко останало се мери спрямо нея.
  var steps = d.steps || [];
  var dateRows = steps.map(function (s) {
    return tcrDateField(s.key, s.label || s.title,
      s.offset ? s.offset + ' работни дни преди публикуването' : 'в деня на публикуване');
  }).join('');
  dateRows += tcrDateField('publish', 'Дата за публикуване', 'Due date на картата — спрямо нея се смята всичко останало.');

  return '<div class="tcr-card">' +
    '<label class="tcr-field"><span class="tcr-label">Име на задачата</span>' +
      '<input type="text" id="tcrTitle" class="tcr-input" maxlength="200" placeholder="напр. Fornetti - Видео 3 - Заглавие"></label>' +
    '<label class="tcr-field"><span class="tcr-label">Описание</span>' +
      '<textarea id="tcrContent" class="tcr-input tcr-textarea" rows="10">' + esc(d.singleTemplate || '') + '</textarea>' +
      '<span class="tcr-note">Шаблонът е попълнен предварително — замени ХХХ-тата. Ако не ти трябва, изтрий го.</span></label>' +
    '<div class="tcr-grid">' +
      '<label class="tcr-field"><span class="tcr-label">Дъска</span>' +
        '<select id="tcrBoard" class="tcr-input" onchange="tcrSyncColumns()">' + boardOpts + '</select></label>' +
      '<label class="tcr-field"><span class="tcr-label">Колона</span>' +
        '<select id="tcrColumn" class="tcr-input"></select></label>' +
    '</div>' +
    '<div class="tcr-sub">Срокове</div>' +
    '<div class="tcr-hint">Попълни само една дата — останалите се смятат по системата (работни дни, без празници). После можеш да смениш всяка от тях; ↻ преизчислява останалите по избраната дата.</div>' +
    '<div class="tcr-grid">' + dateRows + '</div>' +
    '<button class="btn btn-primary tcr-btn" onclick="tcrCreateSingle()">Създай задачата</button>' +
  '</div>';
}

function tcrDateField(key, label, note) {
  return '<label class="tcr-field"><span class="tcr-label">' + esc(label) + '</span>' +
    '<span class="tcr-daterow">' +
      '<input type="date" class="tcr-input" id="tcrDate_' + esc(key) + '" onchange="tcrDateChanged(\'' + esc(key) + '\')">' +
      '<button type="button" class="tcr-recalc" title="Преизчисли останалите дати по тази" onclick="tcrRecalc(\'' + esc(key) + '\')">↻</button>' +
    '</span>' +
    '<span class="tcr-note">' + esc(note) + '</span></label>';
}

function tcrSyncColumns() {
  var bSel = document.getElementById('tcrBoard');
  var cSel = document.getElementById('tcrColumn');
  if (!bSel || !cSel) return;
  var board = ((_tcr.init || {}).boards || []).find(function (b) { return String(b.id) === String(bSel.value); });
  var cols = (board && board.columns) || [];
  cSel.innerHTML = cols.map(function (c, i) {
    return '<option value="' + esc(c.id) + '"' + (i === 0 ? ' selected' : '') + '>' + esc(c.title) + (c.isDone ? ' (Done)' : '') + '</option>';
  }).join('') || '<option value="">— няма колони —</option>';
}

function tcrDateFields() {
  var keys = ['publish'];
  ((_tcr.init || {}).steps || []).forEach(function (s) { keys.push(s.key); });
  return keys;
}

// Първата попълнена дата автоматично попълва останалите. Ако вече има други дати,
// не пипаме нищо — човекът е поел контрола.
function tcrDateChanged(field) {
  var others = tcrDateFields().filter(function (k) { return k !== field; });
  var anyFilled = others.some(function (k) { var el = document.getElementById('tcrDate_' + k); return el && el.value; });
  if (anyFilled) return;
  tcrRecalc(field);
}

async function tcrRecalc(field) {
  var src = document.getElementById('tcrDate_' + field);
  if (!src || !src.value) return;
  try {
    var res = await fetch('/api/task-creator/dates?field=' + encodeURIComponent(field) + '&date=' + encodeURIComponent(src.value));
    var data = await res.json();
    if (!res.ok || data.error) return;
    var pub = document.getElementById('tcrDate_publish');
    if (pub && field !== 'publish') pub.value = data.publish || '';
    Object.keys(data.steps || {}).forEach(function (k) {
      if (k === field) return;
      var el = document.getElementById('tcrDate_' + k);
      if (el) el.value = data.steps[k] || '';
    });
  } catch (e) { /* без дати работи, само не се смятат сами */ }
}

async function tcrCreateSingle() {
  if (_tcr.busy) return;
  var title = (document.getElementById('tcrTitle') || {}).value || '';
  if (!title.trim()) { tcrResult('<div class="tcr-err">Напиши име на задачата.</div>'); return; }
  var boardId = (document.getElementById('tcrBoard') || {}).value || '';
  var columnId = (document.getElementById('tcrColumn') || {}).value || '';
  if (!columnId) { tcrResult('<div class="tcr-err">Избери колона.</div>'); return; }
  var stepDates = {};
  ((_tcr.init || {}).steps || []).forEach(function (s) {
    var el = document.getElementById('tcrDate_' + s.key);
    if (el && el.value) stepDates[s.key] = el.value;
  });
  var due = (document.getElementById('tcrDate_publish') || {}).value || '';
  await tcrPost('/api/task-creator/single', {
    title: title,
    content: (document.getElementById('tcrContent') || {}).value || '',
    boardId: boardId, columnId: columnId,
    dueOn: due || null, stepDates: stepDates,
  });
}

// ---------- общо ----------

function tcrResult(html) { var r = document.getElementById('tcrResult'); if (r) r.innerHTML = html; }

async function tcrPost(url, body) {
  _tcr.busy = true;
  var btns = Array.prototype.slice.call(document.querySelectorAll('.tcr-btn'));
  btns.forEach(function (b) { b.disabled = true; });
  tcrResult('<div class="tcr-muted">Създавам картата в Basecamp…</div>');
  try {
    var res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var data = await res.json();
    if (!res.ok || data.error) { tcrResult('<div class="tcr-err">' + esc(data.error || 'Грешка при създаване.') + '</div>'); return; }
    var html = '<div class="tcr-ok">✓ Готово — <strong>' + esc(data.title) + '</strong> е в „' + esc(data.column) + '" (' + esc(data.board) + ').' +
      (data.url ? ' <a href="' + esc(data.url) + '" target="_blank" rel="noopener">Отвори картата →</a>' : '') + '</div>';
    if (data.videoCount) html += '<div class="tcr-muted">Шаблонът е с ' + data.videoCount + ' видео секции.</div>';
    if (data.stepErrors && data.stepErrors.length) {
      html += '<div class="tcr-err">Тези стъпки не се създадоха: ' + esc(data.stepErrors.join(', ')) + '</div>';
    }
    tcrResult(html);
    if (typeof showToast === 'function') showToast('Задачата е създадена в Basecamp.', 'success');
    tcrClearForm();
  } catch (e) {
    tcrResult('<div class="tcr-err">Грешка при създаване.</div>');
  } finally {
    _tcr.busy = false;
    btns.forEach(function (b) { b.disabled = false; });
  }
}

// Изчистваме само текстовите полета — дъската/колоната и датите остават, за да може
// човек да пусне няколко задачи една след друга. Описанието се връща на шаблона,
// не на празно, защото следващата задача пак тръгва от него.
function tcrClearForm() {
  ['tcrPlanTitle', 'tcrTitle', 'tcrPlanExtra'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var content = document.getElementById('tcrContent');
  if (content) content.value = (_tcr.init || {}).singleTemplate || '';
}
