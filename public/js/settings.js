// ==================== ГЛОБАЛНИ НАСТРОЙКИ (нов админ панел) ====================
// Чист панел — началото на новия админ. Първа секция: шрифт + основни цветове,
// прилагани глобално (за целия екип) през съществуващата theme машинария
// (saveTheme/applyThemeColors пишат в global settings + прилагат на живо).
// Старият панел остава достъпен на #/admin-legacy.

// Кирилично-съвместими качествени шрифтове (Google Fonts). „Системен" = base default.
var SG_FONTS = [
  { name: 'Системен', value: '' },
  { name: 'Inter', value: 'Inter' },
  { name: 'Manrope', value: 'Manrope' },
  { name: 'Onest', value: 'Onest' },
  { name: 'Golos Text', value: 'Golos Text' },
  { name: 'Rubik', value: 'Rubik' },
  { name: 'Montserrat', value: 'Montserrat' },
  { name: 'Nunito', value: 'Nunito' },
  { name: 'DM Sans', value: 'DM Sans' },
  { name: 'PT Sans', value: 'PT Sans' },
  { name: 'Roboto', value: 'Roboto' },
  { name: 'IBM Plex Sans', value: 'IBM Plex Sans' },
];

var SG_COLORS = [
  { key: 'theme_accent', def: '#1cb0f6', label: 'Акцент', hint: 'Линкове, бутони, фокус' },
  { key: 'theme_bg', def: '#0b151b', label: 'Фон на страницата' },
  { key: 'theme_bg_card', def: '#1b2930', label: 'Фон на карти и панели' },
  { key: 'theme_text', def: '#e8ecee', label: 'Основен текст' },
  { key: 'theme_green', def: '#22c55e', label: 'Зелено (успех)' },
  { key: 'theme_yellow', def: '#eab308', label: 'Жълто (внимание)' },
  { key: 'theme_red', def: '#ef4444', label: 'Червено (просрочено)' },
];

function _sgFontsLink() {
  var fams = SG_FONTS.filter(function (f) { return f.value; })
    .map(function (f) { return 'family=' + f.value.replace(/ /g, '+') + ':wght@400;600'; });
  return 'https://fonts.googleapis.com/css2?' + fams.join('&') + '&display=swap';
}
function _sgEnsureFontsLoaded() {
  if (document.getElementById('sg-fonts-preview')) return;
  var l = document.createElement('link');
  l.id = 'sg-fonts-preview'; l.rel = 'stylesheet'; l.href = _sgFontsLink();
  document.head.appendChild(l);
}

async function renderSettings(el) {
  if (currentUser && currentUser.role !== 'admin' && currentUser.role !== 'mini_admin') {
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--red)">Нямаш достъп до тази страница.</div>';
    return;
  }
  setBreadcrumb(null); el.className = '';
  _sgEnsureFontsLoaded();
  el.innerHTML =
    '<div class="sg-wrap">' +
      '<div class="sg-head">' +
        '<h1 class="sg-title">Глобални настройки</h1>' +
        '<span class="sg-hint">Прилага се на живо за целия екип.</span>' +
      '</div>' +
      '<div class="sg-section">' +
        '<div class="sg-section__hdr">Шрифт</div>' +
        '<div class="sg-section__desc">Избраният шрифт се прилага навсякъде в платформата.</div>' +
        '<div class="sg-fonts" id="sgFonts"></div>' +
      '</div>' +
      '<div class="sg-section">' +
        '<div class="sg-section__hdr">Основни цветове</div>' +
        '<div class="sg-section__desc">Промяната се вижда веднага. ↺ връща стойността по подразбиране.</div>' +
        '<div class="sg-colors" id="sgColors"></div>' +
      '</div>' +
      '<div class="sg-section">' +
        '<div class="sg-section__hdr">📅 Календар известия</div>' +
        '<div class="sg-section__desc">Ново събитие в Google Calendar → съобщение в Basecamp с тагнати създател и отговорници. Промяна или отмяна → коментар под същото съобщение. Никой друг не получава известие.</div>' +
        '<div id="gaBody"><div class="ga-loading">Зареждане…</div></div>' +
      '</div>' +
      '<div class="sg-foot">' +
        '<button class="btn btn-sm" onclick="sgResetAll()">↺ Нулирай темата</button>' +
        '<a class="sg-legacy" href="#/admin-legacy">Разширени / стар панел →</a>' +
      '</div>' +
    '</div>';
  sgRenderFonts();
  sgRenderColors();
  gaLoad();
}

