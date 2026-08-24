// ==================== ИСТОРИЯ (#/history) ====================
// Кой какво и кога е правил — на едно място, с таб за всяка дейност.
// Страницата е за целия екип (More → История). Единственото изключение е табът
// CRM: сървърът изобщо не го връща на хора без достъп до CRM инструмента.
//
// Само четене. Платформата води няколко отделни дневника (задачи, текст, КП,
// календар, карти, срокове, CRM); тук те се показват обединени или поотделно.
//
// Филтрите (период, човек, задача, търсене) се прилагат от СЪРВЪРА, не върху вече
// свалените редове — иначе „последните 24 часа" щеше да търси само в последните 60
// записа. Единственото изключение е филтърът по действие: той е от заредените,
// защото етикетите („Поръча задача…") се сглобяват тук, а не в базата.

var HIST_TABS = [
  { id: 'all', icon: '📜', label: 'Всичко',
    desc: 'Всички дейности, най-новото отгоре.' },
  { id: 'tasks', icon: '🧾', label: 'Задачи',
    desc: 'Кой какво е поръчал през <a href="#/create-task">Създаване на задачи</a>. Картата в Basecamp се създава от бота ThePactAlerts, затова истинският поръчител се вижда само тук.' },
  { id: 'text', icon: '✏️', label: 'Текст',
    desc: 'Смяната на текста на задачите в Basecamp — какъв е бил и с какво е заменен. Промяната се засича при синхрона (на 15 минути), затова се появява с малко закъснение. Снимките и видеата не се пазят — от тях остава само бележка, че ги е имало.' },
  { id: 'kp', icon: '📋', label: 'КП',
    desc: 'Контент планове: клиенти, създадени КП карти, коментари под тях. „Система" означава графика, а не човек.' },
  { id: 'calendar', icon: '📅', label: 'Календар',
    desc: 'Производственият календар: насрочване, местене и връщане на снимачните дни.' },
  { id: 'cards', icon: '🗂', label: 'Карти',
    desc: 'Картите в платформата: създаване, местене, промени по полета, отговорници и коментари.' },
  { id: 'dates', icon: '📆', label: 'Срокове',
    desc: 'Местените дати по картите — със старата и новата стойност. Тук влизат и датите в Basecamp: „Due on" на задачата и датите по стъпките ѝ. Промяната в Basecamp се засича при синхрона (на 15 минути), затова се появява с малко закъснение.' },
  { id: 'crm', icon: '💼', label: 'CRM',
    desc: 'Сделките в <a href="#/crm">CRM</a>: бележки, обаждания, срещи и смяна на етап. Вижда се само от хората с достъп до CRM.' },
];

var HIST_RANGES = [
  { id: '24h', label: 'Последните 24 часа' },
  { id: '7d', label: 'Последните 7 дни' },
  { id: '30d', label: 'Последните 30 дни' },
  { id: '90d', label: 'Последните 3 месеца' },
  { id: '365d', label: 'Последната година' },
  { id: 'all', label: 'Целият период' },
];

var _hist = {
  tab: 'all', range: 'all', who: '', card: '', q: '', action: '',
  limit: 60, items: [], hasMore: false,
  allowedTabs: null, people: [], cards: [],
};

// Ключ на записа (не индекс — при филтриране индексите се разместват) → разгънат ли е.
var _histTxtOpen = {};

// ------------------------------------------------------------------ страницата

async function renderHistory(el, tab) {
  setBreadcrumb([{ label: 'История', href: '#/history' }]);
  el.className = 'flush-top full-width';

  var t = HIST_TABS.some(function (x) { return x.id === tab; }) ? tab : 'all';
  _hist = {
    tab: t, range: 'all', who: '', card: '', q: '', action: '',
    limit: 60, items: [], hasMore: false,
    allowedTabs: _hist.allowedTabs, people: [], cards: [],
  };
  _histTxtOpen = {};

  el.innerHTML =
    '<div class="hst-wrap">' +
      '<div class="hst-head">' +
        '<h1 class="hst-head__t">📜 История</h1>' +
        '<div class="hst-head__s">Кой какво и кога е правил. Дневникът само показва вече записаното — тук нищо не се променя и не се трие.</div>' +
      '</div>' +
      '<div id="histTabs" class="hst-tabs"></div>' +
      '<div id="histAbout" class="hst-about"></div>' +
      '<div id="histFilters" class="hst-filters"></div>' +
      '<div id="histBody"><div class="hst-dim">Зареждане…</div></div>' +
    '</div>';

  histRenderTabs();
  await histLoadFilters();
  await histLoad();
}

