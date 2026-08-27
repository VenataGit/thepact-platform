// ==================== КЛИЕНТ — ГРАФИК ====================
// Нова страница (Basecamp task 10243996705): същите карти като на Dashboard-а
// (всички Video Production дъски), но в един хронологичен списък по клиент —
// вместо разбити по дъска/колона. Филтър по клиент + по коя дата да гледаме
// (Due On за публикуване, или датата на конкретна производствена стъпка), плюс
// етикет на кой етап е видеото в момента (измисляне/заснемане/монтаж/акаунт).
//
// Данните идват directно от /api/bc-board + /api/bc-board/cards — както при
// Dashboard-а, само че тук зареждаме ВСИЧКИ (глобално разрешени) дъски наведнъж,
// без личните hidden/minimized предпочитания на дашборда (тази страница е отделен
// изглед, не филтрирана версия на дашборда).

var _csCards = [];              // плосък списък от всички активни карти, обогатени с board/stage
var _csFilter = { client: '', dateType: 'due' };

var CS_DATE_OPTS = [
  ['due',   'Due On (публикуване)'],
  ['idea',  'Дата за сценарий'],
  ['shoot', 'Дата за заснемане'],
  ['edit',  'Дата за монтаж'],
  ['upload','Дата за качване'],
];

var CS_STAGE_LABELS = { idea: 'Измисляне', shoot: 'Заснемане', edit: 'Монтаж', upload: 'При акаунт мениджъра', other: '—' };

function csStageOf(boardTitle) {
  var t = (boardTitle || '').toLowerCase();
  if (/pre[\s-]*produc|предпрод/.test(t)) return 'idea';
  if (/post[\s-]*produc|пост[\s-]*продук/.test(t)) return 'edit';
  if (/produc|продук/.test(t)) return 'shoot';
  if (/project\s*manage|проект\w*\s*мениджм|акаунт|account/.test(t)) return 'upload';
  return 'other';
}

async function renderClientSchedule(el) {
  setBreadcrumb(null);
  // Не full-width нарочно (Венци, 27.08.2026): "информацията да се събере малко
  // повече в центъра" — по-тесен, центриран стълб вместо да се разтяга по цялата
  // ширина на екрана.
  el.className = '';
  el.innerHTML =
    '<div class="cl-wrap cs-wrap">' +
      '<div class="cl-head">' +
        '<span class="cl-head__title">Клиент — график</span>' +
        '<button class="cl-refresh" onclick="csReload()" title="Обнови">↻</button>' +
      '</div>' +
      '<div class="cs-filters" id="csFilters"></div>' +
      '<div class="cs-list" id="csList"><div class="cl-loading">Зареждам от Basecamp…</div></div>' +
    '</div>';
  await csLoad();
}

function csReload() {
  var host = document.getElementById('csList');
  if (host) host.innerHTML = '<div class="cl-loading">Обновявам…</div>';
  csLoad();
}

async function csLoad() {
  var host = document.getElementById('csList');
  try {
    var structRes = await fetch('/api/bc-board');
    if (structRes.status === 401) { if (host) host.innerHTML = clientsAuthMsg(); return; }
    if (!structRes.ok) throw new Error('struct');
    var struct = await structRes.json();
    var boards = struct.boards || [];
    var cards = [];
    var i = 0;
    async function worker() {
      while (i < boards.length) {
        var b = boards[i++];
        try {
          var r = await fetch('/api/bc-board/cards?board=' + encodeURIComponent(b.id));
          if (!r.ok) continue;
          var data = await r.json();
          var colMeta = {};
          (b.columns || []).forEach(function (c) { colMeta[c.id] = c; });
          (data.columns || []).forEach(function (col) {
            var info = colMeta[col.id] || {};
            (col.cards || []).forEach(function (c) { cards.push(csEnrich(c, b, info, false)); });
            (col.onHoldCards || []).forEach(function (c) { cards.push(csEnrich(c, b, info, true)); });
          });
        } catch (e) { /* тази дъска пропада, останалите продължават */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, boards.length || 1) }, worker));
    _csCards = cards;
    if (typeof ensureClientNames === 'function') { try { await ensureClientNames(); } catch (e) {} }
    csRender();
  } catch (e) {
    if (host) host.innerHTML = '<div class="cl-err">Грешка при зареждане от Basecamp.</div>';
  }
}

function csEnrich(c, board, colInfo, onHold) {
  var out = Object.assign({}, c);
  out.boardTitle = board.title;
  out.column = colInfo.title || '';
  out.isDoneColumn = !!colInfo.isDone;
  out.isTriageColumn = !!colInfo.isTriage; // "Not now"
  out.onHold = onHold;
  out.stage = csStageOf(board.title);
  return out;
}