// ==================== КАЛЕНДАР ИЗВЕСТИЯ (Google Calendar → Basecamp) ====================

var _gaData = null;

async function gaLoad() {
  var host = document.getElementById('gaBody');
  if (!host) return;
  try {
    var res = await fetch('/api/gcal-alerts/overview');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _gaData = await res.json();
    gaRender();
  } catch (e) {
    host.innerHTML = '<div style="color:var(--red);font-size:13px">Грешка при зареждане: ' + esc(e.message) + '</div>';
  }
}

function gaRender() {
  var host = document.getElementById('gaBody');
  if (!host || !_gaData) return;
  var d = _gaData;
  var html = '';

  // Глобален ред: on/off + Message Board линк
  html += '<div class="ga-row ga-row--config">' +
      '<label class="ga-toggle"><input type="checkbox" ' + (d.enabled ? 'checked' : '') + ' onchange="gaToggleEnabled(this.checked)"> Включено</label>' +
      '<input type="text" class="ga-input ga-input--board" id="gaBoardUrl" value="' + esc(d.boardUrl) + '" placeholder="Линк към Basecamp Message Board…">' +
      '<button class="btn btn-sm" onclick="gaSaveBoard()">Запази</button>' +
    '</div>';

  // Инструкция за споделяне
  html += '<div class="ga-share">Сподели всеки календар (Настройки → Споделяне с конкретни хора, „Вижда всички подробности") с:' +
      '<code class="ga-sa" id="gaSaEmail">' + esc(d.saEmail || 'няма credentials') + '</code>' +
      '<button class="ga-copy" title="Копирай" onclick="gaCopySa()">⧉</button>' +
    '</div>';

  // Календари
  html += '<div class="ga-feeds">';
  if (!d.feeds.length) html += '<div class="ga-empty">Няма добавени календари.</div>';
  d.feeds.forEach(function (f) {
    var status;
    if (f.last_error) status = '<span class="ga-status ga-status--err" title="' + esc(f.last_error) + '">⚠ ' + esc(f.last_error) + '</span>';
    else if (f.last_sync_at) status = '<span class="ga-status ga-status--ok">✓ Свързан · sync ' + esc(new Date(f.last_sync_at).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' })) + '</span>';
    else status = '<span class="ga-status">⏳ Очаква първи sync</span>';

    var chips = (f.responsibles || []).map(function (uid) {
      var u = d.users.find(function (x) { return x.id === uid; });
      return '<span class="ga-chip">' + esc(u ? u.name : '#' + uid) +
        '<button onclick="gaRemoveResponsible(' + f.id + ',' + uid + ')" title="Махни">✕</button></span>';
    }).join('');
    var opts = '<option value="">+ отговорник</option>' + d.users
      .filter(function (u) { return (f.responsibles || []).indexOf(u.id) === -1; })
      .map(function (u) { return '<option value="' + u.id + '">' + esc(u.name) + '</option>'; }).join('');

    html += '<div class="ga-feed' + (f.enabled ? '' : ' ga-feed--off') + '">' +
        '<div class="ga-feed__top">' +
          '<span class="ga-feed__name">' + esc(f.name || f.google_calendar_id) + '</span>' +
          status +
          '<span class="ga-feed__actions">' +
            '<button class="ga-btn" onclick="gaCheckFeed(' + f.id + ')" title="Провери достъпа">Провери</button>' +
            '<button class="ga-btn" onclick="gaToggleFeed(' + f.id + ',' + !f.enabled + ')">' + (f.enabled ? 'Пауза' : 'Пусни') + '</button>' +
            '<button class="ga-btn ga-btn--del" onclick="gaDeleteFeed(' + f.id + ')" title="Премахни">✕</button>' +
          '</span>' +
        '</div>' +
        '<div class="ga-feed__id">' + esc(f.google_calendar_id) + '</div>' +
        '<div class="ga-feed__resp">👥 ' + (chips || '<span class="ga-dim">няма отговорници</span>') +
          '<select class="ga-select" onchange="gaAddResponsible(' + f.id + ',this.value)">' + opts + '</select>' +
        '</div>' +
      '</div>';
  });
  html += '</div>';

  // Добавяне на календар
  html += '<div class="ga-row">' +
      '<input type="text" class="ga-input" id="gaNewCal" placeholder="Calendar ID или embed линк (…?src=…)">' +
      '<button class="btn btn-sm" onclick="gaAddFeed()">Добави календар</button>' +
    '</div>';

  // Съответствия Google имейл ↔ потребител
  html += '<div class="ga-map">' +
      '<div class="ga-map__hdr">Съответствия на имейли <span class="ga-dim">— само когато Google имейлът е различен от Basecamp имейла</span></div>';
  d.personMap.forEach(function (m) {
    html += '<div class="ga-map__row"><code>' + esc(m.google_email) + '</code> → ' + esc(m.user_name) +
      ' <button class="ga-btn ga-btn--del" onclick="gaDelMap(\'' + esc(m.google_email).replace(/'/g, "\\'") + '\')">✕</button></div>';
  });
  html += '<div class="ga-row">' +
      '<input type="text" class="ga-input" id="gaMapEmail" placeholder="google имейл">' +
      '<select class="ga-select" id="gaMapUser">' +
        d.users.map(function (u) { return '<option value="' + u.id + '">' + esc(u.name) + '</option>'; }).join('') +
      '</select>' +
      '<button class="btn btn-sm" onclick="gaAddMap()">Добави</button>' +
    '</div></div>';

  // Действия
  html += '<div class="ga-row ga-row--foot">' +
      '<button class="btn btn-sm" onclick="gaTest(this)">🔧 Тест към Basecamp</button>' +
      '<button class="btn btn-sm" onclick="gaSyncNow(this)">🔄 Синхронизирай сега</button>' +
    '</div>';

  host.innerHTML = html;
}

async function _gaCall(url, method, body) {
  var res = await fetch(url, {
    method: method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  var j = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
  return j;
}

function gaToggleEnabled(on) {
  _gaCall('/api/gcal-alerts/config', 'PUT', { enabled: on })
    .then(function () { _gaData.enabled = on; showToast(on ? 'Календар известията са включени.' : 'Календар известията са спрени.', 'success'); })
    .catch(function (e) { showToast(e.message, 'error'); gaLoad(); });
}

function gaSaveBoard() {
  var v = (document.getElementById('gaBoardUrl') || {}).value || '';
  _gaCall('/api/gcal-alerts/config', 'PUT', { boardUrl: v })
    .then(function () { showToast('Message Board е запазен.', 'success'); gaLoad(); })
    .catch(function (e) { showToast(e.message, 'error'); });
}

function gaCopySa() {
  var el = document.getElementById('gaSaEmail');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(function () { showToast('Копирано.', 'success', 1500); });
}

function gaAddFeed() {
  var v = (document.getElementById('gaNewCal') || {}).value || '';
  if (!v.trim()) return;
  _gaCall('/api/gcal-alerts/feeds', 'POST', { calendar: v })
    .then(function (r) {
      showToast(r.access && r.access.ok ? 'Календарът е добавен и достъпен ✓' : 'Добавен, но няма достъп — сподели го със service account имейла.', r.access && r.access.ok ? 'success' : 'info', 6000);
      gaLoad();
    })
    .catch(function (e) { showToast(e.message, 'error'); });
}

function gaCheckFeed(id) {
  _gaCall('/api/gcal-alerts/feeds/' + id + '/check', 'POST')
    .then(function (r) {
      showToast(r.access.ok ? 'Достъпът е ОК ✓' : r.access.error, r.access.ok ? 'success' : 'error', 5000);
      gaLoad();
    })
    .catch(function (e) { showToast(e.message, 'error'); });
}

function gaToggleFeed(id, on) {
  _gaCall('/api/gcal-alerts/feeds/' + id, 'PUT', { enabled: on }).then(gaLoad)
    .catch(function (e) { showToast(e.message, 'error'); });
}

function gaDeleteFeed(id) {
  if (!confirm('Да премахна ли този календар от следенето?')) return;
  _gaCall('/api/gcal-alerts/feeds/' + id, 'DELETE').then(gaLoad)
    .catch(function (e) { showToast(e.message, 'error'); });
}

function _gaSetResponsibles(feedId, list) {
  _gaCall('/api/gcal-alerts/feeds/' + feedId, 'PUT', { responsibles: list }).then(gaLoad)
    .catch(function (e) { showToast(e.message, 'error'); });
}

function gaAddResponsible(feedId, val) {
  if (!val) return;
  var f = _gaData.feeds.find(function (x) { return x.id === feedId; });
  _gaSetResponsibles(feedId, (f.responsibles || []).concat([parseInt(val)]));
}

function gaRemoveResponsible(feedId, uid) {
  var f = _gaData.feeds.find(function (x) { return x.id === feedId; });
  _gaSetResponsibles(feedId, (f.responsibles || []).filter(function (x) { return x !== uid; }));
}

function gaAddMap() {
  var email = (document.getElementById('gaMapEmail') || {}).value || '';
  var uid = (document.getElementById('gaMapUser') || {}).value;
  if (!email.trim() || !uid) return;
  _gaCall('/api/gcal-alerts/person-map', 'PUT', { google_email: email, user_id: parseInt(uid) }).then(gaLoad)
    .catch(function (e) { showToast(e.message, 'error'); });
}

function gaDelMap(email) {
  _gaCall('/api/gcal-alerts/person-map', 'PUT', { google_email: email, user_id: null }).then(gaLoad)
    .catch(function (e) { showToast(e.message, 'error'); });
}

function gaTest(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Изпращане…'; }
  _gaCall('/api/gcal-alerts/test', 'POST')
    .then(function (r) { showToast('Тестовото съобщение е публикувано в Basecamp ✓', 'success', 6000); })
    .catch(function (e) { showToast('Грешка: ' + e.message, 'error', 8000); })
    .finally(function () { if (btn) { btn.disabled = false; btn.textContent = '🔧 Тест към Basecamp'; } });
}

function gaSyncNow(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sync…'; }
  _gaCall('/api/gcal-alerts/sync', 'POST')
    .then(function () { showToast('Sync завърши.', 'success'); gaLoad(); })
    .catch(function (e) { showToast(e.message, 'error'); })
    .finally(function () { if (btn) { btn.disabled = false; btn.textContent = '🔄 Синхронизирай сега'; } });
}

function sgRenderFonts() {
  var host = document.getElementById('sgFonts');
  if (!host) return;
  var cur = _platformConfig.theme_font_family || '';
  host.innerHTML = SG_FONTS.map(function (f) {
    var active = (f.value === cur) ? ' sg-font--active' : '';
    var ff = f.value ? ("'" + f.value + "', sans-serif") : 'var(--font-family)';
    return '<button type="button" class="sg-font' + active + '" style="font-family:' + ff + '" onclick="sgApplyFont(\'' + f.value + '\')">' +
      '<span class="sg-font__name">' + esc(f.name) + '</span>' +
      '<span class="sg-font__sample">Аа Бб Вв Гг 123</span>' +
    '</button>';
  }).join('');
}

function sgApplyFont(value) {
  if (value) saveTheme('theme_font_family', value);
  else resetTheme('theme_font_family', ''); // back to system default (--font-family from base.css)
  sgRenderFonts();
}

function sgRenderColors() {
  var host = document.getElementById('sgColors');
  if (!host) return;
  var s = _platformConfig;
  host.innerHTML = SG_COLORS.map(function (it) {
    var val = s[it.key] || it.def;
    return '<div class="sg-color">' +
      '<div class="sg-color__label">' + esc(it.label) +
        (it.hint ? '<span class="sg-color__hint">' + esc(it.hint) + '</span>' : '') +
      '</div>' +
      '<div class="sg-color__ctl">' +
        '<input type="color" class="sg-color__pick" id="' + it.key + '_picker" value="' + esc(val) + '" ' +
          'oninput="previewTheme(\'' + it.key + '\',this.value)" onchange="saveTheme(\'' + it.key + '\',this.value)">' +
        '<input type="text" class="sg-color__txt" id="' + it.key + '_text" value="' + esc(val) + '" ' +
          'onblur="saveTheme(\'' + it.key + '\',this.value,true)">' +
        '<button class="sg-color__reset" onclick="resetTheme(\'' + it.key + '\',\'' + it.def + '\')" title="По подразбиране">↺</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function sgResetAll() {
  if (typeof resetAllTheme === 'function') resetAllTheme();
  renderSettings(document.getElementById('pageContent'));
}
