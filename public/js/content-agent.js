// ==================== CONTENT АГЕНТ (#/content) ====================
// Паметта на всеки клиент + профилите му + успешните видеа + пусканията на агентите.
// Всичко е ПЪЛНА СТРАНИЦА със собствен адрес:
//   #/content            — всички клиенти
//   #/content/12         — клиентът (раздели: памет, профили, успешни видеа, пускания)
//   #/content/12/profiles — директно в раздел
//   #/content/run/34     — едно пускане: стъпките на агентите и готовите скриптове
//   #/content/settings   — ключове и вкл./изкл. (само админ)
var _ca = { client: null, tab: 'memory', kinds: {}, poll: null, showHidden: false, history: null };

var CA_PLATFORMS = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', other: 'Друго' };
var CA_ROLES = { own: 'Собствен', competitor: 'Конкурент', inspiration: 'Вдъхновение' };
var CA_STATUS = { queued: 'чака', running: 'работи…', done: 'готово', error: 'грешка' };
var CA_TRIGGER = { mention: 'таг в Basecamp', kp_auto: 'нов КП', manual: 'от платформата' };

function caRoute(el, parts) {
  if (_ca.poll) { clearTimeout(_ca.poll); _ca.poll = null; }
  if (parts[1] === 'settings') return renderContentSettings(el);
  if (parts[1] === 'run') return renderContentRun(el, parseInt(parts[2], 10));
  var id = parseInt(parts[1], 10);
  if (id) return renderContentClient(el, id, parts[2] || null);
  return renderContentList(el);
}

function caShell(el, title, sub, back) {
  setBreadcrumb([{ label: 'Content агент', href: '#/content' }]);
  el.className = 'flush-top full-width';
  el.innerHTML =
    '<div class="ca-wrap">' +
      (back ? '<a class="ca-back" href="' + back + '">← назад</a>' : '') +
      '<div class="ca-head"><h1 class="ca-head__t">' + title + '</h1>' +
      (sub ? '<div class="ca-head__s">' + sub + '</div>' : '') + '</div>' +
      '<div id="caBody"><div class="ca-dim">Зареждам…</div></div>' +
    '</div>';
}
function caBody(html) { var b = document.getElementById('caBody'); if (b) b.innerHTML = html; }

