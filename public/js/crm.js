// ==================== CRM (#/crm) ====================
// Собственият ни инструмент за придобиване на клиенти. Вижда се само от хора с
// поименен достъп (виж /api/crm/me) — затова точката в More се показва условно.
//
// Три изгледа: Фуния (kanban с влачене), Списък (сортируема таблица) и Показатели.
// Навсякъде се набива на очи едно и също: коя сделка чака действие ДНЕС.
//
// Всичко около една сделка е ПЪЛНА СТРАНИЦА, не изскачащо прозорче:
//   #/crm       — фунията / списъкът / показателите
//   #/crm/new   — нова сделка
//   #/crm/12    — сделката с хронологията ѝ
// Диалог остава само за краткото питане (причина за загуба, достъп, етапи,
// избор на дъска в Basecamp) — там цяла страница само би пречила.
var _crm = {
  data: null, view: 'funnel', busy: false, dragId: null,
  filterOwner: '', search: '', showArchived: false, sort: 'next',
};

async function renderCrm(el) {
  // Стар линк от известие (#/crm?deal=12) → новата страница на сделката.
  var old = (location.hash || '').match(/[?&]deal=(\d+)/);
  if (old) { location.hash = '#/crm/' + old[1]; return; }

  setBreadcrumb([{ label: 'CRM', href: '#/crm' }]);
  el.className = 'flush-top full-width';
  el.innerHTML =
    '<div class="crm-wrap">' +
      '<div class="crm-head">' +
        '<h1 class="crm-head__t">🤝 CRM — придобиване на клиенти</h1>' +
        '<div class="crm-head__s">Фунията ни от първи контакт до подписан клиент. Всяка сделка има отговорник и <strong>насрочена следваща стъпка</strong> — сделка без следваща стъпка е забравена сделка.</div>' +
      '</div>' +
      '<div id="crmBody"><div class="crm-dim">Зареждам…</div></div>' +
    '</div>';
  await crmLoad();
}

function crmGoDeal(id) { location.hash = '#/crm/' + id; }

function crmBody(html) { var b = document.getElementById('crmBody'); if (b) b.innerHTML = html; }

async function crmLoad() {
  try {
    var res = await fetch('/api/crm/board' + (_crm.showArchived ? '?archived=1' : ''));
    var data = await res.json();
    if (res.status === 403) { crmBody('<div class="crm-err">' + esc(data.error || 'Нямаш достъп.') + '</div>'); return; }
    if (!res.ok || data.error) { crmBody('<div class="crm-err">' + esc(data.error || 'Грешка при зареждане.') + '</div>'); return; }
    _crm.data = data;
    crmRender();
  } catch (e) { crmBody('<div class="crm-err">Няма връзка със сървъра.</div>'); }
}

// ---------- помощни ----------

function crmMoney(v) {
  var n = Number(v) || 0;
  return n.toLocaleString('bg-BG', { maximumFractionDigits: 0 }) + ' лв.';
}
function crmToday() { return new Date().toISOString().slice(0, 10); }
function crmDay(d) { return d ? String(d).slice(0, 10) : ''; }
function crmStage(id) { return ((_crm.data && _crm.data.stages) || []).find(function (s) { return Number(s.id) === Number(id); }); }
function crmDeal(id) { return ((_crm.data && _crm.data.deals) || []).find(function (d) { return Number(d.id) === Number(id); }); }

// Сигналите за една сделка — същите правила като на сървъра (services/crm.js).
function crmHealth(d) {
  var st = crmStage(d.stage_id);
  var open = d.status === 'open';
  var since = new Date(d.stage_since || d.created_at).getTime();
  var days = isNaN(since) ? 0 : Math.max(0, Math.floor((Date.now() - since) / 86400000));
  var rot = st ? Number(st.rot_days) || 0 : 0;
  var next = crmDay(d.next_step_at);
  var today = crmToday();
  return {
    daysInStage: days,
    rotting: open && rot > 0 && days > rot,
    overdue: open && !!next && next < today,
    dueToday: open && !!next && next === today,
    noNext: open && !next,
  };
}