function histRenderTabs() {
  var host = document.getElementById('histTabs');
  if (!host) return;
  // Докато сървърът не е казал кои табове са позволени, CRM стои скрит — по-скоро
  // да липсва за миг, отколкото да мигне пред човек без достъп.
  var allowed = _hist.allowedTabs;
  var tabs = HIST_TABS.filter(function (x) {
    if (x.id === 'all') return true;
    return allowed ? allowed.indexOf(x.id) >= 0 : x.id !== 'crm';
  });
  host.innerHTML = tabs.map(function (x) {
    return '<a class="hst-tab' + (x.id === _hist.tab ? ' hst-tab--on' : '') + '" ' +
      'href="#/history' + (x.id === 'all' ? '' : '/' + x.id) + '">' +
      '<span class="hst-tab__i">' + x.icon + '</span>' + esc(x.label) + '</a>';
  }).join('');

  var about = document.getElementById('histAbout');
  var cur = HIST_TABS.filter(function (x) { return x.id === _hist.tab; })[0];
  if (about && cur) about.innerHTML = cur.desc;
}

// ------------------------------------------------------------------- филтрите

function histRenderFilters() {
  var host = document.getElementById('histFilters');
  if (!host) return;

  var opt = function (value, label, sel) {
    return '<option value="' + esc(value) + '"' + (sel === value ? ' selected' : '') + '>' + esc(label) + '</option>';
  };

  // Действията идват от заредените редове — сървърът пази суровите кодове, а
  // четимите етикети се правят тук.
  var actions = [];
  var seen = {};
  (_hist.items || []).forEach(function (it) {
    if (it.action && !seen[it.action]) { seen[it.action] = 1; actions.push(it.action); }
  });
  actions.sort(function (a, b) { return String(a).localeCompare(String(b), 'bg'); });

  host.innerHTML =
    '<label class="hst-f">' +
      '<span class="hst-f__l">Период</span>' +
      '<select class="hst-f__c" onchange="histSet(\'range\', this.value)">' +
        HIST_RANGES.map(function (r) { return opt(r.id, r.label, _hist.range); }).join('') +
      '</select>' +
    '</label>' +
    '<label class="hst-f">' +
      '<span class="hst-f__l">Човек</span>' +
      '<select class="hst-f__c" onchange="histSet(\'who\', this.value)">' +
        opt('', 'Всички', _hist.who) +
        _hist.people.map(function (p) { return opt(p, p, _hist.who); }).join('') +
      '</select>' +
    '</label>' +
    '<label class="hst-f">' +
      '<span class="hst-f__l">Задача</span>' +
      '<input class="hst-f__c" list="histCardList" placeholder="Всички задачи" ' +
        'value="' + esc(_hist.card) + '" onchange="histSet(\'card\', this.value)">' +
      '<datalist id="histCardList">' +
        _hist.cards.map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join('') +
      '</datalist>' +
    '</label>' +
    '<label class="hst-f">' +
      '<span class="hst-f__l">Действие</span>' +
      '<select class="hst-f__c" onchange="histSetAction(this.value)">' +
        opt('', 'Всички', _hist.action) +
        actions.map(function (a) { return opt(a, a, _hist.action); }).join('') +
      '</select>' +
    '</label>' +
    '<label class="hst-f hst-f--grow">' +
      '<span class="hst-f__l">Търсене</span>' +
      '<input class="hst-f__c" id="histSearch" placeholder="Дума от заглавие, детайли или име…" ' +
        'value="' + esc(_hist.q) + '" onchange="histSet(\'q\', this.value)">' +
    '</label>' +
    '<div class="hst-f hst-f--btn">' +
      '<button class="ga-btn" onclick="histReset()">↺ Изчисти</button>' +
      '<button class="ga-btn" onclick="histLoad()">↻ Опресни</button>' +
    '</div>';
}

// Сървърните филтри искат ново теглене; филтърът по действие — само пречертаване.
function histSet(key, value) {
  _hist[key] = String(value == null ? '' : value).trim();
  _hist.limit = 60;
  _hist.action = '';
  // Само периодът стеснява менютата „Човек" и „Задача" — при другите филтри
  // списъците нарочно остават пълни, за да има на какво да се превключи.
  if (key === 'range') histLoadFilters();
  histLoad();
}

function histSetAction(value) {
  _hist.action = value || '';
  histRenderBody();
}

function histReset() {
  _hist.range = 'all'; _hist.who = ''; _hist.card = ''; _hist.q = ''; _hist.action = '';
  _hist.limit = 60;
  histLoadFilters();
  histLoad();
}

function histMore() {
  _hist.limit = Math.min(500, _hist.limit + 100);
  histLoad();
}