async function caApi(method, url, body) {
  var res = await fetch('/api/content-agent' + url, {
    method: method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  var data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(data.error || ('Грешка ' + res.status));
  return data;
}

function caDate(v) {
  if (!v) return '';
  var d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
}
function caNum(v) { return v == null ? '—' : Number(v).toLocaleString('bg-BG'); }
function caIsAdmin() { return typeof currentUser === 'object' && currentUser && currentUser.role === 'admin'; }

// ---------- всички клиенти ----------

async function renderContentList(el) {
  caShell(el, '🎬 Content агент',
    'Проучване на успешни видеа, идеи и скриптове по нашата система — от екип агенти, всеки проверен от отделен проверител. ' +
    'Пуска се с <strong>таг на ThePactAlerts</strong> (или <strong>#идеи</strong>) в коментар под задачата в Basecamp — пиши в коментара какво иска клиентът. ' +
    'Тук е паметта на всеки клиент: колкото повече знае, толкова по-точни са идеите.');
  try {
    var data = await caApi('GET', '/clients');
    var html = '<div class="ca-toolbar">' +
      '<input class="ca-input ca-search" id="caSearch" placeholder="Търси клиент…" oninput="caFilterList()">' +
      '<span class="ca-spacer"></span>' +
      (caIsAdmin() && data.clients.some(function (c) { return c.hidden; })
        ? '<label class="ca-check ca-check--inline"><input type="checkbox"' + (_ca.showHidden ? ' checked' : '') + ' onchange="caToggleHidden(this.checked)"> Покажи скритите (' +
          data.clients.filter(function (c) { return c.hidden; }).length + ')</label>' : '') +
      (caIsAdmin() ? '<a class="btn btn-ghost btn-sm" href="#/content/settings">⚙ Настройки</a>' : '') +
      '</div>' + caDuplicatesHtml(data.duplicates || []) + '<div class="ca-grid" id="caGrid">';
    // Еднакви имена = дубликат в КП-Автоматизация. Показваме КП номера и кой е живият,
    // за да не се пълни паметта на стария ред (агентът при таг избира живия).
    var seen = {};
    data.clients.forEach(function (c) { var k = String(c.name).trim().toLowerCase(); seen[k] = (seen[k] || 0) + 1; });
    data.clients.forEach(function (c) {
      if (c.hidden && !_ca.showHidden) return;
      var dup = seen[String(c.name).trim().toLowerCase()] > 1;
      html += '<a class="ca-client' + (c.is_active === false || c.hidden ? ' ca-client--off' : '') + '" href="#/content/' + c.id + '" data-name="' + esc(String(c.name).toLowerCase()) + '">' +
        '<div class="ca-client__n">' + esc(c.name) +
          (caIsAdmin() ? '<button class="ca-x ca-client__hide" title="' + (c.hidden ? 'Покажи пак' : 'Скрий от списъка') + '" onclick="caHideClient(event,' + c.id + ',' + (c.hidden ? 'false' : 'true') + ')">' + (c.hidden ? 'покажи' : 'скрий') + '</button>' : '') +
        '</div>' +
        '<div class="ca-client__m">' +
          '<span>🧠 ' + c.memory + '</span>' +
          (c.pending ? '<span class="ca-pill ca-pill--warn">' + c.pending + ' чакат</span>' : '') +
          '<span>📱 ' + c.profiles + '</span>' +
        '</div>' +
        '<div class="ca-client__s">' + (c.current_kp_number ? 'КП-' + esc(c.current_kp_number) + ' · ' : '') +
          (c.last_run ? 'последно: ' + esc(caDate(c.last_run)) : 'още не е пускан') + '</div>' +
        (dup ? '<div class="ca-client__dup">' + (c.linked ? '✓ този ползва агентът (свързан с Basecamp)' : '⚠ дубликат в КП-Автоматизация — не пълни този') + '</div>' : '') +
      '</a>';
    });
    html += '</div>';
    caBody(html);
  } catch (e) { caBody('<div class="ca-err">' + esc(e.message) + '</div>'); }
}

// Засечени клиенти с еднакви имена в КП-Автоматизация — показва се само настоящият.
function caDuplicatesHtml(list) {
  if (!list.length) return '';
  return '<div class="ca-dupbox"><strong>Засякох ' + list.length + ' клиента, въведени по два пъти в КП-Автоматизация.</strong> ' +
    'Показвам и ползвам само настоящия (най-високият КП). Всичко, въведено в стария, се мести само в настоящия — нищо не се губи. ' +
    list.map(function (d) {
      return esc(d.name) + ': ползва се КП-' + esc(d.canonical.kp || '?') + ', стар ' +
        d.others.map(function (o) { return 'КП-' + esc(o.kp || '?'); }).join(', ');
    }).join(' · ') + '</div>';
}

function caToggleHidden(on) {
  _ca.showHidden = on;
  renderContentList(document.getElementById('pageContent'));
}

async function caHideClient(ev, id, hidden) {
  ev.preventDefault(); ev.stopPropagation();
  try {
    await caApi('POST', '/clients/' + id + '/hide', { hidden: hidden });
    showToast(hidden ? 'Клиентът е скрит (вижда се с Покажи скритите)' : 'Клиентът се вижда пак', 'success');
    renderContentList(document.getElementById('pageContent'));
  } catch (e) { showToast(e.message, 'error'); }
}

function caFilterList() {
  var q = (document.getElementById('caSearch').value || '').toLowerCase().trim();
  document.querySelectorAll('#caGrid .ca-client').forEach(function (a) {
    a.style.display = !q || a.getAttribute('data-name').indexOf(q) >= 0 ? '' : 'none';
  });
}

// ---------- един клиент ----------

async function renderContentClient(el, id, tab) {
  if (tab) _ca.tab = tab;
  caShell(el, '🎬 Content агент', '', '#/content');
  await caLoadClient(id);
}

// Пише ли човекът нещо в момента? Тогава автоматичното опресняване НЕ пипа страницата —
// иначе изтрива отворената редакция и написания текст (така беше до 27.10.2026).
function caUserBusy() {
  var body = document.getElementById('caBody');
  if (!body) return false;
  if (body.querySelector('[id^="caET"]')) return true; // отворена редакция на запис
  var a = document.activeElement;
  if (a && body.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
  var typed = body.querySelectorAll('textarea, input[type="text"], input:not([type])');
  for (var i = 0; i < typed.length; i++) if (String(typed[i].value || '').trim()) return true;
  return false;
}

async function caLoadClient(id, fromPoll) {
  if (_ca.poll) { clearTimeout(_ca.poll); _ca.poll = null; }
  var schedule = function () {
    _ca.poll = setTimeout(function () { if (location.hash.indexOf('#/content/' + id) === 0) caLoadClient(id, true); }, 15000);
  };
  // Автоматичното опресняване изчаква, докато човекът пише.
  if (fromPoll && caUserBusy()) { schedule(); return; }
  try {
    var d = await caApi('GET', '/clients/' + id);
    if (d.redirect) { location.hash = '#/content/' + d.redirect + (_ca.tab ? '/' + _ca.tab : ''); return; }
    if (fromPoll && caUserBusy()) { schedule(); return; } // почнал е да пише, докато чакахме отговора
    _ca.client = d;
    _ca.kinds = d.kinds || {};
    caRenderClient();
    // Докато върви пускане или обновяване на профили — опресняваме сами.
    var busy = d.scouting || d.runs.some(function (r) { return r.status === 'queued' || r.status === 'running'; });
    if (busy) schedule();
  } catch (e) { if (!fromPoll) caBody('<div class="ca-err">' + esc(e.message) + '</div>'); else schedule(); }
}

function caRenderClient() {
  var d = _ca.client;
  var c = d.client;
  var pending = d.memory.filter(function (m) { return m.status === 'pending'; }).length;
  var tabs = [
    ['memory', '🧠 Памет (' + d.memory.filter(function (m) { return m.status === 'approved'; }).length + ')' + (pending ? ' · ' + pending + ' чакат' : '')],
    ['profiles', '📱 Профили (' + d.profiles.length + ')'],
    ['videos', '🔥 Успешни видеа (' + d.outliers.length + ')'],
    ['runs', '🤖 Пускания (' + d.runs.length + ')'],
  ];
  if (caIsAdmin()) tabs.push(['history', '🕘 История']);
  var html = '<div class="ca-chead"><div class="ca-chead__n">' + esc(c.name) + '</div>' +
    '<div class="ca-tabs">' + tabs.map(function (t) {
      return '<button class="ca-tab' + (_ca.tab === t[0] ? ' ca-tab--on' : '') + '" onclick="caTab(\'' + t[0] + '\')">' + t[1] + '</button>';
    }).join('') + '</div></div>';
  if (_ca.tab === 'profiles') html += caProfilesHtml(d);
  else if (_ca.tab === 'videos') html += caVideosHtml(d);
  else if (_ca.tab === 'runs') html += caRunsHtml(d);
  else if (_ca.tab === 'history' && caIsAdmin()) html += '<div id="caHistory"><div class="ca-dim">Зареждам историята…</div></div>';
  else html += caMemoryHtml(d);
  caBody(html);
  if (_ca.tab === 'history' && caIsAdmin()) caLoadHistory();
}

function caTab(t) {
  _ca.tab = t;
  history.replaceState(null, '', '#/content/' + _ca.client.client.id + '/' + t);
  caRenderClient();
}

// ---------- памет ----------

function caKindOptions(sel) {
  return Object.keys(_ca.kinds).map(function (k) {
    return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(_ca.kinds[k]) + '</option>';
  }).join('');
}

function caMemoryHtml(d) {
  var pending = d.memory.filter(function (m) { return m.status === 'pending'; });
  var approved = d.memory.filter(function (m) { return m.status === 'approved'; });
  var html = '<div class="ca-cols">';

  // лява колона — паметта
  html += '<div>';
  if (pending.length) {
    var pOpen = caIsOpen('pending');
    html += '<div class="ca-panel ca-panel--warn' + (pOpen ? '' : ' ca-panel--closed') + '"><div class="ca-panel__t ca-fold" onclick="caFold(\'pending\')">' +
      '<span class="ca-fold__a">' + (pOpen ? '▾' : '▸') + '</span>Чакат одобрение (' + pending.length + ')' +
      '<span class="ca-spacer"></span><button class="btn btn-sm" onclick="event.stopPropagation();caBulk(\'approved\')">✓ Одобри всички</button> ' +
      '<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();caBulk(\'rejected\')">✗ Откажи всички</button></div>' +
      (pOpen ? '<div class="ca-hint">Това агентът го е научил сам (от коментар в Basecamp или от импорт). Докато не го одобриш, НЕ се ползва. ✓ = влиза в паметта, ✗ = изхвърля се. Може първо да го поправиш.</div>' +
        pending.map(caMemItem).join('') : '') + '</div>';
  }
  var kinds = Object.keys(_ca.kinds);
  kinds.forEach(function (k) {
    var items = approved.filter(function (m) { return m.kind === k; });
    if (!items.length) return;
    var open = caIsOpen(k);
    html += '<div class="ca-panel' + (open ? '' : ' ca-panel--closed') + '"><div class="ca-panel__t ca-fold" onclick="caFold(\'' + k + '\')">' +
      '<span class="ca-fold__a">' + (open ? '▾' : '▸') + '</span>' + esc(_ca.kinds[k]) + ' (' + items.length + ')</div>' +
      (open ? items.map(caMemItem).join('') : '') + '</div>';
  });
  if (!approved.length && !pending.length) html += '<div class="ca-panel ca-dim">Паметта е празна. Добави неща вдясно или импортирай карта/проучване/стари скриптове.</div>';
  html += '</div>';

  // дясна колона — добавяне
  html += '<div class="ca-side">' +
    '<div class="ca-panel"><div class="ca-panel__t">Добави запис</div>' +
      '<select class="ca-input" id="caMemKind">' + caKindOptions('like') + '</select>' +
      '<textarea class="ca-input ca-textarea" id="caMemText" rows="4" placeholder="напр. Не харесва шеги за възрастта. / Говори на „ти“, кратко и с хумор."></textarea>' +
      '<button class="btn btn-primary btn-sm" onclick="caAddMem()">Запази</button></div>' +
    '<div class="ca-panel"><div class="ca-panel__t">Импорт</div>' +
      '<div class="ca-hint">Постави текст или избери файл (.md, .txt, .csv): карта на клиента, research, стари скриптове, бележки от среща. Агентът го разбива на отделни записи, които чакат одобрение. За Word — копирай текста и го постави.</div>' +
      '<input type="file" id="caImpFile" accept=".md,.txt,.csv,.json,.html" class="ca-input" onchange="caReadFile(this)">' +
      '<textarea class="ca-input ca-textarea" id="caImpText" rows="6" placeholder="…или постави текста тук"></textarea>' +
      '<button class="btn btn-primary btn-sm" id="caImpBtn" onclick="caImport()">Импортирай</button></div>' +
    caRunPanel() +
  '</div></div>';
  return html;
}

// Категориите в паметта са свити по подразбиране (вижда се само заглавието и броят).
// Кое е отворено се помни в браузъра.
function caOpenMap() {
  try { return JSON.parse(localStorage.getItem('ca_open_kinds') || '{}') || {}; } catch (e) { return {}; }
}
function caIsOpen(k) { return !!caOpenMap()[k]; }
function caFold(k) {
  var m = caOpenMap();
  m[k] = !m[k];
  try { localStorage.setItem('ca_open_kinds', JSON.stringify(m)); } catch (e) {}
  caRenderClient();
}

function caMemItem(m) {
  return '<div class="ca-mem" id="caMem' + m.id + '">' +
    '<div class="ca-mem__t">' + esc(m.text).replace(/\n/g, '<br>') + '</div>' +
    '<div class="ca-mem__f"><span class="ca-dim">' + esc(m.source || '') + (m.created_by ? ' · ' + esc(m.created_by) : '') + ' · ' + esc(caDate(m.created_at)) + '</span>' +
    '<span class="ca-spacer"></span>' +
    (m.status === 'pending'
      ? '<button class="ca-x ca-x--ok" title="Одобри" onclick="caMemStatus(' + m.id + ',\'approved\')">✓</button><button class="ca-x" title="Откажи" onclick="caMemStatus(' + m.id + ',\'rejected\')">✗</button>'
      : '') +
    '<button class="ca-x" title="Редактирай" onclick="caEditMem(' + m.id + ')">✎</button>' +
    '<button class="ca-x" title="Изтрий" onclick="caDelMem(' + m.id + ')">🗑</button></div></div>';
}

function caFindMem(id) { return _ca.client.memory.find(function (m) { return m.id === id; }); }

async function caAddMem() {
  var text = document.getElementById('caMemText').value.trim();
  if (!text) return;
  try {
    await caApi('POST', '/clients/' + _ca.client.client.id + '/memory', { kind: document.getElementById('caMemKind').value, text: text });
    showToast('Записано в паметта', 'success');
    caLoadClient(_ca.client.client.id);
  } catch (e) { showToast(e.message, 'error'); }
}

async function caMemStatus(id, status) {
  try { await caApi('PUT', '/memory/' + id, { status: status }); caLoadClient(_ca.client.client.id); }
  catch (e) { showToast(e.message, 'error'); }
}

async function caBulk(status) {
  if (!confirm(status === 'approved' ? 'Одобряваш ли всички чакащи?' : 'Отказваш ли всички чакащи?')) return;
  try { await caApi('POST', '/clients/' + _ca.client.client.id + '/memory/bulk', { status: status }); caLoadClient(_ca.client.client.id); }
  catch (e) { showToast(e.message, 'error'); }
}

function caEditMem(id) {
  var m = caFindMem(id);
  var box = document.getElementById('caMem' + id);
  if (!m || !box) return;
  box.innerHTML = '<select class="ca-input" id="caEK' + id + '">' + caKindOptions(m.kind) + '</select>' +
    '<textarea class="ca-input ca-textarea" id="caET' + id + '" rows="4">' + esc(m.text) + '</textarea>' +
    '<button class="btn btn-primary btn-sm" onclick="caSaveMem(' + id + ')">Запази</button> ' +
    '<button class="btn btn-ghost btn-sm" onclick="caRenderClient()">Откажи</button>';
}

async function caSaveMem(id) {
  try {
    await caApi('PUT', '/memory/' + id, { kind: document.getElementById('caEK' + id).value, text: document.getElementById('caET' + id).value });
    caLoadClient(_ca.client.client.id);
  } catch (e) { showToast(e.message, 'error'); }
}

async function caDelMem(id) {
  if (!confirm('Да изтрия ли записа от паметта?')) return;
  try { await caApi('DELETE', '/memory/' + id); caLoadClient(_ca.client.client.id); }
  catch (e) { showToast(e.message, 'error'); }
}

function caReadFile(input) {
  var f = input.files && input.files[0];
  if (!f) return;
  var r = new FileReader();
  r.onload = function () { document.getElementById('caImpText').value = String(r.result || ''); };
  r.readAsText(f, 'utf-8');
}

async function caImport() {
  var text = document.getElementById('caImpText').value.trim();
  var f = document.getElementById('caImpFile').files[0];
  if (text.length < 20) { showToast('Няма какво да импортирам', 'error'); return; }
  var btn = document.getElementById('caImpBtn');
  btn.disabled = true; btn.textContent = 'Агентът чете… (до 2-3 мин)';
  try {
    var r = await caApi('POST', '/clients/' + _ca.client.client.id + '/import', { text: text, filename: f ? f.name : 'поставен текст' });
    showToast('Добавени ' + r.added + ' записа — чакат одобрение', 'success', 5000);
    caLoadClient(_ca.client.client.id);
  } catch (e) { showToast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Импортирай'; }
}

// ---------- история (само админ) ----------

var CA_ACTIONS = { create: 'добави', update: 'редактира', status: 'смени статуса', delete: 'изтри', restore: 'върна' };
var CA_MSTATUS = { approved: 'одобрено', pending: 'чака одобрение', rejected: 'отказано' };

async function caLoadHistory() {
  var box = document.getElementById('caHistory');
  try {
    var r = await caApi('GET', '/clients/' + _ca.client.client.id + '/history');
    _ca.history = r.history;
    if (!box) return;
    if (!r.history.length) { box.innerHTML = '<div class="ca-panel ca-dim">Още няма промени в историята. Записва се всичко от днес нататък.</div>'; return; }
    box.innerHTML = '<div class="ca-panel"><div class="ca-hint">Всяка промяна по паметта и профилите: кой, кога, какво е било преди и какво стана. ' +
      '„Върни“ връща записа както е бил ПРЕДИ тази промяна (изтрит се появява пак, редактиран се връща към стария текст, добавен се маха). Самото връщане също се пази тук.</div>' +
      r.history.map(caHistItem).join('') + '</div>';
  } catch (e) { if (box) box.innerHTML = '<div class="ca-err">' + esc(e.message) + '</div>'; }
}

function caHistDesc(entity, row) {
  if (!row) return '<span class="ca-dim">(няма)</span>';
  if (entity === 'profile') {
    return esc((CA_PLATFORMS[row.platform] || row.platform) + ' · ' + (CA_ROLES[row.role] || row.role) + ' · ' + (row.label || row.handle || row.url || '')) +
      (row.active === false ? ' <em>(спрян)</em>' : '');
  }
  return '<strong>' + esc(_ca.kinds[row.kind] || row.kind) + '</strong> · <em>' + esc(CA_MSTATUS[row.status] || row.status) + '</em><br>' +
    esc(String(row.text || '')).replace(/\n/g, '<br>');
}

function caHistItem(h) {
  var what = h.entity === 'profile' ? 'профил' : 'запис в паметта';
  var head = '<strong>' + esc(h.by_name || 'неизвестен') + '</strong> ' + esc(CA_ACTIONS[h.action] || h.action) + ' ' + what +
    ' <span class="ca-dim">· ' + esc(caDate(h.created_at)) + '</span>';
  var body;
  if (h.action === 'create') body = '<div class="ca-hist__a">' + caHistDesc(h.entity, h.after) + '</div>';
  else if (h.action === 'delete') body = '<div class="ca-hist__b">' + caHistDesc(h.entity, h.before) + '</div>';
  else body = '<div class="ca-hist__b"><span class="ca-dim">Беше:</span> ' + caHistDesc(h.entity, h.before) + '</div>' +
    '<div class="ca-hist__a"><span class="ca-dim">Стана:</span> ' + caHistDesc(h.entity, h.after) + '</div>';
  var label = !h.before ? '↩ Махни добавеното' : '↩ Върни както беше преди';
  return '<div class="ca-hist"><div class="ca-hist__h">' + head + '<span class="ca-spacer"></span>' +
    '<button class="btn btn-ghost btn-sm" onclick="caRestore(' + h.id + ',' + (h.before ? 'false' : 'true') + ')">' + label + '</button></div>' + body + '</div>';
}

async function caRestore(hid, removes) {
  if (!confirm(removes ? 'Да махна ли този запис (връщане към преди добавянето)?' : 'Да върна ли записа както е бил преди тази промяна?')) return;
  try {
    await caApi('POST', '/history/' + hid + '/restore');
    showToast('Върнато', 'success');
    caLoadClient(_ca.client.client.id);
  } catch (e) { showToast(e.message, 'error'); }
}

// ---------- пускане от платформата ----------

function caRunPanel() {
  return '<div class="ca-panel"><div class="ca-panel__t">Пусни агентите</div>' +
    '<div class="ca-hint">Обикновено се пуска с таг в Basecamp. Оттук — ако искаш да пробваш или нямаш задача. С линк към задача в Basecamp резултатът отива и като коментар там.</div>' +
    '<textarea class="ca-input ca-textarea" id="caRunReq" rows="3" placeholder="Какво да включва: теми, продукти, брой видеа, какво иска клиентът…"></textarea>' +
    '<input class="ca-input" id="caRunLink" placeholder="Линк към задачата в Basecamp (по желание)">' +
    '<button class="btn btn-primary btn-sm" onclick="caRun()">🤖 Пусни</button></div>';
}

async function caRun() {
  try {
    var r = await caApi('POST', '/clients/' + _ca.client.client.id + '/run', {
      request: document.getElementById('caRunReq').value, basecamp_url: document.getElementById('caRunLink').value.trim(),
    });
    showToast('Пуснато — отнема 20-40 мин', 'success', 5000);
    location.hash = '#/content/run/' + r.id;
  } catch (e) { showToast(e.message, 'error'); }
}

// ---------- профили ----------

function caProfilesHtml(d) {
  var html = '<div class="ca-cols"><div>';
  html += '<div class="ca-panel"><div class="ca-panel__t">Профили (' + d.profiles.length + ')<span class="ca-spacer"></span>' +
    '<button class="btn btn-sm" ' + (d.scouting ? 'disabled' : '') + ' onclick="caScout()">' + (d.scouting ? '⏳ Обновявам…' : '🔄 Обнови видеата') + '</button></div>';
  if (!d.profiles.length) html += '<div class="ca-dim">Няма профили. Добави собствените профили на клиента (колкото са — напр. по един за всеки град), конкуренти и акаунти за вдъхновение.</div>';
  else {
    html += '<table class="ca-table"><thead><tr><th>Платформа</th><th>Профил</th><th>Вид</th><th>Медиана гледания</th><th>Видеа</th><th>Обновен</th><th></th></tr></thead><tbody>';
    d.profiles.forEach(function (p) {
      var s = p.stats || {};
      html += '<tr class="' + (p.active ? '' : 'ca-off') + '"><td>' + esc(CA_PLATFORMS[p.platform] || p.platform) + '</td>' +
        '<td><strong>' + esc(p.label || p.handle || '') + '</strong>' +
          (p.url ? '<br><a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.url) + '</a>' : (p.handle ? '<br>@' + esc(p.handle) : '')) +
          (s.error ? '<div class="ca-errline">⚠ ' + esc(s.error) + '</div>' : '') + '</td>' +
        '<td>' + esc(CA_ROLES[p.role] || p.role) + '</td>' +
        '<td>' + caNum(s.median == null ? null : Math.round(s.median)) + '</td><td>' + caNum(s.count) + '</td>' +
        '<td>' + esc(caDate(p.last_scraped_at)) + '</td>' +
        '<td class="ca-nowrap"><button class="ca-x" title="' + (p.active ? 'Спри' : 'Включи') + '" onclick="caToggleProfile(' + p.id + ')">' + (p.active ? '⏸' : '▶') + '</button>' +
        '<button class="ca-x" title="Изтрий" onclick="caDelProfile(' + p.id + ')">🗑</button></td></tr>';
    });
    html += '</tbody></table>';
  }
  html += '</div></div>';
  html += '<div class="ca-side"><div class="ca-panel"><div class="ca-panel__t">Добави профил</div>' +
    '<select class="ca-input" id="caPPlat">' + Object.keys(CA_PLATFORMS).map(function (k) { return '<option value="' + k + '">' + CA_PLATFORMS[k] + '</option>'; }).join('') + '</select>' +
    '<select class="ca-input" id="caPRole">' + Object.keys(CA_ROLES).map(function (k) { return '<option value="' + k + '">' + CA_ROLES[k] + '</option>'; }).join('') + '</select>' +
    '<input class="ca-input" id="caPUrl" placeholder="Линк към профила">' +
    '<input class="ca-input" id="caPHandle" placeholder="@профил (ако няма линк)">' +
    '<input class="ca-input" id="caPLabel" placeholder="Име за нас, напр. Cineland Пловдив">' +
    '<button class="btn btn-primary btn-sm" onclick="caAddProfile()">Добави</button>' +
    '<div class="ca-hint">Видеата се дърпат автоматично при всяко пускане на агентите (ако профилът не е обновяван 3 дни) или с бутона „Обнови видеата“. Facebook иска линк към страницата.</div>' +
    '</div></div></div>';
  return html;
}

async function caAddProfile() {
  try {
    await caApi('POST', '/clients/' + _ca.client.client.id + '/profiles', {
      platform: document.getElementById('caPPlat').value, role: document.getElementById('caPRole').value,
      url: document.getElementById('caPUrl').value, handle: document.getElementById('caPHandle').value, label: document.getElementById('caPLabel').value,
    });
    showToast('Профилът е добавен', 'success');
    caLoadClient(_ca.client.client.id);
  } catch (e) { showToast(e.message, 'error'); }
}

async function caToggleProfile(id) {
  var p = _ca.client.profiles.find(function (x) { return x.id === id; });
  if (!p) return;
  try { await caApi('PUT', '/profiles/' + id, Object.assign({}, p, { active: !p.active })); caLoadClient(_ca.client.client.id); }
  catch (e) { showToast(e.message, 'error'); }
}

async function caDelProfile(id) {
  if (!confirm('Да изтрия ли профила и събраните му видеа?')) return;
  try { await caApi('DELETE', '/profiles/' + id); caLoadClient(_ca.client.client.id); }
  catch (e) { showToast(e.message, 'error'); }
}

async function caScout() {
  try {
    await caApi('POST', '/clients/' + _ca.client.client.id + '/scout', { force: true });
    showToast('Обновявам профилите — отнема няколко минути', 'success', 5000);
    caLoadClient(_ca.client.client.id);
  } catch (e) { showToast(e.message, 'error'); }
}

// ---------- успешни видеа ----------

function caVideosHtml(d) {
  if (!d.outliers.length) {
    return '<div class="ca-panel ca-dim">Още няма успешни видеа. Добави профили (раздел „Профили“) и натисни „Обнови видеата“. ' +
      'Видео е „успешно“, когато има поне 1.5× повече гледания от медианата на собствения си профил (3× интересно, 5× outlier, 10× пробив).</div>';
  }
  var html = '<div class="ca-panel"><div class="ca-panel__t">Успешни видеа — над нормата на собствения си профил</div>' +
    '<table class="ca-table"><thead><tr><th>Скор</th><th>Профил</th><th>Видео</th><th>Гледания</th><th>Медиана</th><th>❤</th><th>💬</th><th>↗</th><th>Дата</th></tr></thead><tbody>';
  d.outliers.forEach(function (v) {
    var sc = Number(v.outlier_score);
    var cls = sc >= 10 ? 'ca-score--hot' : sc >= 5 ? 'ca-score--good' : sc >= 3 ? 'ca-score--ok' : '';
    html += '<tr><td><span class="ca-score ' + cls + '">' + sc.toFixed(1) + '×</span></td>' +
      '<td>' + esc(CA_PLATFORMS[v.platform] || v.platform) + '<br><span class="ca-dim">' + esc(v.label || v.handle || '') + ' · ' + esc(CA_ROLES[v.role] || '') + '</span></td>' +
      '<td class="ca-cap"><a href="' + esc(v.url) + '" target="_blank" rel="noopener">' + esc(String(v.caption || 'видео').slice(0, 140)) + '</a></td>' +
      '<td>' + caNum(v.views) + '</td><td>' + caNum(v.profile_median == null ? null : Math.round(v.profile_median)) + '</td>' +
      '<td>' + caNum(v.likes) + '</td><td>' + caNum(v.comments) + '</td><td>' + caNum(v.shares) + '</td>' +
      '<td>' + esc(v.published_at ? String(v.published_at).slice(0, 10) : '') + '</td></tr>';
  });
  return html + '</tbody></table></div>';
}

// ---------- пускания ----------

function caRunsHtml(d) {
  if (!d.runs.length) return '<div class="ca-cols"><div class="ca-panel ca-dim">Още няма пускания.</div><div class="ca-side">' + caRunPanel() + '</div></div>';
  var html = '<div class="ca-cols"><div class="ca-panel"><table class="ca-table"><thead><tr><th>#</th><th>Кога</th><th>Как</th><th>Кой</th><th>Заявка</th><th>Статус</th></tr></thead><tbody>';
  d.runs.forEach(function (r) {
    html += '<tr class="ca-click" onclick="location.hash=\'#/content/run/' + r.id + '\'"><td>' + r.id + '</td><td>' + esc(caDate(r.created_at)) + '</td>' +
      '<td>' + esc(CA_TRIGGER[r.trigger] || r.trigger) + '</td><td>' + esc(r.requested_by || '') + '</td>' +
      '<td class="ca-cap">' + esc(String(r.request || '').slice(0, 120)) + '</td>' +
      '<td><span class="ca-st ca-st--' + r.status + '">' + esc(CA_STATUS[r.status] || r.status) + '</span></td></tr>';
  });
  return html + '</tbody></table></div><div class="ca-side">' + caRunPanel() + '</div></div>';
}

async function renderContentRun(el, rid) {
  caShell(el, '🤖 Пускане #' + rid, '', '#/content');
  try {
    var r = await caApi('GET', '/runs/' + rid);
    var back = document.querySelector('.ca-back');
    if (back && r.client_id) back.setAttribute('href', '#/content/' + r.client_id + '/runs');
    var res = r.result || {};
    var html = '<div class="ca-panel"><div class="ca-runmeta">' +
      '<span class="ca-st ca-st--' + r.status + '">' + esc(CA_STATUS[r.status] || r.status) + '</span> ' +
      esc(CA_TRIGGER[r.trigger] || r.trigger) + (r.requested_by ? ' · ' + esc(r.requested_by) : '') + ' · ' + esc(caDate(r.created_at)) +
      (r.usage && r.usage.calls ? ' · ' + r.usage.calls + ' AI заявки' : '') +
      (r.bc_project_id && r.bc_parent_id ? ' · <a href="https://3.basecamp.com/5750544/buckets/' + r.bc_project_id + '/recordings/' + r.bc_parent_id + '" target="_blank" rel="noopener">задачата в Basecamp</a>' : '') +
      '</div>' + (r.request ? '<div class="ca-req">' + esc(r.request).replace(/\n/g, '<br>') + '</div>' : '') +
      (r.error ? '<div class="ca-err">' + esc(r.error) + '</div>' : '') + '</div>';

    html += '<div class="ca-cols"><div>';
    if (res.scripts && res.scripts.length) {
      if (res.intro) html += '<div class="ca-panel"><div class="ca-panel__t">От главния редактор</div>' + esc(res.intro) +
        (res.to_check && res.to_check.length ? '<ul>' + res.to_check.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
      if (res.research && res.research.patterns && res.research.patterns.length) {
        html += '<div class="ca-panel"><div class="ca-panel__t">Какво работи (успешни видеа)</div><ul>' + res.research.patterns.map(function (p) {
          return '<li><strong>' + esc(p.name) + '</strong> — ' + esc(p.how_for_client || p.why_it_works || '') + '</li>';
        }).join('') + '</ul></div>';
      }
      res.scripts.forEach(function (s) {
        var hook = typeof s.hook === 'string' ? s.hook : (s.hook && s.hook.text) || '';
        html += '<div class="ca-panel ca-script"><div class="ca-panel__t">Видео ' + esc(s.n) + ': ' + esc(s.title || '') +
          ' <span class="ca-dim">' + esc([s.type, s.duration_sec ? '~' + s.duration_sec + ' сек' : ''].filter(Boolean).join(' · ')) + '</span></div>' +
          (hook ? '<div><strong>Кукичка:</strong> ' + esc(hook) + '</div>' : '') +
          '<pre class="ca-pre">/Участници във видеото - ' + esc(s.participants || '') + '/\n/Локация - ' + esc(s.location || '') + '/\n/Необходими продукти-ресурси - ' + esc(s.resources || '') + '/\n\n' + esc(s.body || '') +
          (s.caption ? '\n\nОписание (Caption): ' + esc(s.caption) : '') + '</pre>' +
          (s.human_input ? '<div class="ca-hint">Човек да допълни: ' + esc(s.human_input) + '</div>' : '') +
          (s.reference_url ? '<div class="ca-hint">Референция: <a href="' + esc(s.reference_url) + '" target="_blank" rel="noopener">' + esc(s.reference_url) + '</a></div>' : '') +
          '</div>';
      });
    } else if (r.status === 'queued' || r.status === 'running') {
      html += '<div class="ca-panel ca-dim">Агентите работят… страницата се опреснява сама.</div>';
    }
    html += '</div><div class="ca-side"><div class="ca-panel"><div class="ca-panel__t">Стъпки на агентите</div>' + caStepsHtml(r.steps || []) + '</div></div></div>';
    caBody(html);
    if (r.status === 'queued' || r.status === 'running') {
      _ca.poll = setTimeout(function () { if (location.hash === '#/content/run/' + rid) renderContentRun(el, rid); }, 15000);
    }
  } catch (e) { caBody('<div class="ca-err">' + esc(e.message) + '</div>'); }
}

function caStepsHtml(steps) {
  if (!steps.length) return '<div class="ca-dim">Още няма.</div>';
  return steps.map(function (s) {
    if (s.key === 'progress') return '<div class="ca-step ca-step--p">↻ ' + esc(s.title) + '</div>';
    var badge = s.rounds ? (s.ok ? '<span class="ca-pill ca-pill--ok">проверено ' + (s.score ? s.score + '/10' : '') + '</span>' : '<span class="ca-pill ca-pill--warn">с забележки</span>') : '';
    var extra = [];
    if (s.rounds > 1) extra.push((s.rounds - 1) + ' поправки');
    if (s.learned != null) extra.push('научени: ' + s.learned);
    if (s.outliers != null) extra.push('успешни видеа: ' + s.outliers);
    if (s.count != null) extra.push('идеи: ' + s.count);
    if (s.errors && s.errors.length) extra.push('⚠ ' + s.errors.join('; '));
    var issues = (s.open_issues || []).map(function (i) { return '<li>' + (i.n ? 'Видео ' + esc(i.n) + ': ' : '') + esc(i.problem || '') + '</li>'; }).join('');
    return '<div class="ca-step"><div><strong>' + esc(s.title) + '</strong> ' + badge + '</div>' +
      (extra.length ? '<div class="ca-dim">' + esc(extra.join(' · ')) + '</div>' : '') +
      (issues ? '<ul class="ca-issues">' + issues + '</ul>' : '') + '</div>';
  }).join('');
}

// ---------- настройки ----------

async function renderContentSettings(el) {
  caShell(el, '⚙ Content агент — настройки', 'Ключовете за събиране на видеа и кога се пускат агентите. Вижда се само от админ.', '#/content');
  if (!caIsAdmin()) { caBody('<div class="ca-err">Само за админ.</div>'); return; }
  try {
    var s = await caApi('GET', '/settings');
    caBody('<div class="ca-panel ca-form">' +
      '<label class="ca-check"><input type="checkbox" id="caSEn"' + (s.ca_enabled ? ' checked' : '') + '> Следи таговете в Basecamp (ThePactAlerts или #идеи в коментар)</label>' +
      '<label class="ca-check"><input type="checkbox" id="caSAuto"' + (s.ca_auto_on_kp ? ' checked' : '') + '> Пускай автоматично при всеки нов контент план (КП-Автоматизация)</label>' +
      '<label>YouTube Data API ключ<input class="ca-input" id="caSYt" value="' + esc(s.ca_youtube_api_key) + '" placeholder="AIza…"></label>' +
      '<label>Apify токен (TikTok, Instagram, Facebook)<input class="ca-input" id="caSAp" value="' + esc(s.ca_apify_token) + '" placeholder="apify_api_…"></label>' +
      '<label>Apify актьор TikTok<input class="ca-input" id="caSAT" value="' + esc(s.ca_actor_tiktok) + '"></label>' +
      '<label>Apify актьор Instagram<input class="ca-input" id="caSAI" value="' + esc(s.ca_actor_instagram) + '"></label>' +
      '<label>Apify актьор Facebook<input class="ca-input" id="caSAF" value="' + esc(s.ca_actor_facebook) + '"></label>' +
      '<button class="btn btn-primary btn-sm" onclick="caSaveSettings()">Запази</button></div>');
  } catch (e) { caBody('<div class="ca-err">' + esc(e.message) + '</div>'); }
}

async function caSaveSettings() {
  try {
    await caApi('PUT', '/settings', {
      ca_enabled: document.getElementById('caSEn').checked, ca_auto_on_kp: document.getElementById('caSAuto').checked,
      ca_youtube_api_key: document.getElementById('caSYt').value, ca_apify_token: document.getElementById('caSAp').value,
      ca_actor_tiktok: document.getElementById('caSAT').value, ca_actor_instagram: document.getElementById('caSAI').value,
      ca_actor_facebook: document.getElementById('caSAF').value,
    });
    showToast('Запазено', 'success');
    renderContentSettings(document.getElementById('pageContent'));
  } catch (e) { showToast(e.message, 'error'); }
}