function crmVisibleDeals() {
  var list = ((_crm.data && _crm.data.deals) || []).slice();
  if (_crm.filterOwner) list = list.filter(function (d) { return String(d.owner_id || '') === _crm.filterOwner; });
  if (_crm.search) {
    var q = _crm.search.toLowerCase();
    list = list.filter(function (d) {
      return (d.title || '').toLowerCase().indexOf(q) >= 0 ||
             (d.company || '').toLowerCase().indexOf(q) >= 0 ||
             (d.contact_name || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  return list;
}

// ---------- екранът ----------

function crmRender() {
  var d = _crm.data || {};
  var m = d.metrics || {};
  var att = m.needAttention || {};
  var attTotal = (att.overdue || 0) + (att.rotting || 0) + (att.noNext || 0);

  var kpis = [
    { label: 'Активни сделки', value: m.openCount || 0, hint: 'в движение точно сега' },
    { label: 'Стойност на фунията', value: crmMoney(m.pipelineValue), hint: 'сборът на всички активни' },
    { label: 'Претеглена прогноза', value: crmMoney(m.weighted), hint: 'по вероятността на етапа — това е реалистичното число' },
    { label: 'Спечелени (' + (m.windowDays || 30) + 'дн.)', value: (m.wonRecentCount || 0) + ' · ' + crmMoney(m.wonRecentValue), hint: 'затворени успешно напоследък' },
    { label: 'Успеваемост', value: m.winRate == null ? '—' : m.winRate + '%', hint: 'спечелени от всички затворени' },
    { label: 'Средно до „да"', value: m.avgDaysToWin == null ? '—' : m.avgDaysToWin + ' дни', hint: 'от създаване до спечелване' },
  ].map(function (k) {
    return '<div class="crm-kpi" title="' + esc(k.hint) + '">' +
      '<div class="crm-kpi__v">' + esc(String(k.value)) + '</div>' +
      '<div class="crm-kpi__l">' + esc(k.label) + '</div></div>';
  }).join('');

  var owners = (d.users || []).map(function (u) {
    return '<option value="' + u.id + '"' + (String(u.id) === _crm.filterOwner ? ' selected' : '') + '>' + esc(u.name) + '</option>';
  }).join('');

  var canGrant = d.access && d.access.canGrant;
  var isAdmin = d.access && d.access.isAdmin;

  var toolbar =
    '<div class="crm-toolbar">' +
      '<div class="crm-tabs">' +
        '<button class="crm-tab' + (_crm.view === 'funnel' ? ' crm-tab--on' : '') + '" onclick="crmView(\'funnel\')">Фуния</button>' +
        '<button class="crm-tab' + (_crm.view === 'list' ? ' crm-tab--on' : '') + '" onclick="crmView(\'list\')">Списък</button>' +
        '<button class="crm-tab' + (_crm.view === 'stats' ? ' crm-tab--on' : '') + '" onclick="crmView(\'stats\')">Показатели</button>' +
      '</div>' +
      '<input type="search" class="crm-input crm-search" id="crmSearch" placeholder="Търси сделка, фирма, контакт…" value="' + esc(_crm.search) + '" oninput="crmSearchInput(this.value)">' +
      '<select class="crm-input crm-sel" onchange="crmFilterOwner(this.value)"><option value="">Всички отговорници</option>' + owners + '</select>' +
      '<label class="crm-check"><input type="checkbox"' + (_crm.showArchived ? ' checked' : '') + ' onchange="crmToggleArchived(this.checked)"> архивирани</label>' +
      '<span class="crm-spacer"></span>' +
      (canGrant ? '<button class="btn btn-ghost btn-sm" onclick="crmOpenAccess()">Достъп</button>' : '') +
      (isAdmin ? '<button class="btn btn-ghost btn-sm" onclick="crmOpenStages()">Етапи</button>' : '') +
      '<a class="btn btn-primary btn-sm" href="#/crm/new">+ Нова сделка</a>' +
    '</div>';

  var attention = attTotal
    ? '<div class="crm-attention">⚠ Чакат те: ' +
        (att.overdue ? '<button class="crm-att__b crm-att__b--red" onclick="crmView(\'list\');crmSort(\'next\')">' + att.overdue + ' просрочена стъпка</button>' : '') +
        (att.rotting ? '<button class="crm-att__b crm-att__b--orange" onclick="crmView(\'list\');crmSort(\'stale\')">' + att.rotting + ' застояли</button>' : '') +
        (att.noNext ? '<button class="crm-att__b" onclick="crmView(\'list\');crmSort(\'nonext\')">' + att.noNext + ' без следваща стъпка</button>' : '') +
      '</div>'
    : '<div class="crm-attention crm-attention--ok">✓ Всяка активна сделка има насрочена следваща стъпка.</div>';

  var view = _crm.view === 'list' ? crmListView() : _crm.view === 'stats' ? crmStatsView() : crmFunnelView();
  crmBody('<div class="crm-kpis">' + kpis + '</div>' + toolbar + attention + '<div id="crmView">' + view + '</div>');
}

function crmView(v) { _crm.view = v; crmRender(); }
function crmFilterOwner(v) { _crm.filterOwner = v; crmRender(); }
function crmSort(s) { _crm.sort = s; if (_crm.view === 'list') crmRender(); }
function crmToggleArchived(v) { _crm.showArchived = v; crmLoad(); }
var _crmSearchT = null;
function crmSearchInput(v) {
  _crm.search = v;
  clearTimeout(_crmSearchT);
  _crmSearchT = setTimeout(function () {
    var box = document.getElementById('crmView');
    if (box) box.innerHTML = _crm.view === 'list' ? crmListView() : _crm.view === 'stats' ? crmStatsView() : crmFunnelView();
  }, 150);
}

// ---------- изглед „Фуния" ----------

function crmFunnelView() {
  var stages = (_crm.data && _crm.data.stages) || [];
  var deals = crmVisibleDeals();
  if (!stages.length) return '<div class="crm-err">Няма етапи. Админ може да ги зададе от бутона „Етапи".</div>';

  return '<div class="crm-board">' + stages.map(function (s) {
    var mine = deals.filter(function (d) { return Number(d.stage_id) === Number(s.id); });
    var sum = mine.reduce(function (a, d) { return a + (Number(d.value) || 0); }, 0);
    var color = s.color || 'var(--border)';
    return '<div class="crm-col" data-stage="' + s.id + '" ondragover="crmDragOver(event)" ondragleave="crmDragLeave(event)" ondrop="crmDrop(event,' + s.id + ')">' +
      '<div class="crm-col__head" style="border-top:3px solid ' + esc(color) + '">' +
        '<div class="crm-col__title">' + esc(s.title) + '<span class="crm-col__n">' + mine.length + '</span></div>' +
        '<div class="crm-col__sum">' + crmMoney(sum) + (s.kind === 'open' && s.probability ? ' · ' + s.probability + '%' : '') + '</div>' +
        (s.exit_rule ? '<div class="crm-col__rule" title="' + esc(s.exit_rule) + '">' + esc(s.exit_rule) + '</div>' : '') +
      '</div>' +
      '<div class="crm-col__body">' + (mine.length ? mine.map(crmDealCard).join('') : '<div class="crm-col__empty">— празно —</div>') + '</div>' +
    '</div>';
  }).join('') + '</div>';
}

function crmDealCard(d) {
  var h = crmHealth(d);
  var badges = '';
  if (h.overdue) badges += '<span class="crm-b crm-b--red">просрочена</span>';
  else if (h.dueToday) badges += '<span class="crm-b crm-b--yellow">днес</span>';
  if (h.rotting) badges += '<span class="crm-b crm-b--orange">' + h.daysInStage + ' дни</span>';
  if (h.noNext) badges += '<span class="crm-b crm-b--dim">без стъпка</span>';
  if (d.bc_card_id) badges += '<span class="crm-b crm-b--blue">Basecamp</span>';
  if (d.archived) badges += '<span class="crm-b crm-b--dim">архив</span>';

  var av = d.owner_id
    ? '<span class="crm-av" style="background:' + (d.owner_avatar ? 'none' : _avColor(d.owner_name || '')) + '" title="' + esc(d.owner_name || '') + '">' + _avInner(d.owner_name || '', d.owner_avatar) + '</span>'
    : '<span class="crm-av crm-av--none" title="Без отговорник">?</span>';

  return '<div class="crm-deal' + (h.overdue ? ' crm-deal--overdue' : h.rotting ? ' crm-deal--rot' : '') + '"' +
      ' draggable="true" ondragstart="crmDragStart(event,' + d.id + ')" ondragend="crmDragEnd(event)"' +
      ' onclick="crmGoDeal(' + d.id + ')">' +
    '<div class="crm-deal__row">' +
      '<span class="crm-deal__co">' + esc(d.company || '—') + '</span>' +
      '<span class="crm-deal__val">' + crmMoney(d.value) + (d.recurring ? '/мес' : '') + '</span>' +
    '</div>' +
    '<div class="crm-deal__title">' + esc(d.title) + '</div>' +
    (d.next_step
      ? '<div class="crm-deal__next' + (h.overdue ? ' crm-deal__next--red' : h.dueToday ? ' crm-deal__next--yellow' : '') + '">→ ' + esc(d.next_step) + (d.next_step_at ? ' · ' + formatDate(crmDay(d.next_step_at)) : '') + '</div>'
      : '') +
    '<div class="crm-deal__foot">' + av + '<span class="crm-deal__badges">' + badges + '</span></div>' +
  '</div>';
}

// ---------- влачене ----------

function crmDragStart(e, id) { _crm.dragId = id; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(id)); } catch (x) {} }
function crmDragEnd() { _crm.dragId = null; document.querySelectorAll('.crm-col--over').forEach(function (c) { c.classList.remove('crm-col--over'); }); }
function crmDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; var c = e.currentTarget; if (c) c.classList.add('crm-col--over'); }
function crmDragLeave(e) { var c = e.currentTarget; if (c && !c.contains(e.relatedTarget)) c.classList.remove('crm-col--over'); }

async function crmDrop(e, stageId) {
  e.preventDefault();
  document.querySelectorAll('.crm-col--over').forEach(function (c) { c.classList.remove('crm-col--over'); });
  var id = _crm.dragId || parseInt(e.dataTransfer.getData('text/plain'), 10);
  _crm.dragId = null;
  if (!id) return;
  var deal = crmDeal(id);
  if (!deal || Number(deal.stage_id) === Number(stageId)) return;
  var st = crmStage(stageId);
  if (st && st.kind === 'lost') { crmAskLostReason(id, stageId); return; }
  await crmMove(id, stageId, '');
}

async function crmMove(id, stageId, lostReason) {
  try {
    var res = await fetch('/api/crm/deals/' + id + '/move', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId: stageId, lost_reason: lostReason || '' }),
    });
    var data = await res.json();
    if (!res.ok || data.error) { showToast(data.error || 'Не стана.', 'error'); return; }
    await crmLoad();
    var st = crmStage(stageId);
    if (st && st.kind === 'won') showToast('🎉 Сделката е спечелена! Можеш да ѝ направиш карта в Basecamp.', 'success');
  } catch (e) { showToast('Грешка при местенето.', 'error'); }
}