function _histQs(extra) {
  var p = [];
  p.push('tab=' + encodeURIComponent(_hist.tab));
  if (_hist.range && _hist.range !== 'all') p.push('range=' + encodeURIComponent(_hist.range));
  if (_hist.who) p.push('who=' + encodeURIComponent(_hist.who));
  if (_hist.card) p.push('card=' + encodeURIComponent(_hist.card));
  if (_hist.q) p.push('q=' + encodeURIComponent(_hist.q));
  return p.concat(extra || []).join('&');
}

// Кои табове са позволени + какво да предложат менютата „Човек" и „Задача".
async function histLoadFilters() {
  try {
    var res = await fetch('/api/history/filters?' + _histQs());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    _hist.allowedTabs = (data.tabs || []).map(function (t) { return t.id; });
    _hist.people = data.people || [];
    _hist.cards = data.cards || [];
  } catch (e) {
    _hist.people = []; _hist.cards = [];
  }
  histRenderTabs();
  histRenderFilters();
}

async function histLoad() {
  var host = document.getElementById('histBody');
  if (!host) return;
  host.innerHTML = '<div class="hst-dim">Зареждане…</div>';
  try {
    var res = await fetch('/api/history?' + _histQs(['limit=' + _hist.limit]));
    if (res.status === 403) {
      host.innerHTML = '<div class="hst-empty">🔒 Историята на CRM се вижда само от хората с достъп до CRM.</div>';
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    _hist.items = data.items || [];
    _hist.hasMore = !!data.hasMore;
    histRenderFilters(); // менюто „Действие" се пълни от заредените редове
    histRenderBody();
  } catch (e) {
    host.innerHTML = '<div class="hst-err">Грешка при зареждане: ' + esc(e.message) + '</div>';
  }
}

// ------------------------------------------------------------------ таблицата

function histRenderBody() {
  var host = document.getElementById('histBody');
  if (!host) return;

  var items = _hist.items.filter(function (it) {
    return !_hist.action || it.action === _hist.action;
  });

  if (!items.length) {
    var filtered = _hist.range !== 'all' || _hist.who || _hist.card || _hist.q || _hist.action;
    host.innerHTML = '<div class="hst-empty">' +
      (filtered ? 'Нищо не отговаря на филтрите. Разшири периода или изчисти търсенето.'
                : 'Още няма записана дейност тук.') + '</div>';
    return;
  }

  if (_hist.tab === 'text') { histRenderText(host, items); return; }

  var rows = items.map(function (it) {
    var what = esc(it.title || '');
    if (it.title && it.url) {
      what = '<a href="' + esc(it.url) + '"' +
        (/^https?:/.test(it.url) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(it.title) + '</a>';
    }
    return '<tr>' +
      '<td class="hst-when" title="' + esc(new Date(it.ts).toLocaleString('bg-BG')) + '">' + esc(histWhen(it.ts)) + '</td>' +
      '<td class="hst-who">' + esc(it.who || '—') + '</td>' +
      '<td><span class="hst-icon">' + (it.icon || '•') + '</span>' + esc(it.action || '') + '</td>' +
      '<td>' + (what || '<span class="hst-dim">—</span>') +
        (it.details ? '<span class="hst-det">' + esc(it.details) + '</span>' : '') + '</td>' +
    '</tr>';
  }).join('');

  host.innerHTML =
    '<div class="hst-tablewrap"><table class="tcl-table">' +
      '<thead><tr><th>Кога</th><th>Кой</th><th>Какво</th><th>Къде</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
    histFootHtml(items.length, 'записа');
}

function histFootHtml(shown, word) {
  return '<div class="hst-foot">' +
    '<span class="hst-dim">' + shown +
      (_hist.action && shown !== _hist.items.length ? ' от ' + _hist.items.length : '') +
      ' ' + word + '</span>' +
    (_hist.hasMore ? '<button class="btn btn-sm btn-ghost" onclick="histMore()">Покажи още</button>' : '') +
  '</div>';
}

function histWhen(ts) {
  var d = new Date(ts);
  var diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'сега';
  if (diff < 3600) return 'преди ' + Math.floor(diff / 60) + ' мин';
  var p = function (n) { return String(n).padStart(2, '0'); };
  var hm = p(d.getHours()) + ':' + p(d.getMinutes());
  if (d.toDateString() === new Date().toDateString()) return 'днес, ' + hm;
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ', ' + hm;
}

// ---------- таб „Текст": какъв е бил текстът и с какво е заменен ----------
// Записът идва от дневника bc_card_text_log (пълни се при снапшота на 15 мин).
// Показва се разликата по редове; целите текстове се разгъват по желание.

function histRenderText(host, items) {
  host.innerHTML =
    items.map(function (it) { return _histTxtCardHtml(it, it.key || String(it.ts)); }).join('') +
    histFootHtml(items.length, 'промени');
}

function _histTxtCardHtml(it, key) {
  var d = it.diff || { old: '', new: '' };
  var isTitle = d.field === 'title';
  var link = it.url
    ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a>'
    : esc(it.title);

  var bodyHtml;
  if (isTitle) {
    bodyHtml = '<div class="hst-ln hst-ln--del">' + (esc(d.old) || '&nbsp;') + '</div>' +
               '<div class="hst-ln hst-ln--add">' + (esc(d.new) || '&nbsp;') + '</div>';
  } else if (_histTxtOpen[key]) {
    bodyHtml =
      '<div class="hst-side"><div class="hst-side__h">Беше</div>' +
        '<pre class="hst-full">' + (esc(d.old) || '(празно)') + '</pre></div>' +
      '<div class="hst-side"><div class="hst-side__h">Стана</div>' +
        '<pre class="hst-full">' + (esc(d.new) || '(празно)') + '</pre></div>';
  } else {
    bodyHtml = _histTxtDiffHtml(d.old, d.new);
  }

  return '<div class="hst-txt">' +
    '<div class="hst-txt__hdr">' +
      '<span class="hst-txt__who">' + esc(it.who || '—') + '</span>' +
      '<span class="hst-txt__act">' + esc(it.action || '') + '</span>' +
      '<span class="hst-txt__card">' + link + '</span>' +
      '<span class="hst-txt__when">' + esc(histWhen(it.ts)) + '</span>' +
    '</div>' +
    '<div class="hst-txt__meta">' + esc(it.details || '') + '</div>' +
    '<div class="hst-txt__body' + (_histTxtOpen[key] && !isTitle ? ' hst-txt__body--split' : '') + '">' + bodyHtml + '</div>' +
    (isTitle ? '' :
      '<div class="hst-txt__foot">' +
        '<button class="ga-btn" onclick="histTxtToggle(&quot;' + esc(key) + '&quot;)">' +
          (_histTxtOpen[key] ? '↩ Само разликата' : '⤢ Целия текст') + '</button>' +
      '</div>') +
  '</div>';
}

function histTxtToggle(key) {
  _histTxtOpen[key] = !_histTxtOpen[key];
  histRenderBody();
}

// Разликата по редове (LCS). Текстовете са карти, не книги — при много дълъг
// текст сметката се пропуска и се показват направо двете версии.
function _histTxtDiff(oldText, newText) {
  var a = String(oldText || '').split('\n');
  var b = String(newText || '').split('\n');
  if (a.length > 400 || b.length > 400) return null;

  var m = a.length, n = b.length, i, j;
  var lcs = [];
  for (i = 0; i <= m; i++) lcs.push(new Array(n + 1).fill(0));
  for (i = m - 1; i >= 0; i--) {
    for (j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  var out = [];
  i = 0; j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ t: ' ', s: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ t: '-', s: a[i] }); i++; }
    else { out.push({ t: '+', s: b[j] }); j++; }
  }
  while (i < m) out.push({ t: '-', s: a[i++] });
  while (j < n) out.push({ t: '+', s: b[j++] });
  return out;
}