// Активна = не е завършена, не е в Done колона и не е в Not now (Венци, 27.08.2026:
// "Нека да пропуска задачите от Not now и Done").
function csActiveCards() {
  return _csCards.filter(function (c) { return !c.completed && !c.isDoneColumn && !c.isTriageColumn; });
}

function csClientVocab() { return dashClientVocab(csActiveCards()); }

function csDateValue(card, type) {
  if (type === 'due') return card.cardDueOn || card.dueOn || null;
  return (card.stageDates && card.stageDates[type]) || null;
}

function csVisibleCards() {
  var f = _csFilter;
  return csActiveCards().filter(function (c) {
    if (!f.client) return true;
    var name = dashCardClient(c.title, csClientVocab());
    return !!name && normClientName(name) === normClientName(f.client);
  });
}

function csSorted() {
  var type = _csFilter.dateType || 'due';
  var list = csVisibleCards().slice();
  list.sort(function (a, b) {
    var da = csDateValue(a, type), db = csDateValue(b, type);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? -1 : da > db ? 1 : 0;
  });
  return list;
}

function csSelect(key, label, placeholder, opts) {
  var cur = _csFilter[key] || '';
  var o = opts.map(function (pair) {
    var v = pair[0], t = pair[1];
    return '<option value="' + esc(String(v)) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(String(t)) + '</option>';
  }).join('');
  return '<label class="dash-filter-field cs-filter-field"><span class="dash-filter-lbl">' + esc(label) + '</span>' +
    '<select onchange="csSetFilter(\'' + key + '\', this.value)">' +
      (placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '') + o +
    '</select></label>';
}

function csFiltersHtml() {
  var clientOpts = csClientVocab().map(function (v) { return [v.name, v.name]; })
    .sort(function (a, b) { return dashClientCompare(a[0], b[0]); });
  return csSelect('client', 'Клиент', 'Всички клиенти', clientOpts) +
    csSelect('dateType', 'Подреди по дата', null, CS_DATE_OPTS);
}

function csSetFilter(key, val) {
  _csFilter[key] = val || '';
  csRender();
}

function csFmt(d) { if (!d) return ''; var s = d.split('T')[0].split('-'); return s[2] + '.' + s[1] + '.' + s[0]; }

function csStatus(card, dateVal) {
  if (card.onHold) return { cls: 'hold', text: 'на пауза' };
  if (!dateVal) return { cls: 'none', text: 'без дата' };
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var d = _parseDateMidnight(dateVal);
  var diff = Math.round((d - today) / 86400000);
  if (diff < 0) return { cls: 'over', text: 'просрочено · ' + csFmt(dateVal) };
  if (diff === 0) return { cls: 'today', text: 'днес' };
  if (diff <= 3) return { cls: 'soon', text: csFmt(dateVal) };
  return { cls: 'ok', text: csFmt(dateVal) };
}

// По-дебели, ясно разчленени "карти" вместо тънък ред (Венци, 27.08.2026: "ако трябва
// да станат малко по-дебели самите карти и да се вижда по-ясно клиента, името на
// видеото, дата, на какъв етап е"). Реда на четене: клиент + етап горе, заглавие в
// средата (най-едро), колона + дата долу.
function csRowHtml(card, showClient) {
  var dateVal = csDateValue(card, _csFilter.dateType || 'due');
  var st = csStatus(card, dateVal);
  var clientName = showClient ? dashCardClient(card.title, csClientVocab()) : null;
  return '<a class="cs-card cs-card--' + st.cls + '" href="' + esc(card.url || '#') + '" target="_blank" rel="noopener">' +
    '<div class="cs-card__top">' +
      (clientName ? '<span class="cs-card__client">' + esc(clientName) + '</span>' : '') +
      '<span class="cs-card__stage">' + esc(CS_STAGE_LABELS[card.stage] || '—') + '</span>' +
    '</div>' +
    '<div class="cs-card__title">' + esc(card.title || '') + '</div>' +
    '<div class="cs-card__bottom">' +
      (card.column ? '<span class="cs-card__col">' + esc(card.column) + '</span>' : '') +
      '<span class="cs-card__date cs-card__date--' + st.cls + '">' + esc(st.text) + '</span>' +
    '</div>' +
  '</a>';
}

function csRender() {
  var filt = document.getElementById('csFilters');
  if (filt) filt.innerHTML = csFiltersHtml();
  var host = document.getElementById('csList');
  if (!host) return;
  var list = csSorted();
  if (!list.length) { host.innerHTML = '<div class="cl-empty">Няма карти по този филтър.</div>'; return; }
  var showClient = !_csFilter.client;
  host.innerHTML = list.map(function (c) { return csRowHtml(c, showClient); }).join('');
}