function crmAskLostReason(id, stageId) {
  crmModal('Защо е загубена?',
    '<label class="crm-field"><span class="crm-label">Причина (кратко — това е златото за следващата оферта)</span>' +
      '<input type="text" class="crm-input" id="crmLostReason" maxlength="200" placeholder="напр. цена / избраха друг / замълчаха"></label>',
    '<button class="btn btn-ghost btn-sm" onclick="crmCloseModal()">Отказ</button>' +
    '<button class="btn btn-sm" onclick="crmConfirmLost(' + id + ',' + stageId + ')">Запиши</button>');
  setTimeout(function () { var i = document.getElementById('crmLostReason'); if (i) i.focus(); }, 50);
}
async function crmConfirmLost(id, stageId) {
  var r = (document.getElementById('crmLostReason') || {}).value || '';
  crmCloseModal();
  await crmMove(id, stageId, r);
  if (location.hash.indexOf('#/crm/') === 0) crmReloadDeal(id);
}

// ---------- изглед „Списък" ----------

function crmListView() {
  var deals = crmVisibleDeals();
  var sorters = {
    next: function (a, b) { return (crmDay(a.next_step_at) || '9999') .localeCompare(crmDay(b.next_step_at) || '9999'); },
    stale: function (a, b) { return crmHealth(b).daysInStage - crmHealth(a).daysInStage; },
    nonext: function (a, b) { return (crmHealth(b).noNext ? 1 : 0) - (crmHealth(a).noNext ? 1 : 0); },
    value: function (a, b) { return (Number(b.value) || 0) - (Number(a.value) || 0); },
  };
  deals = deals.slice().sort(sorters[_crm.sort] || sorters.next);
  if (!deals.length) return '<div class="crm-empty">Няма сделки. Започни с „+ Нова сделка".</div>';

  var rows = deals.map(function (d) {
    var h = crmHealth(d);
    var st = crmStage(d.stage_id);
    return '<tr class="crm-tr" onclick="crmGoDeal(' + d.id + ')">' +
      '<td><div class="crm-td__t">' + esc(d.title) + '</div><div class="crm-td__s">' + esc(d.company || '') + (d.contact_name ? ' · ' + esc(d.contact_name) : '') + '</div></td>' +
      '<td><span class="crm-pill" style="border-color:' + esc((st && st.color) || 'var(--border)') + '">' + esc((st && st.title) || '—') + '</span></td>' +
      '<td class="crm-num">' + crmMoney(d.value) + (d.recurring ? '<span class="crm-td__s">/месец</span>' : '') + '</td>' +
      '<td>' + esc(d.owner_name || '—') + '</td>' +
      '<td class="' + (h.overdue ? 'crm-red' : h.dueToday ? 'crm-yellow' : '') + '">' +
        (d.next_step ? esc(d.next_step) + (d.next_step_at ? '<div class="crm-td__s">' + formatDate(crmDay(d.next_step_at)) + '</div>' : '') : '<span class="crm-dim">— няма —</span>') +
      '</td>' +
      '<td class="' + (h.rotting ? 'crm-orange' : '') + '">' + h.daysInStage + ' дни</td>' +
    '</tr>';
  }).join('');

  var sortBtn = function (key, label) {
    return '<button class="crm-sortb' + (_crm.sort === key ? ' crm-sortb--on' : '') + '" onclick="crmSort(\'' + key + '\')">' + label + '</button>';
  };
  return '<div class="crm-sorts">Подреди по: ' + sortBtn('next', 'следваща стъпка') + sortBtn('stale', 'застояване') + sortBtn('value', 'стойност') + sortBtn('nonext', 'без стъпка') + '</div>' +
    '<div class="crm-tablewrap"><table class="crm-table">' +
      '<thead><tr><th>Сделка</th><th>Етап</th><th>Стойност</th><th>Отговорник</th><th>Следваща стъпка</th><th>В етапа</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
}