// Непроменените редове далеч от промяна се свиват — иначе една дребна поправка
// в дълъг КП текст се губи между стотина еднакви реда.
function _histTxtCollapse(rows, ctx) {
  var keep = rows.map(function () { return false; });
  rows.forEach(function (r, i) {
    if (r.t === ' ') return;
    for (var k = Math.max(0, i - ctx); k <= Math.min(rows.length - 1, i + ctx); k++) keep[k] = true;
  });
  var out = [], skipped = 0;
  rows.forEach(function (r, i) {
    if (keep[i]) {
      if (skipped) { out.push({ t: '…', s: skipped + ' непроменени реда' }); skipped = 0; }
      out.push(r);
    } else skipped++;
  });
  if (skipped) out.push({ t: '…', s: skipped + ' непроменени реда' });
  return out;
}

function _histTxtDiffHtml(oldText, newText) {
  var rows = _histTxtDiff(oldText, newText);
  if (!rows) {
    return '<div class="hst-note">Текстът е твърде дълъг за сравнение ред по ред — виж целите версии.</div>';
  }
  var changed = rows.filter(function (r) { return r.t !== ' '; }).length;
  if (!changed) return '<div class="hst-note">Няма разлика по редове (променено е само форматирането).</div>';

  return _histTxtCollapse(rows, 2).map(function (r) {
    if (r.t === '…') return '<div class="hst-ln hst-ln--skip">⋯ ' + esc(r.s) + '</div>';
    var cls = r.t === '+' ? ' hst-ln--add' : r.t === '-' ? ' hst-ln--del' : '';
    return '<div class="hst-ln' + cls + '">' + (esc(r.s) || '&nbsp;') + '</div>';
  }).join('');
}