// ---------- изглед „Показатели" ----------

function crmStatsView() {
  var d = _crm.data || {};
  var f = d.funnel || [];
  var deals = (d.deals || []).filter(function (x) { return !x.archived; });
  var maxN = Math.max.apply(null, [1].concat(f.map(function (s) { return s.count; })));

  var bars = f.map(function (s) {
    var w = Math.round((s.count / maxN) * 100);
    var st = crmStage(s.id);
    return '<div class="crm-fun__row">' +
      '<div class="crm-fun__lbl">' + esc(s.title) + '</div>' +
      '<div class="crm-fun__bar"><div class="crm-fun__fill" style="width:' + w + '%;background:' + esc((st && st.color) || 'var(--accent)') + '"></div></div>' +
      '<div class="crm-fun__n">' + s.count + ' · ' + crmMoney(s.value) + '</div>' +
    '</div>';
  }).join('');

  // Откъде идват клиентите и колко от тях се затварят — това решава къде отива времето.
  var bySource = {};
  deals.forEach(function (x) {
    var k = (x.source || '').trim() || 'без източник';
    if (!bySource[k]) bySource[k] = { n: 0, won: 0, lost: 0, value: 0 };
    bySource[k].n++;
    if (x.status === 'won') { bySource[k].won++; bySource[k].value += Number(x.value) || 0; }
    if (x.status === 'lost') bySource[k].lost++;
  });
  var srcRows = Object.keys(bySource).sort(function (a, b) { return bySource[b].n - bySource[a].n; }).map(function (k) {
    var s = bySource[k];
    var closed = s.won + s.lost;
    return '<tr><td>' + esc(k) + '</td><td class="crm-num">' + s.n + '</td><td class="crm-num">' + s.won + '</td>' +
      '<td class="crm-num">' + (closed ? Math.round((s.won / closed) * 100) + '%' : '—') + '</td>' +
      '<td class="crm-num">' + crmMoney(s.value) + '</td></tr>';
  }).join('') || '<tr><td colspan="5" class="crm-dim">Още няма данни.</td></tr>';

  // Причините за загуба — най-полезната таблица в който и да е CRM.
  var byReason = {};
  deals.filter(function (x) { return x.status === 'lost'; }).forEach(function (x) {
    var k = (x.lost_reason || '').trim() || 'без записана причина';
    byReason[k] = (byReason[k] || 0) + 1;
  });
  var reasonRows = Object.keys(byReason).sort(function (a, b) { return byReason[b] - byReason[a]; })
    .map(function (k) { return '<tr><td>' + esc(k) + '</td><td class="crm-num">' + byReason[k] + '</td></tr>'; }).join('') ||
    '<tr><td colspan="2" class="crm-dim">Още няма загубени сделки.</td></tr>';

  return '<div class="crm-stats">' +
    '<div class="crm-panel"><div class="crm-panel__t">Фунията в момента</div>' + bars +
      '<div class="crm-note">Дължината на лентата е броят сделки в етапа. Ако някой етап е широк, а следващият — тесен, там се къса процесът.</div></div>' +
    '<div class="crm-panel"><div class="crm-panel__t">Откъде идват сделките</div>' +
      '<table class="crm-table crm-table--mini"><thead><tr><th>Източник</th><th>Общо</th><th>Спечелени</th><th>Успеваемост</th><th>Приход</th></tr></thead><tbody>' + srcRows + '</tbody></table></div>' +
    '<div class="crm-panel"><div class="crm-panel__t">Защо губим</div>' +
      '<table class="crm-table crm-table--mini"><thead><tr><th>Причина</th><th>Брой</th></tr></thead><tbody>' + reasonRows + '</tbody></table></div>' +
  '</div>';
}

// ---------- общ модал ----------

function crmModal(title, body, footer, wide) {
  crmCloseModal();
  var m = document.createElement('div');
  m.id = 'crmModal';
  m.className = 'crm-modal';
  m.onclick = function (e) { if (e.target === m) crmCloseModal(); };
  m.innerHTML = '<div class="crm-modal__box' + (wide ? ' crm-modal__box--wide' : '') + '">' +
    '<button class="crm-modal__x" onclick="crmCloseModal()">&times;</button>' +
    '<h2 class="crm-modal__t">' + esc(title) + '</h2>' +
    '<div class="crm-modal__body">' + body + '</div>' +
    '<div class="crm-modal__foot">' + (footer || '') + '</div>' +
  '</div>';
  document.body.appendChild(m);
}
function crmCloseModal() { var m = document.getElementById('crmModal'); if (m) m.remove(); }
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.getElementById('crmModal')) crmCloseModal(); });

// ---------- сделка: нова / отваряне ----------

function crmDealForm(d) {
  d = d || {};
  var stages = (_crm.data && _crm.data.stages) || [];
  var users = (_crm.data && _crm.data.users) || [];
  var stageOpts = stages.map(function (s) {
    return '<option value="' + s.id + '"' + (Number(d.stage_id) === Number(s.id) ? ' selected' : '') + '>' + esc(s.title) + '</option>';
  }).join('');
  var ownerOpts = '<option value="">— без отговорник —</option>' + users.map(function (u) {
    return '<option value="' + u.id + '"' + (Number(d.owner_id) === Number(u.id) ? ' selected' : '') + '>' + esc(u.name) + '</option>';
  }).join('');

  return '<div class="crm-form">' +
    '<label class="crm-field crm-field--full"><span class="crm-label">Сделка *</span>' +
      '<input type="text" class="crm-input" id="cf_title" maxlength="200" value="' + esc(d.title || '') + '" placeholder="напр. Годишен пакет — 12 видеа"></label>' +
    '<label class="crm-field"><span class="crm-label">Фирма</span><input type="text" class="crm-input" id="cf_company" maxlength="200" value="' + esc(d.company || '') + '"></label>' +
    '<label class="crm-field"><span class="crm-label">Лице за контакт</span><input type="text" class="crm-input" id="cf_contact_name" maxlength="200" value="' + esc(d.contact_name || '') + '"></label>' +
    '<label class="crm-field"><span class="crm-label">Имейл</span><input type="email" class="crm-input" id="cf_contact_email" maxlength="200" value="' + esc(d.contact_email || '') + '"></label>' +
    '<label class="crm-field"><span class="crm-label">Телефон</span><input type="text" class="crm-input" id="cf_contact_phone" maxlength="200" value="' + esc(d.contact_phone || '') + '"></label>' +
    '<label class="crm-field"><span class="crm-label">Стойност (лв.)</span><input type="text" class="crm-input" id="cf_value" value="' + esc(String(Number(d.value) || 0)) + '"></label>' +
    '<label class="crm-field"><span class="crm-label">Вид</span><select class="crm-input" id="cf_recurring">' +
      '<option value="0"' + (d.recurring ? '' : ' selected') + '>еднократно</option>' +
      '<option value="1"' + (d.recurring ? ' selected' : '') + '>месечно (абонамент)</option></select></label>' +
    '<label class="crm-field"><span class="crm-label">Етап</span><select class="crm-input" id="cf_stage_id">' + stageOpts + '</select></label>' +
    '<label class="crm-field"><span class="crm-label">Отговорник</span><select class="crm-input" id="cf_owner_id">' + ownerOpts + '</select></label>' +
    '<label class="crm-field"><span class="crm-label">Източник</span><input type="text" class="crm-input" id="cf_source" maxlength="200" list="crmSources" value="' + esc(d.source || '') + '" placeholder="препоръка / Instagram / студен контакт">' +
      '<datalist id="crmSources"><option value="Препоръка"><option value="Instagram"><option value="Facebook"><option value="LinkedIn"><option value="Сайт"><option value="Студен контакт"><option value="Стар клиент"></datalist></label>' +
    '<label class="crm-field crm-field--full"><span class="crm-label">Следваща стъпка</span>' +
      '<input type="text" class="crm-input" id="cf_next_step" maxlength="200" value="' + esc(d.next_step || '') + '" placeholder="напр. Обаждане за уточняване на бюджета"></label>' +
    '<label class="crm-field"><span class="crm-label">Кога</span><input type="date" class="crm-input" id="cf_next_step_at" value="' + esc(crmDay(d.next_step_at)) + '"></label>' +
    '<label class="crm-field crm-field--full"><span class="crm-label">Бележки</span>' +
      '<textarea class="crm-input crm-textarea" id="cf_notes" rows="3" placeholder="Какво иска, какъв бюджет, кой решава…">' + esc(d.notes || '') + '</textarea></label>' +
  '</div>';
}

function crmReadForm() {
  var get = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
  return {
    title: get('cf_title'), company: get('cf_company'),
    contact_name: get('cf_contact_name'), contact_email: get('cf_contact_email'), contact_phone: get('cf_contact_phone'),
    value: get('cf_value'), recurring: get('cf_recurring') === '1',
    stage_id: get('cf_stage_id'), owner_id: get('cf_owner_id') || null,
    source: get('cf_source'), next_step: get('cf_next_step'), next_step_at: get('cf_next_step_at') || null,
    notes: get('cf_notes'),
  };
}

// Скелетът, общ за двете страници на сделка — за да не се дублира обвивката.
function crmPageShell(el) {
  setBreadcrumb([{ label: 'CRM', href: '#/crm' }]);
  el.className = 'flush-top full-width';
  el.innerHTML = '<div class="crm-wrap"><div id="crmDealPage"><div class="crm-dim">Зареждам…</div></div></div>';
  window.scrollTo(0, 0);
}
function crmDealPage(html) { var b = document.getElementById('crmDealPage'); if (b) b.innerHTML = html; }

// #/crm/new — нова сделка на цяла страница.
async function renderCrmNew(el) {
  crmPageShell(el);
  if (!_crm.data) await crmLoad();
  if (!_crm.data) { crmDealPage('<div class="crm-err">Няма достъп или връзка.</div>'); return; }

  var stages = _crm.data.stages || [];
  var first = stages.filter(function (s) { return s.kind === 'open'; })[0] || stages[0];
  crmDealPage(
    '<a class="crm-back" href="#/crm">← Всички сделки</a>' +
    '<div class="crm-head"><h1 class="crm-head__t">Нова сделка</h1>' +
      '<div class="crm-head__s">Задължителни са само името и етапът. Останалото се дописва в движение — колкото по-малко полета, толкова по-вероятно е CRM-ът да се ползва.</div></div>' +
    '<div class="crm-panel crm-panel--form">' +
      crmDealForm({ stage_id: first && first.id, owner_id: currentUser && currentUser.id }) +
      '<div class="crm-pagefoot">' +
        '<a class="btn btn-ghost btn-sm" href="#/crm">Отказ</a>' +
        '<button class="btn btn-sm" onclick="crmCreateDeal()">Създай сделката</button>' +
      '</div>' +
    '</div>');
  var i = document.getElementById('cf_title');
  if (i) i.focus();
}

// #/crm/12 — сделката на цяла страница (хронология + данни един до друг).
async function renderCrmDeal(el, id) {
  crmPageShell(el);
  if (!_crm.data) await crmLoad();
  try {
    var res = await fetch('/api/crm/deals/' + id);
    var data = await res.json();
    if (!res.ok || data.error) { crmDealPage('<a class="crm-back" href="#/crm">← Всички сделки</a><div class="crm-err">' + esc(data.error || 'Грешка.') + '</div>'); return; }
    crmRenderDealPage(data.deal, data.events);
  } catch (e) { crmDealPage('<div class="crm-err">Няма връзка със сървъра.</div>'); }
}

// Презарежда текущата страница на сделка, без да се минава през router-а.
function crmReloadDeal(id) {
  var el = document.getElementById('pageContent');
  if (el) renderCrmDeal(el, id);
}

function crmRenderDealPage(d, events) {
  var h = crmHealth(d);
  var st = crmStage(d.stage_id);
  var stages = (_crm.data && _crm.data.stages) || [];

  var moveBtns = stages.map(function (s) {
    return '<button class="crm-movb' + (Number(s.id) === Number(d.stage_id) ? ' crm-movb--on' : '') + '"' +
      ' style="border-color:' + esc(s.color || 'var(--border)') + '"' +
      ' onclick="crmMoveOnPage(' + d.id + ',' + s.id + ')">' + esc(s.title) + '</button>';
  }).join('');

  var tl = (events || []).map(function (e) {
    var icon = { note: '📝', call: '📞', meeting: '🤝', email: '✉️', stage: '➡️', created: '✨', won: '🎉', lost: '💔', basecamp: '📋' }[e.kind] || '•';
    var txt = e.kind === 'stage' || e.kind === 'won' || e.kind === 'lost'
      ? (e.from_stage ? esc(e.from_stage) + ' → ' : '') + esc(e.to_stage || '') + (e.body ? ' (' + esc(e.body) + ')' : '')
      : esc(e.body);
    return '<div class="crm-ev"><span class="crm-ev__i">' + icon + '</span>' +
      '<div class="crm-ev__c"><div class="crm-ev__b">' + txt + '</div>' +
      '<div class="crm-ev__m">' + esc(e.user_name || '') + ' · ' + timeAgo(e.created_at) + '</div></div></div>';
  }).join('') || '<div class="crm-dim">Още няма записи.</div>';

  var flags = '';
  if (h.overdue) flags += '<span class="crm-b crm-b--red">просрочена стъпка</span>';
  if (h.rotting) flags += '<span class="crm-b crm-b--orange">стои ' + h.daysInStage + ' дни в „' + esc((st && st.title) || '') + '"</span>';
  if (h.noNext) flags += '<span class="crm-b crm-b--dim">без следваща стъпка</span>';
  if (d.archived) flags += '<span class="crm-b crm-b--dim">архивирана</span>';

  crmDealPage(
    '<a class="crm-back" href="#/crm">← Всички сделки</a>' +
    '<div class="crm-dealhead">' +
      '<div><div class="crm-dealhead__t">' + esc(d.title) + '</div>' +
      '<div class="crm-dealhead__s">' + esc(d.company || '') + (d.contact_name ? ' · ' + esc(d.contact_name) : '') +
        (d.contact_email ? ' · <a href="mailto:' + esc(d.contact_email) + '">' + esc(d.contact_email) + '</a>' : '') +
        (d.contact_phone ? ' · <a href="tel:' + esc(d.contact_phone) + '">' + esc(d.contact_phone) + '</a>' : '') + '</div>' +
      '<div class="crm-dealhead__f">' + flags + '</div></div>' +
      '<div class="crm-dealhead__v">' + crmMoney(d.value) + (d.recurring ? '<span class="crm-td__s">/месец</span>' : '') + '</div>' +
    '</div>' +
    '<div class="crm-movbar">' + moveBtns + '</div>' +
    (d.bc_card_url
      ? '<div class="crm-bcline">📋 Карта в Basecamp: <a href="' + esc(d.bc_card_url) + '" target="_blank" rel="noopener">отвори →</a></div>'
      : '<div class="crm-bcline"><button class="btn btn-ghost btn-sm" onclick="crmOpenBasecamp(' + d.id + ')">📋 Направи карта в Basecamp</button>' +
        '<span class="crm-note">Прехвърля клиента в реалния проект — картата се създава от бот профила ThePactAlerts.</span></div>') +
    '<div class="crm-dealgrid">' +
      '<div class="crm-panel">' +
        '<div class="crm-panel__t">Добави в хронологията</div>' +
        '<div class="crm-addev">' +
          '<select class="crm-input crm-sel" id="crmEvKind"><option value="note">📝 Бележка</option><option value="call">📞 Обаждане</option><option value="meeting">🤝 Среща</option><option value="email">✉️ Имейл</option></select>' +
          '<textarea class="crm-input crm-textarea" id="crmEvBody" rows="3" placeholder="Какво се случи и какво следва?"></textarea>' +
          '<button class="btn btn-sm" onclick="crmAddEvent(' + d.id + ')">Запиши</button>' +
        '</div>' +
        '<div class="crm-panel__t" style="margin-top:18px">Хронология</div>' +
        '<div class="crm-timeline">' + tl + '</div>' +
      '</div>' +
      '<div class="crm-panel crm-panel--form">' +
        '<div class="crm-panel__t">Данни</div>' +
        crmDealForm(d) +
        '<div class="crm-pagefoot">' +
          '<button class="btn btn-ghost btn-sm" onclick="crmArchive(' + d.id + ',' + (d.archived ? 'true' : 'false') + ')">' + (d.archived ? 'Върни от архива' : 'Архивирай') + '</button>' +
          '<span class="crm-spacer"></span>' +
          '<button class="btn btn-sm" onclick="crmSaveDeal(' + d.id + ')">Запази</button>' +
        '</div>' +
      '</div>' +
    '</div>');
}

async function crmCreateDeal() {
  if (_crm.busy) return;
  _crm.busy = true;
  try {
    var res = await fetch('/api/crm/deals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(crmReadForm()) });
    var data = await res.json();
    if (!res.ok || data.error) { showToast(data.error || 'Не стана.', 'error'); return; }
    showToast('Сделката е добавена.', 'success');
    _crm.data = null;             // фунията да се презареди с новата сделка
    location.hash = '#/crm/' + data.id;
  } catch (e) { showToast('Грешка при записа.', 'error'); }
  finally { _crm.busy = false; }
}

async function crmSaveDeal(id) {
  if (_crm.busy) return;
  _crm.busy = true;
  var f = crmReadForm();
  var stageId = f.stage_id;
  delete f.stage_id; // етапът се сменя през бутоните горе, за да се засече престоят
  try {
    var res = await fetch('/api/crm/deals/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    var data = await res.json();
    if (!res.ok || data.error) { showToast(data.error || 'Не стана.', 'error'); return; }
    var deal = (data && data.stage_id) ? data : crmDeal(id);
    if (deal && Number(stageId) !== Number(deal.stage_id)) await crmMove(id, parseInt(stageId, 10), '');
    showToast('Записано.', 'success');
    await crmLoad();
    crmReloadDeal(id);
  } catch (e) { showToast('Грешка при записа.', 'error'); }
  finally { _crm.busy = false; }
}

async function crmMoveOnPage(id, stageId) {
  var st = crmStage(stageId);
  if (st && st.kind === 'lost') { crmAskLostReason(id, stageId); return; }
  await crmMove(id, stageId, '');
  crmReloadDeal(id);
}

async function crmAddEvent(id) {
  var kind = (document.getElementById('crmEvKind') || {}).value || 'note';
  var body = (document.getElementById('crmEvBody') || {}).value || '';
  if (!body.trim()) { showToast('Напиши какво се случи.', 'error'); return; }
  try {
    var res = await fetch('/api/crm/deals/' + id + '/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: kind, body: body }) });
    var data = await res.json();
    if (!res.ok || data.error) { showToast(data.error || 'Не стана.', 'error'); return; }
    await crmLoad();
    crmReloadDeal(id);
  } catch (e) { showToast('Грешка.', 'error'); }
}

async function crmArchive(id, isArchived) {
  try {
    var res = await fetch('/api/crm/deals/' + id + (isArchived ? '?restore=1' : ''), { method: 'DELETE' });
    var data = await res.json();
    if (!res.ok || data.error) { showToast(data.error || 'Не стана.', 'error'); return; }
    showToast(isArchived ? 'Върната от архива.' : 'Архивирана.', 'success');
    await crmLoad();
    if (isArchived) crmReloadDeal(id); else location.hash = '#/crm';
  } catch (e) { showToast('Грешка.', 'error'); }
}

// ---------- мост към Basecamp ----------

async function crmOpenBasecamp(id) {
  crmModal('Карта в Basecamp', '<div class="crm-dim">Зареждам дъските…</div>', '');
  try {
    var res = await fetch('/api/crm/basecamp/targets');
    var data = await res.json();
    if (!res.ok || data.error) { crmCloseModal(); showToast(data.error || 'Basecamp не отговори.', 'error'); return; }
    var boards = data.boards || [];
    _crm.bcBoards = boards;
    var opts = boards.map(function (b, i) { return '<option value="' + esc(b.id) + '"' + (i === 0 ? ' selected' : '') + '>' + esc(b.title) + '</option>'; }).join('');
    crmModal('Карта в Basecamp',
      '<div class="crm-form">' +
        '<label class="crm-field"><span class="crm-label">Дъска</span><select class="crm-input" id="crmBcBoard" onchange="crmBcCols()">' + opts + '</select></label>' +
        '<label class="crm-field"><span class="crm-label">Колона</span><select class="crm-input" id="crmBcCol"></select></label>' +
        '<label class="crm-field"><span class="crm-label">Краен срок (по желание)</span><input type="date" class="crm-input" id="crmBcDue"></label>' +
      '</div><div class="crm-note">Картата носи данните на клиента (контакт, стойност, източник, бележки) и линкът ѝ остава при сделката.</div>',
      '<button class="btn btn-ghost btn-sm" onclick="crmCloseModal()">Отказ</button>' +
      '<button class="btn btn-sm" onclick="crmCreateBcCard(' + id + ')">Създай картата</button>');
    crmBcCols();
  } catch (e) { crmCloseModal(); showToast('Няма връзка.', 'error'); }
}

function crmBcCols() {
  var b = document.getElementById('crmBcBoard'), c = document.getElementById('crmBcCol');
  if (!b || !c) return;
  var board = (_crm.bcBoards || []).find(function (x) { return String(x.id) === String(b.value); });
  c.innerHTML = ((board && board.columns) || []).map(function (col, i) {
    return '<option value="' + esc(col.id) + '"' + (i === 0 ? ' selected' : '') + '>' + esc(col.title) + (col.isDone ? ' (Done)' : '') + '</option>';
  }).join('') || '<option value="">— няма колони —</option>';
}

async function crmCreateBcCard(id) {
  var boardId = (document.getElementById('crmBcBoard') || {}).value || '';
  var columnId = (document.getElementById('crmBcCol') || {}).value || '';
  var dueOn = (document.getElementById('crmBcDue') || {}).value || null;
  if (!columnId) { showToast('Избери колона.', 'error'); return; }
  try {
    var res = await fetch('/api/crm/deals/' + id + '/basecamp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId: boardId, columnId: columnId, dueOn: dueOn }),
    });
    var data = await res.json();
    if (!res.ok || data.error) { showToast(data.error || 'Картата не се създаде.', 'error'); return; }
    showToast('Картата е в ' + data.board + ' → ' + data.column + '.', 'success');
    crmCloseModal();
    await crmLoad();
    crmReloadDeal(id);
  } catch (e) { showToast('Грешка при създаването.', 'error'); }
}

// ---------- достъп ----------

async function crmOpenAccess() {
  crmModal('Кой има достъп до CRM', '<div class="crm-dim">Зареждам…</div>', '');
  try {
    var res = await fetch('/api/crm/access');
    var data = await res.json();
    if (!res.ok || data.error) { crmCloseModal(); showToast(data.error || 'Грешка.', 'error'); return; }
    crmRenderAccess(data);
  } catch (e) { crmCloseModal(); showToast('Няма връзка.', 'error'); }
}

function crmRenderAccess(data) {
  var me = data.me || {};
  var haveIds = (data.access || []).map(function (a) { return Number(a.user_id); });
  var candidates = (data.users || []).filter(function (u) { return u.role !== 'admin' && haveIds.indexOf(Number(u.id)) < 0; });

  var rows = (data.access || []).map(function (a) {
    var canRevoke = me.isAdmin || Number(a.granted_by) === Number(data.myId);
    return '<tr>' +
      '<td><div class="crm-td__t">' + esc(a.name) + '</div><div class="crm-td__s">' + esc(a.email || '') + '</div></td>' +
      '<td>' + esc(a.granted_by_name || '—') + '</td>' +
      '<td>' + (a.can_grant ? 'да' : 'не') + '</td>' +
      '<td>' + formatDate(String(a.granted_at).slice(0, 10)) + '</td>' +
      '<td>' + (canRevoke ? '<button class="btn btn-ghost btn-sm" onclick="crmRevoke(' + a.user_id + ',\'' + esc(a.name).replace(/'/g, '') + '\')">Отнеми</button>' : '<span class="crm-dim">—</span>') + '</td>' +
    '</tr>';
  }).join('') || '<tr><td colspan="5" class="crm-dim">Още никой освен пълните админи.</td></tr>';

  var addBox = me.canGrant
    ? '<div class="crm-addaccess">' +
        '<select class="crm-input crm-sel" id="crmGrantUser">' +
          (candidates.length ? candidates.map(function (u) { return '<option value="' + u.id + '">' + esc(u.name) + '</option>'; }).join('') : '<option value="">— няма кого —</option>') +
        '</select>' +
        '<label class="crm-check"><input type="checkbox" id="crmGrantCan" checked> може да дава достъп нататък</label>' +
        '<button class="btn btn-sm" onclick="crmGrant()"' + (candidates.length ? '' : ' disabled') + '>Дай достъп</button>' +
      '</div>'
    : '<div class="crm-note">Ти можеш да ползваш CRM, но не и да даваш достъп на други.</div>';

  crmModal('Кой има достъп до CRM',
    '<div class="crm-note">Пълните админи виждат CRM по право. Всички останали влизат само ако някой ги е пуснал. ' +
      '<strong>Когато отнемеш достъпа на човек, падат и хората, които той е пуснал</strong> — така не остава достъп без стопанин.</div>' +
    '<div class="crm-tablewrap"><table class="crm-table">' +
      '<thead><tr><th>Човек</th><th>Пуснат от</th><th>Може да пуска</th><th>От кога</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' + addBox,
    '<button class="btn btn-ghost btn-sm" onclick="crmCloseModal()">Затвори</button>', true);
}

async function crmGrant() {
  var sel = document.getElementById('crmGrantUser');
  var can = document.getElementById('crmGrantCan');
  if (!sel || !sel.value) return;
  try {
    var res = await fetch('/api/crm/access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: parseInt(sel.value, 10), canGrant: can ? can.checked : true }),
    });
    var data = await res.json();
    if (!res.ok || data.error) { showToast(data.error || 'Не стана.', 'error'); return; }
    showToast('Достъпът е даден.', 'success');
    crmOpenAccess();
  } catch (e) { showToast('Грешка.', 'error'); }
}

async function crmRevoke(userId, name) {
  if (!confirm('Да отнема ли достъпа на ' + name + '? Хората, които той е пуснал, също губят достъп.')) return;
  try {
    var res = await fetch('/api/crm/access/' + userId, { method: 'DELETE' });
    var data = await res.json();
    if (!res.ok || data.error) { showToast(data.error || 'Не стана.', 'error'); return; }
    showToast('Отнет достъп на ' + (data.removed || []).length + ' човек(а).', 'success');
    crmOpenAccess();
  } catch (e) { showToast('Грешка.', 'error'); }
}

// ---------- етапи (админ) ----------

function crmOpenStages() {
  var stages = ((_crm.data && _crm.data.stages) || []).map(function (s) { return Object.assign({}, s); });
  _crm.stageDraft = stages;
  crmRenderStages();
}

function crmRenderStages() {
  var rows = (_crm.stageDraft || []).map(function (s, i) {
    return '<tr>' +
      '<td><input class="crm-input" value="' + esc(s.title) + '" oninput="crmStageEdit(' + i + ',\'title\',this.value)"></td>' +
      '<td><select class="crm-input" onchange="crmStageEdit(' + i + ',\'kind\',this.value)">' +
        ['open', 'won', 'lost'].map(function (k) { return '<option value="' + k + '"' + (s.kind === k ? ' selected' : '') + '>' + ({ open: 'в движение', won: 'спечелена', lost: 'загубена' })[k] + '</option>'; }).join('') +
      '</select></td>' +
      '<td><input class="crm-input crm-input--n" type="number" min="0" max="100" value="' + (s.probability || 0) + '" oninput="crmStageEdit(' + i + ',\'probability\',this.value)"></td>' +
      '<td><input class="crm-input crm-input--n" type="number" min="0" max="365" value="' + (s.rot_days || 0) + '" oninput="crmStageEdit(' + i + ',\'rot_days\',this.value)"></td>' +
      '<td><input class="crm-input crm-input--c" type="color" value="' + esc(s.color || '#3b82f6') + '" oninput="crmStageEdit(' + i + ',\'color\',this.value)"></td>' +
      '<td><input class="crm-input" value="' + esc(s.exit_rule || '') + '" oninput="crmStageEdit(' + i + ',\'exit_rule\',this.value)" placeholder="кога има право да мине нататък"></td>' +
      '<td><button class="crm-xb" onclick="crmStageMove(' + i + ',-1)">↑</button><button class="crm-xb" onclick="crmStageMove(' + i + ',1)">↓</button>' +
        '<button class="crm-xb crm-xb--red" onclick="crmStageDel(' + i + ')">×</button></td>' +
    '</tr>';
  }).join('');

  crmModal('Етапи на фунията',
    '<div class="crm-note">„Вероятност" тежи в претеглената прогноза. „Дни" е след колко дни без движение сделката светва като застояла. ' +
      '<strong>Правилото за изход</strong> е най-важната колона — то е разликата между фуния и списък с надежди. Етап със сделки в него не може да се изтрие.</div>' +
    '<div class="crm-tablewrap"><table class="crm-table crm-table--edit">' +
      '<thead><tr><th>Етап</th><th>Вид</th><th>Вероятност %</th><th>Дни</th><th>Цвят</th><th>Правило за изход</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
    '<button class="btn btn-ghost btn-sm" onclick="crmStageAdd()">+ Добави етап</button>',
    '<button class="btn btn-ghost btn-sm" onclick="crmCloseModal()">Отказ</button>' +
    '<button class="btn btn-sm" onclick="crmSaveStages()">Запази</button>', true);
}

function crmStageEdit(i, key, val) { if (_crm.stageDraft[i]) _crm.stageDraft[i][key] = val; }
function crmStageMove(i, dir) {
  var a = _crm.stageDraft, j = i + dir;
  if (j < 0 || j >= a.length) return;
  var t = a[i]; a[i] = a[j]; a[j] = t;
  crmRenderStages();
}
function crmStageDel(i) { _crm.stageDraft.splice(i, 1); crmRenderStages(); }
function crmStageAdd() { _crm.stageDraft.push({ title: '', kind: 'open', probability: 0, rot_days: 14, color: '#3b82f6', exit_rule: '' }); crmRenderStages(); }

async function crmSaveStages() {
  try {
    var res = await fetch('/api/crm/stages', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stages: _crm.stageDraft }) });
    var data = await res.json();
    if (!res.ok || data.error) { showToast(data.error || 'Не стана.', 'error'); return; }
    crmCloseModal();
    showToast('Етапите са записани.', 'success');
    await crmLoad();
  } catch (e) { showToast('Грешка.', 'error'); }
}

// ---------- достъп до точката в менюто ----------
// Пита се веднъж и се пази, за да не тропа по сървъра при всяко отваряне на More.
var _crmAccess = null;
async function crmCheckAccess() {
  if (_crmAccess !== null) return _crmAccess;
  try {
    var res = await fetch('/api/crm/me');
    var data = await res.json();
    _crmAccess = !!(data && data.access);
  } catch (e) { _crmAccess = false; }
  return _crmAccess;
}
