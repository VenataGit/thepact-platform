// ==================== ГЛОБАЛНИ НАСТРОЙКИ (админ панел) ====================
// Панелът е разделен на подменюта (лява навигация): #/admin/<секция>.
//   🎨 Тема               — шрифт + основни цветове (+ разширена персонализация)
//   👥 Екип и роли        — хора, позиции, профили и права
//   📋 КП-Автоматизация   — къде отиват КП картите (Basecamp), текстове, дати, график
//   🧾 Създаване на задачи — шаблони и стъпки за инструмента в More + кой какво е поръчвал
//   🗂 Dashboard          — кои Card Tables виждат всички
//   📅 Производствен календар — календарите за снимки + известията GCal → Basecamp
//   📊 Резултати          — известие, когато всички видеа по един КП са публикувани
//   📄 Таблица известия   — Google Sheets (Apps Script) → Basecamp
//   🤖 PM Agent           — одит и синхрон
//   🛠 Система            — дневен отчет, коментари, Google Calendar синхрон, логика
// Менюто „Настройки" (More) се вижда от всички, но самият панел е само за админи —
// на останалите излиза съобщението SG_NO_ACCESS_MSG. Старият панел (#/admin-legacy)
// е премахнат — всичките му живи настройки са в секциите горе.

var SG_NO_ACCESS_MSG = 'Настройките са налични само за потребителите с администраторски права. Моля, свържи се с администратор, при нужда от помощ.';

// Пълен админ или мини админ — само те могат да отворят панела.
function sgHasSettingsAccess() {
  return !!(typeof currentUser !== 'undefined' && currentUser &&
    (currentUser.role === 'admin' || currentUser.role === 'mini_admin'));
}

// Клик върху „Настройки" в More: за админ пуска линка, за останалите показва
// съобщението и не навигира.
function sgOpenSettings(e) {
  if (typeof closeAllDropdowns === 'function') closeAllDropdowns();
  if (sgHasSettingsAccess()) return true;
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (typeof showToast === 'function') showToast(SG_NO_ACCESS_MSG, 'error', 8000);
  return false;
}

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

// Секциите на панела. adminOnly секциите се виждат само от пълен админ.
var SG_SECTIONS = [
  { id: 'theme', icon: '🎨', label: 'Тема', hint: 'Шрифт и цветове', adminOnly: false },
  { id: 'team', icon: '👥', label: 'Екип и роли', hint: 'Позиции и профили', adminOnly: true },
  { id: 'kp', icon: '📋', label: 'КП-Автоматизация', hint: 'Basecamp, текстове, график', adminOnly: true },
  { id: 'tasks', icon: '🧾', label: 'Създаване на задачи', hint: 'Шаблони, стъпки, история', adminOnly: true },
  { id: 'dashboard', icon: '🗂', label: 'Dashboard', hint: 'Дъски за всички', adminOnly: true },
  { id: 'calendar', icon: '📅', label: 'Производствен календар', hint: 'Календари за снимки + известия', adminOnly: false },
  { id: 'results', icon: '📊', label: 'Резултати', hint: 'Известие при изпубликуван КП', adminOnly: true },
  { id: 'sheets', icon: '📄', label: 'Таблица известия', hint: 'Google Sheets → Basecamp', adminOnly: true },
  { id: 'agent', icon: '🤖', label: 'PM Agent', hint: 'Одит и синхрон', adminOnly: true },
  { id: 'system', icon: '🛠', label: 'Система', hint: 'Отчет, коментари, логика', adminOnly: true },
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

async function renderSettings(el, sub) {
  if (currentUser && !sgHasSettingsAccess()) {
    el.innerHTML =
      '<div class="sg-wrap">' +
        '<div class="sg-noaccess">' +
          '<div class="sg-noaccess__icon">🔒</div>' +
          '<div class="sg-noaccess__txt">' + esc(SG_NO_ACCESS_MSG) + '</div>' +
        '</div>' +
      '</div>';
    return;
  }
  setBreadcrumb(null); el.className = '';
  var isFullAdmin = currentUser && currentUser.role === 'admin';
  var sections = SG_SECTIONS.filter(function (s) { return !s.adminOnly || isFullAdmin; });
  var active = sections.some(function (s) { return s.id === sub; }) ? sub : sections[0].id;

  el.innerHTML =
    '<div class="sg-wrap sg-wrap--split">' +
      '<div class="sg-head">' +
        '<h1 class="sg-title">Настройки</h1>' +
        '<span class="sg-hint">Прилагат се за целия екип.</span>' +
      '</div>' +
      '<div class="sg-layout">' +
        '<nav class="sg-nav">' +
          sections.map(function (s) {
            return '<a class="sg-nav__item' + (s.id === active ? ' sg-nav__item--active' : '') + '" href="#/admin/' + s.id + '">' +
              '<span class="sg-nav__icon">' + s.icon + '</span>' +
              '<span class="sg-nav__txt"><span class="sg-nav__label">' + esc(s.label) + '</span>' +
              '<span class="sg-nav__hint">' + esc(s.hint) + '</span></span>' +
            '</a>';
          }).join('') +
        '</nav>' +
        '<div class="sg-body" id="sgBody"></div>' +
      '</div>' +
    '</div>';

  var body = document.getElementById('sgBody');
  if (active === 'theme') sgSectionTheme(body);
  else if (active === 'team') sgSectionTeam(body);
  else if (active === 'kp') sgSectionKp(body);
  else if (active === 'tasks') sgSectionTasks(body);
  else if (active === 'dashboard') sgSectionDashboard(body);
  else if (active === 'calendar') sgSectionCalendar(body);
  else if (active === 'results') sgSectionResults(body);
  else if (active === 'sheets') sgSectionSheets(body);
  else if (active === 'agent') sgSectionAgent(body);
  else if (active === 'system') sgSectionSystem(body);
}

// ==================== СЕКЦИЯ: ТЕМА ====================

function sgSectionTheme(host) {
  _sgEnsureFontsLoaded();
  host.innerHTML =
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
      '<details class="sg-adv" ontoggle="if(this.open) sgLoadAdvancedTheme()">' +
        '<summary class="sg-adv__sum">🎛 Разширена персонализация' +
          '<span class="ga-dim"> — всеки цвят и размер по компоненти (нав, карти, дъски…)</span></summary>' +
        '<div class="sg-adv__body" id="adminColorsContent"></div>' +
      '</details>' +
    '</div>' +
    '<div class="sg-foot">' +
      '<button class="btn btn-sm" onclick="sgResetAll()">↺ Нулирай темата</button>' +
    '</div>';
  sgRenderFonts();
  sgRenderColors();
}

// Разширената персонализация (старият таб „Персонализация") се чертае чак при
// отваряне — иначе всеки път се строи излишно голям DOM.
function sgLoadAdvancedTheme() {
  var host = document.getElementById('adminColorsContent');
  if (!host || host.getAttribute('data-loaded') === '1') return;
  host.setAttribute('data-loaded', '1');
  if (typeof loadAdminColors === 'function') loadAdminColors();
}

// ==================== СЕКЦИЯ: DASHBOARD ДЪСКИ ====================

function sgSectionDashboard(host) {
  host.innerHTML =
    '<div class="sg-section">' +
      '<div class="sg-section__hdr">🗂 Dashboard — дъски</div>' +
      '<div class="sg-section__desc">Кои Card Tables от Video Production се показват на Dashboard-а на <b>всички</b>. Нов процес в Basecamp се появява тук автоматично — само го включи. Отделно всеки сам решава кои от включените да вижда (⚙ и бутоните ─ ▢ на самия Dashboard).</div>' +
      '<div id="sgDashBoards"><div class="ga-loading">Зареждане…</div></div>' +
    '</div>';
  sgDashBoardsLoad();
}

// ==================== СЕКЦИЯ: КАЛЕНДАР ИЗВЕСТИЯ ====================

function sgSectionCalendar(host) {
  host.innerHTML =
    '<div class="sg-section">' +
      '<div class="sg-section__hdr">📅 Производствен календар</div>' +
      '<div class="sg-section__desc">Календарите тук се показват в <a href="#/calendar">Производствения календар</a> и в тях се насрочват снимачните дни. Същите календари пораждат и известия: ново събитие в Google Calendar → съобщение в Basecamp с тагнати създател и отговорници; промяна или отмяна → коментар под същото съобщение. Никой друг не получава известие.</div>' +
      '<div id="gaBody"><div class="ga-loading">Зареждане…</div></div>' +
    '</div>';
  gaLoad();
}

// ==================== СЕКЦИЯ: РЕЗУЛТАТИ ====================

function sgSectionResults(host) {
  host.innerHTML =
    '<div class="sg-section">' +
      '<div class="sg-section__hdr">📊 Известия за резултати</div>' +
      '<div class="sg-section__desc">Когато всички видеа по един контент план са публикувани, ботът пише в Basecamp, че е време да подготвим резултати за клиента — и казва за кой период. Периодът е от датата на публикуване на първото видео до последното + 3 дни. Известието идва в деня, в който периодът приключва.</div>' +
      '<div id="krBody"><div class="ga-loading">Зареждане…</div></div>' +
    '</div>';
  krLoad();
}

var _krData = null;

async function krLoad() {
  var host = document.getElementById('krBody');
  if (!host) return;
  try {
    var res = await fetch('/api/kp-results/overview');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _krData = await res.json();
    krRender();
  } catch (e) {
    host.innerHTML = '<div style="color:var(--red);font-size:13px">Грешка при зареждане: ' + esc(e.message) + '</div>';
  }
}

function krRender() {
  var host = document.getElementById('krBody');
  if (!host || !_krData) return;
  var d = _krData;
  var team = d.team || [];
  var html = '';

  // Включено + Message Board
  html += '<div class="ga-row ga-row--config">' +
      '<label class="ga-toggle"><input type="checkbox" ' + (d.enabled ? 'checked' : '') + ' onchange="krToggleEnabled(this.checked)"> Включено</label>' +
      '<input type="text" class="ga-input ga-input--board" id="krBoardUrl" value="' + esc(d.boardUrl) + '" placeholder="Линк към Basecamp Message Board…">' +
      '<button class="btn btn-sm" onclick="krSaveBoard()">Запази</button>' +
    '</div>';
  if (!d.boardUrl) {
    html += '<div class="ga-empty" style="color:var(--yellow)">Постави линк към Message Board-а, в който да излизат известията — иначе не може да се включи.</div>';
  }
  if (d.since) {
    html += '<div class="ga-share">Обявяват се само КП-та, чийто период приключва след <strong>' + esc(d.since) + '</strong> (денят на включване) — за да не се изсипят наведнъж всички стари планове.</div>';
  }

  // Кога и как
  html += '<div class="ga-row ga-row--config">' +
      '<label class="ga-toggle">Проверка всеки ден в <input type="text" class="ga-input" style="width:70px" id="krTime" value="' + esc(d.time) + '"> BG</label>' +
      '<label class="ga-toggle"><input type="text" class="ga-input" style="width:56px" id="krDaysAfter" value="' + String(d.daysAfter) + '"> календарни дни след последното видео</label>' +
      '<button class="btn btn-sm" onclick="krSaveTiming()">Запази</button>' +
    '</div>';

  // Картата „Резултати"
  var destTxt = d.dest
    ? esc((d.dest.boardTitle || 'дъска #' + d.dest.boardId) + ' → ' + (d.dest.columnTitle || 'колона #' + d.dest.columnId)) + (d.dest.auto ? ' <span class="ga-dim">(авто-открита)</span>' : '')
    : '<span style="color:var(--yellow)">' + esc(d.destError || 'няма') + '</span>';
  html += '<div class="ga-add">' +
      '<div class="ga-add__hdr">📋 Задача „Резултати"</div>' +
      '<div class="ga-row" style="margin-top:6px">' +
        '<label class="ga-toggle"><input type="checkbox" ' + (d.cardEnabled ? 'checked' : '') + ' onchange="krToggleCard(this.checked)"> Създавай карта</label>' +
        '<label class="ga-toggle">срок <input type="text" class="ga-input" style="width:56px" id="krCardWorkdays" value="' + String(d.cardWorkdays) + '"> работни дни</label>' +
        '<input type="text" class="ga-input" id="krCardTitle" value="' + esc(d.cardTitle) + '" placeholder="{клиент} КП-{номер} - Резултати">' +
        '<button class="btn btn-sm" onclick="krSaveCard()">Запази</button>' +
      '</div>' +
      '<div class="ga-share">Отива в: ' + destTxt + '</div>' +
    '</div>';

  // Отговорници (екипът е споделен с Календар известията)
  var chips = (d.responsibles || []).map(function (pid) {
    var p = team.find(function (x) { return String(x.person_id) === String(pid); });
    return '<span class="ga-chip">' + esc(p ? p.name : '#' + pid) +
      '<button onclick="krRemoveResponsible(\'' + String(pid) + '\')" title="Махни">✕</button></span>';
  }).join('');
  var opts = '<option value="">+ отговорник</option>' + team
    .filter(function (p) { return (d.responsibles || []).indexOf(String(p.person_id)) === -1; })
    .map(function (p) { return '<option value="' + String(p.person_id) + '">' + esc(p.name) + '</option>'; }).join('');
  html += '<div class="ga-feed">' +
      '<div class="ga-feed__resp">👥 Тагват се: ' + (chips || '<span class="ga-dim">никой — известието ще е само в борда</span>') +
        '<select class="ga-select" onchange="krAddResponsible(this.value)">' + opts + '</select>' +
        '<button class="ga-btn" onclick="krRefreshTeam(this)">🔄 Обнови екипа</button>' +
      '</div>' +
    '</div>';

  // Последни известия
  if ((d.history || []).length) {
    html += '<div class="ga-map"><div class="ga-map__hdr">Последни известия</div>';
    d.history.forEach(function (h) {
      html += '<div class="ga-map__row">' + esc(h.client_name) + ' <strong>КП-' + h.kp + '</strong> · ' +
        esc(krBg(h.range_start)) + ' – ' + esc(krBg(h.range_end)) + ' · ' + h.videos_count + ' видеа ' +
        '<span class="ga-dim">' + esc(new Date(h.announced_at).toLocaleDateString('bg-BG')) + '</span></div>';
    });
    html += '</div>';
  }

  html += '<div class="ga-row ga-row--foot">' +
      '<button class="btn btn-sm" onclick="krPreview(this)">👁 Преглед (без писане)</button>' +
      '<button class="btn btn-sm" onclick="krRun(this)">▶ Провери сега</button>' +
      '<button class="btn btn-sm" onclick="krTest(this)">🔧 Тест към Basecamp</button>' +
    '</div>' +
    '<div id="krPreviewBox"></div>';

  host.innerHTML = html;
}

function krBg(v) {
  if (!v) return '—';
  var p = String(v).slice(0, 10).split('-');
  return p[2] + '.' + p[1] + '.' + p[0];
}

function krToggleEnabled(on) {
  _gaCall('/api/kp-results/config', 'PUT', { enabled: on })
    .then(function () { showToast(on ? 'Известията за резултати са включени.' : 'Известията за резултати са спрени.', 'success'); krLoad(); })
    .catch(function (e) { showToast(e.message, 'error', 6000); krLoad(); });
}

function krToggleCard(on) {
  _gaCall('/api/kp-results/config', 'PUT', { cardEnabled: on })
    .then(function () { _krData.cardEnabled = on; showToast(on ? 'Ще се създава карта „Резултати".' : 'Картата няма да се създава.', 'success'); })
    .catch(function (e) { showToast(e.message, 'error'); krLoad(); });
}

function krSaveBoard() {
  var el = document.getElementById('krBoardUrl');
  _gaCall('/api/kp-results/config', 'PUT', { boardUrl: el ? el.value : '' })
    .then(function () { showToast('Message Board-ът е запазен.', 'success'); krLoad(); })
    .catch(function (e) { showToast(e.message, 'error', 6000); });
}

function krSaveTiming() {
  var t = document.getElementById('krTime'), da = document.getElementById('krDaysAfter');
  _gaCall('/api/kp-results/config', 'PUT', { time: t ? t.value : undefined, daysAfter: da ? da.value : undefined })
    .then(function () { showToast('Запазено.', 'success'); krLoad(); })
    .catch(function (e) { showToast(e.message, 'error', 6000); });
}

function krSaveCard() {
  var w = document.getElementById('krCardWorkdays'), t = document.getElementById('krCardTitle');
  _gaCall('/api/kp-results/config', 'PUT', { cardWorkdays: w ? w.value : undefined, cardTitle: t ? t.value : undefined })
    .then(function () { showToast('Запазено.', 'success'); krLoad(); })
    .catch(function (e) { showToast(e.message, 'error', 6000); });
}

function krAddResponsible(pid) {
  if (!pid) return;
  _gaCall('/api/kp-results/responsibles', 'POST', { personId: pid })
    .then(function () { krLoad(); })
    .catch(function (e) { showToast(e.message, 'error'); });
}

function krRemoveResponsible(pid) {
  _gaCall('/api/kp-results/responsibles/' + pid, 'DELETE')
    .then(function () { krLoad(); })
    .catch(function (e) { showToast(e.message, 'error'); });
}

function krRefreshTeam(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  _gaCall('/api/kp-results/refresh-people', 'POST')
    .then(function (r) { showToast('Екипът е обновен: ' + r.count + ' души.', 'success'); krLoad(); })
    .catch(function (e) { showToast('Грешка: ' + e.message, 'error', 6000); })
    .finally(function () { if (btn) { btn.disabled = false; btn.textContent = '🔄 Обнови екипа'; } });
}

var KR_ACTION_TXT = {
  announce: '<span style="color:var(--green)">ще се обяви сега</span>',
  pending: 'чака края на периода',
  announced: '<span class="ga-dim">вече обявено</span>',
  change: '<span style="color:var(--yellow)">периодът се е променил → коментар</span>',
  'skipped-old': '<span class="ga-dim">старо (преди включването)</span>',
};

function krRenderPreview(data) {
  var box = document.getElementById('krPreviewBox');
  if (!box) return;
  var items = data.items || [];
  if (!items.length) { box.innerHTML = '<div class="ga-empty">Няма контент планове с видеа в Basecamp.</div>'; return; }
  var html = '<div class="ga-map"><div class="ga-map__hdr">Преглед към ' + esc(data.today) + ' <span class="ga-dim">— нищо не е записано</span></div>';
  items.forEach(function (i) {
    var what = i.status === 'no-dates'
      ? '<span style="color:var(--yellow)">няма дати (' + esc(i.note || '') + ')</span>'
      : (KR_ACTION_TXT[i.action] || esc(i.action || ''));
    html += '<div class="ga-map__row">' + esc(i.client) + ' <strong>КП-' + i.kp + '</strong> · ' +
      (i.start ? esc(krBg(i.start)) + ' – ' + esc(krBg(i.end)) : '—') + ' · ' + i.videosCount + ' видеа' +
      (i.mismatch ? ' <span style="color:var(--yellow)" title="По плана има повече видеа, отколкото карти">⚠ ' + i.cardVideos + '/' + i.planVideos + '</span>' : '') +
      ' → ' + what + '</div>';
  });
  html += '</div>';
  box.innerHTML = html;
}

function krPreview(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  fetch('/api/kp-results/preview')
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; }); })
    .then(krRenderPreview)
    .catch(function (e) { showToast('Грешка: ' + e.message, 'error', 6000); })
    .finally(function () { if (btn) { btn.disabled = false; btn.textContent = '👁 Преглед (без писане)'; } });
}

function krRun(btn) {
  if (!confirm('Да пусна проверката сега? Ако има готов КП, ботът ще напише известие в Basecamp.')) return;
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  _gaCall('/api/kp-results/run', 'POST')
    .then(function (r) {
      if (r.skipped) showToast('Пропуснато: ' + r.skipped, 'error');
      else showToast('Готово: ' + (r.announced || []).length + ' нови известия, ' + (r.changed || []).length + ' промени.', 'success');
      krRenderPreview(r); krLoad();
    })
    .catch(function (e) { showToast('Грешка: ' + e.message, 'error', 6000); })
    .finally(function () { if (btn) { btn.disabled = false; btn.textContent = '▶ Провери сега'; } });
}

function krTest(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  _gaCall('/api/kp-results/test', 'POST')
    .then(function () { showToast('Тестовото съобщение е публикувано в Basecamp.', 'success'); })
    .catch(function (e) { showToast('Грешка: ' + e.message, 'error', 6000); })
    .finally(function () { if (btn) { btn.disabled = false; btn.textContent = '🔧 Тест към Basecamp'; } });
}

// ==================== СЕКЦИЯ: КП-АВТОМАТИЗАЦИЯ ====================
// Настройки за създаването на КП (контент план) карти: дестинация в Basecamp
// (дъска/колона), заглавие и текстове, дати, авто-график. Самите клиенти са на #/kp-auto.

var _kpAdm = null; // { s: settings, tpl: {template, videoSection}, boards: [...] | null, bcError, localBoards }

// ==================== СЕКЦИЯ: ТАБЛИЦА ИЗВЕСТИЯ ====================
// Клиентът Re/Shape работи в Google Sheets, не в Basecamp. Скрипт в самата
// таблица праща всяка редакция насам, а тук се решава кое е важно и кой се тагва.

function sgSectionSheets(host) {
  host.innerHTML =
    '<div class="sg-section">' +
      '<div class="sg-section__hdr">📄 Известия от таблица</div>' +
      '<div class="sg-section__desc">Промяна в Google Sheets → съобщение в Basecamp. Едно видео (ред) = една нишка: първата важна промяна отваря съобщение, следващите се закачат като коментари под него. Работи за <b>всички шийтове</b> в таблицата, включително новодобавените, и казва за кой шийт се отнася.</div>' +
      '<div id="shBody"><div class="ga-loading">Зареждане…</div></div>' +
    '</div>';
  shLoad();
}

var _shData = null;

async function shLoad() {
  var host = document.getElementById('shBody');
  if (!host) return;
  try {
    var res = await fetch('/api/sheet-alerts/overview');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _shData = await res.json();
    shRender();
  } catch (e) {
    host.innerHTML = '<div style="color:var(--red);font-size:13px">Грешка при зареждане: ' + esc(e.message) + '</div>';
  }
}

function shRender() {
  var host = document.getElementById('shBody');
  if (!host || !_shData) return;
  var d = _shData;
  var team = d.team || [];
  var html = '';

  // Включено + Message Board
  html += '<div class="ga-row ga-row--config">' +
      '<label class="ga-toggle"><input type="checkbox" ' + (d.enabled ? 'checked' : '') + ' onchange="shToggleEnabled(this.checked)"> Включено</label>' +
      '<input type="text" class="ga-input ga-input--board" id="shBoardUrl" value="' + esc(d.boardUrl) + '" placeholder="Линк към Basecamp Message Board…">' +
      '<button class="btn btn-sm" onclick="shSaveBoard()">Запази</button>' +
    '</div>';
  if (!d.boardUrl) {
    html += '<div class="ga-empty" style="color:var(--yellow)">Постави линк към Message Board-а, в който да излизат известията — иначе не може да се включи.</div>';
  }

  // Инсталация в таблицата
  html += '<div class="ga-add">' +
      '<div class="ga-add__hdr">🔌 Инсталиране в таблицата</div>' +
      '<div class="ga-share">В таблицата: <b>Разширения → Apps Script</b> → изтрий каквото е вътре → постави кода долу → избери функцията <code>pactSetup</code> и натисни <b>Run</b> → одобри достъпа. Това се прави <b>веднъж</b>; след това всяка промяна по настройките тук важи веднага, без пипане на скрипта.</div>' +
      '<div class="ga-share" style="color:var(--yellow)"><b>Ако скриптът е сложен преди 30.07.2026 — постави го наново.</b> Старата версия пращаше само първия ред като заглавен, а в плана отгоре стои заглавие, затова колоните излизаха като „Колона 5" и <b>нито една не се разпознаваше като важна</b>. Новата праща горните редове и сървърът сам намира заглавния ред.</div>' +
      '<div class="ga-row" style="margin-top:6px">' +
        '<input type="text" class="ga-input ga-input--board" id="shHookUrl" value="' + esc(d.hookUrl) + '" readonly>' +
        '<button class="btn btn-sm" onclick="shCopy(\'shHookUrl\')">📋 Копирай адреса</button>' +
      '</div>' +
      '<textarea id="shScript" class="ga-input" readonly rows="10" style="width:100%;margin-top:8px;font-family:monospace;font-size:11px;white-space:pre">' + esc(d.script) + '</textarea>' +
      '<div class="ga-row" style="margin-top:6px">' +
        '<button class="btn btn-sm" onclick="shCopy(\'shScript\')">📋 Копирай скрипта</button>' +
        '<span class="ga-dim">Адресът съдържа тайна — не го публикувай никъде другаде.</span>' +
      '</div>' +
    '</div>';

  // Кое е важно
  html += '<div class="ga-add">' +
      '<div class="ga-add__hdr">⭐ Кои промени пораждат известие</div>' +
      '<div class="ga-row" style="margin-top:6px">' +
        '<label class="ga-toggle" style="flex:1">Важни колони <input type="text" class="ga-input" id="shImportant" value="' + esc(d.important) + '" placeholder="одобрение, коментар"></label>' +
        '<button class="btn btn-sm" onclick="shSaveCols()">Запази</button>' +
      '</div>' +
      '<div class="ga-row" style="margin-top:6px">' +
        '<label class="ga-toggle" style="flex:1">Име на видеото идва от <input type="text" class="ga-input" id="shTitleCols" value="' + esc(d.titleCols) + '" placeholder="име, видео, заглавие"></label>' +
      '</div>' +
      '<div class="ga-share">Колоните се търсят по <b>съдържание в името на заглавния ред</b>, не по позиция — вмъкната колона не чупи нищо. Разделяй със запетая.</div>' +
      '<div class="ga-row" style="margin-top:6px">' +
        '<label class="ga-toggle"><input type="checkbox" ' + (d.allChanges ? 'checked' : '') + ' onchange="shToggleAll(this.checked)"> Известие при <b>всяка</b> промяна (шумно)</label>' +
        '<label class="ga-toggle">Изчакване <input type="text" class="ga-input" style="width:56px" id="shDelay" value="' + String(d.delay) + '"> сек.</label>' +
        '<button class="btn btn-sm" onclick="shSaveDelay()">Запази</button>' +
      '</div>' +
      '<div class="ga-share">Изчакването събира няколко бързи редакции по един и същи ред в едно известие, вместо да пуска по едно на всяка клетка.</div>' +
    '</div>';

  // Игнорирани акаунти — спирачката срещу „някой пренарежда датите на всички видеа".
  var seen = (d.seenEditors || []).filter(function (m) {
    return (d.ignored || '').toLowerCase().indexOf(String(m).toLowerCase()) === -1;
  });
  var seenOpts = '<option value="">+ игнорирай видян акаунт</option>' +
    seen.map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + '</option>'; }).join('');
  html += '<div class="ga-add">' +
      '<div class="ga-add__hdr">🙈 Игнорирани акаунти</div>' +
      '<div class="ga-row" style="margin-top:6px">' +
        '<input type="text" class="ga-input ga-input--board" id="shIgnored" value="' + esc(d.ignored) + '" placeholder="@thepact.bg, ivan@example.com">' +
        '<button class="btn btn-sm" onclick="shSaveIgnored()">Запази</button>' +
        (seen.length ? '<select class="ga-select" onchange="shIgnoreEditor(this.value)">' + seenOpts + '</select>' : '') +
      '</div>' +
      '<div class="ga-share">Промените от тези акаунти <b>не пораждат известия</b> — само се записват в дневника отдолу. Приема цял имейл (<code>ivan@thepact.bg</code>) или цял домейн (<code>@thepact.bg</code>), разделени със запетая. Празно = известия от всички.</div>' +
      '<div class="ga-share">Така пренареждането на дати от екипа не залива борда. <b>Внимание:</b> Google дава имейла на редактора надеждно само за акаунти от нашия домейн — при външен редактор полето често е празно, а празен имейл никога не се игнорира (иначе одобренията на клиента биха изчезнали).</div>' +
    '</div>';

  // Отговорници
  var chips = (d.responsibles || []).map(function (pid) {
    var p = team.find(function (x) { return String(x.person_id) === String(pid); });
    return '<span class="ga-chip">' + esc(p ? p.name : '#' + pid) +
      '<button onclick="shRemoveResponsible(\'' + String(pid) + '\')" title="Махни">✕</button></span>';
  }).join('');
  var opts = '<option value="">+ отговорник</option>' + team
    .filter(function (p) { return (d.responsibles || []).indexOf(String(p.person_id)) === -1; })
    .map(function (p) { return '<option value="' + String(p.person_id) + '">' + esc(p.name) + '</option>'; }).join('');
  html += '<div class="ga-feed">' +
      '<div class="ga-feed__resp">👥 Тагват се и се абонират: ' + (chips || '<span class="ga-dim">никой — известието стои само в борда</span>') +
        '<select class="ga-select" onchange="shAddResponsible(this.value)">' + opts + '</select>' +
        '<button class="ga-btn" onclick="shRefreshTeam(this)">🔄 Обнови екипа</button>' +
      '</div>' +
    '</div>';

  // Последни получени промени — вижда се дали изобщо идва нещо от таблицата.
  html += '<div class="ga-map"><div class="ga-map__hdr">Последни промени от таблицата</div>';
  if (!(d.events || []).length) {
    html += '<div class="ga-empty">Още нищо не е дошло. Сложи скрипта в таблицата и пипни някоя клетка.</div>';
  } else {
    d.events.forEach(function (ev) {
      var when = new Date(ev.created_at).toLocaleString('bg-BG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      var mark = ev.ignored ? '🙈 ' : (ev.important ? '⭐ ' : '• ');
      var state = ev.posted ? ' · в Basecamp' : (ev.ignored ? ' · игнориран акаунт' : '');
      html += '<div class="ga-map__row"' + (ev.ignored ? ' style="opacity:.55"' : '') + '>' +
        mark +
        '<strong>' + esc(ev.sheet_name) + '</strong>' + (ev.row_num ? ' · ред ' + ev.row_num : '') +
        (ev.title ? ' · ' + esc(ev.title) : '') +
        ' · ' + esc(ev.column_name) + ': ' + esc(ev.new_value || '—') +
        (ev.editor_email ? ' <span class="ga-dim">(' + esc(ev.editor_email) + ')</span>' : '') +
        ' <span class="ga-dim">' + esc(when) + esc(state) + '</span>' +
      '</div>';
    });
  }
  html += '</div>';

  if ((d.threads || []).length) {
    html += '<div class="ga-map"><div class="ga-map__hdr">Отворени нишки (едно видео = една нишка)</div>';
    d.threads.forEach(function (t) {
      html += '<div class="ga-map__row">' + esc(t.title) + ' <span class="ga-dim">· ' + esc(t.sheet_name) + '</span></div>';
    });
    html += '</div>';
  }

  html += '<div class="ga-row ga-row--foot">' +
      '<button class="btn btn-sm" onclick="shTest(this)">🔧 Тест към Basecamp</button>' +
      '<button class="btn btn-sm" onclick="shClearEvents(this)">🧹 Изчисти дневника</button>' +
      '<button class="btn btn-sm" onclick="shClearThreads(this)">↺ Забрави нишките</button>' +
      '<button class="btn btn-sm" onclick="shRotate(this)">🔑 Нова тайна</button>' +
    '</div>';

  host.innerHTML = html;
}

function shCopy(id) {
  var el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.value).then(function () { showToast('Копирано.', 'success', 1500); });
}

function shToggleEnabled(on) {
  _gaCall('/api/sheet-alerts/config', 'PUT', { enabled: on })
    .then(function () { _shData.enabled = on; showToast(on ? 'Известията от таблица са включени.' : 'Известията от таблица са спрени.', 'success'); })
    .catch(function (e) { showToast(e.message, 'error'); shLoad(); });
}

function shToggleAll(on) {
  _gaCall('/api/sheet-alerts/config', 'PUT', { allChanges: on })
    .then(function () { _shData.allChanges = on; showToast(on ? 'Известие при всяка промяна.' : 'Само важните колони.', 'success'); })
    .catch(function (e) { showToast(e.message, 'error'); shLoad(); });
}

function shSaveBoard() {
  var el = document.getElementById('shBoardUrl');
  _gaCall('/api/sheet-alerts/config', 'PUT', { boardUrl: el ? el.value : '' })
    .then(function () { showToast('Message Board е запазен.', 'success'); shLoad(); })
    .catch(function (e) { showToast(e.message, 'error'); });
}

function shSaveCols() {
  var imp = document.getElementById('shImportant');
  var tit = document.getElementById('shTitleCols');
  _gaCall('/api/sheet-alerts/config', 'PUT', {
    important: imp ? imp.value : undefined,
    titleCols: tit ? tit.value : undefined,
  })
    .then(function () { showToast('Колоните са запазени.', 'success'); shLoad(); })
    .catch(function (e) { showToast(e.message, 'error'); });
}

function shSaveIgnored() {
  var el = document.getElementById('shIgnored');
  _gaCall('/api/sheet-alerts/config', 'PUT', { ignored: el ? el.value : '' })
    .then(function () { showToast('Игнорираните акаунти са запазени.', 'success'); shLoad(); })
    .catch(function (e) { showToast(e.message, 'error', 6000); });
}

// Добавя видян акаунт към списъка, без да се преписва имейлът на ръка.
function shIgnoreEditor(email) {
  if (!email) return;
  var el = document.getElementById('shIgnored');
  var cur = (el && el.value ? el.value : '').trim();
  _gaCall('/api/sheet-alerts/config', 'PUT', { ignored: cur ? cur + ', ' + email : email })
    .then(function () { showToast(email + ' вече се игнорира.', 'success'); shLoad(); })
    .catch(function (e) { showToast(e.message, 'error', 6000); });
}

function shSaveDelay() {
  var el = document.getElementById('shDelay');
  _gaCall('/api/sheet-alerts/config', 'PUT', { delay: el ? el.value : undefined })
    .then(function () { showToast('Изчакването е запазено.', 'success'); shLoad(); })
    .catch(function (e) { showToast(e.message, 'error'); });
}

function shAddResponsible(pid) {
  if (!pid) return;
  _gaCall('/api/sheet-alerts/responsibles', 'POST', { personId: pid })
    .then(shLoad)
    .catch(function (e) { showToast(e.message, 'error'); });
}

function shRemoveResponsible(pid) {
  _gaCall('/api/sheet-alerts/responsibles/' + pid, 'DELETE')
    .then(shLoad)
    .catch(function (e) { showToast(e.message, 'error'); });
}

function shRefreshTeam(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  _gaCall('/api/sheet-alerts/refresh-people', 'POST')
    .then(function (r) { showToast('Екипът е обновен: ' + r.count + ' души.', 'success'); shLoad(); })
    .catch(function (e) { showToast('Грешка: ' + e.message, 'error', 6000); })
    .finally(function () { if (btn) { btn.disabled = false; btn.textContent = '🔄 Обнови екипа'; } });
}

function shTest(btn) {
  if (btn) btn.disabled = true;
  _gaCall('/api/sheet-alerts/test', 'POST')
    .then(function (r) { showToast('Тестовото съобщение е публикувано.' + (r.url ? '' : ''), 'success'); })
    .catch(function (e) { showToast('Грешка: ' + e.message, 'error', 6000); })
    .finally(function () { if (btn) btn.disabled = false; });
}

function shClearEvents(btn) {
  if (btn) btn.disabled = true;
  _gaCall('/api/sheet-alerts/events', 'DELETE')
    .then(function () { showToast('Дневникът е изчистен.', 'success'); shLoad(); })
    .catch(function (e) { showToast(e.message, 'error'); })
    .finally(function () { if (btn) btn.disabled = false; });
}

function shClearThreads(btn) {
  if (!confirm('Нишките ще се забравят — следващата промяна ще отвори НОВО съобщение за всяко видео. Продължаваме ли?')) return;
  if (btn) btn.disabled = true;
  _gaCall('/api/sheet-alerts/threads', 'DELETE')
    .then(function () { showToast('Нишките са забравени.', 'success'); shLoad(); })
    .catch(function (e) { showToast(e.message, 'error'); })
    .finally(function () { if (btn) btn.disabled = false; });
}

function shRotate(btn) {
  if (!confirm('Старият скрипт в таблицата ще спре да работи, докато не поставиш новия. Продължаваме ли?')) return;
  if (btn) btn.disabled = true;
  _gaCall('/api/sheet-alerts/rotate', 'POST')
    .then(function () { showToast('Тайната е сменена — постави новия скрипт в таблицата.', 'success', 6000); shLoad(); })
    .catch(function (e) { showToast(e.message, 'error'); })
    .finally(function () { if (btn) btn.disabled = false; });
}

function sgSectionKp(host) {
  host.innerHTML = '<div class="sg-section"><div class="ga-loading">Зареждане…</div></div>';
  kpAdminLoad();
}

async function kpAdminLoad() {
  try {
    var results = await Promise.all([
      fetch('/api/settings').then(function (r) { return r.json(); }),
      fetch('/api/kp/template').then(function (r) { return r.json(); }),
      fetch('/api/kp/bc-options').then(function (r) {
        return r.json().then(function (j) { return r.ok ? j : Promise.reject(new Error(j.error || ('HTTP ' + r.status))); });
      }).catch(function (e) { return { error: e.message }; }),
      // Локалните дъски/колони — нужни само за „Локални карти" (Basecamp изключен).
      fetch('/api/boards').then(function (r) { return r.json(); }).catch(function () { return []; }),
    ]);
    _kpAdm = {
      s: results[0].settings || {},
      tpl: results[1] || {},
      boards: results[2].boards || null,
      bcError: results[2].error || null,
      localBoards: Array.isArray(results[3]) ? results[3] : [],
    };
    kpAdminRender();
  } catch (e) {
    var body = document.getElementById('sgBody');
    if (body) body.innerHTML = '<div class="sg-section"><div style="color:var(--red);font-size:13px">Грешка при зареждане: ' + esc(e.message) + '</div></div>';
  }
}

function kpAdmBoardOpts(sel) {
  var opts = '<option value=""' + (!sel ? ' selected' : '') + '>— авто: Pre-Production —</option>';
  (_kpAdm.boards || []).forEach(function (b) {
    opts += '<option value="' + esc(b.id) + '"' + (String(sel) === String(b.id) ? ' selected' : '') + '>' + esc(b.title) + '</option>';
  });
  return opts;
}

function kpAdmColOpts(boardId, sel) {
  var opts = '<option value=""' + (!sel ? ' selected' : '') + '>— авто: Измисляне —</option>';
  var board = (_kpAdm.boards || []).find(function (b) { return String(b.id) === String(boardId); });
  // Без избрана дъска колоните идват от авто-дъската (Pre-Production), ако я намерим.
  if (!board) board = (_kpAdm.boards || []).find(function (b) { return /pre[\s-]*produc|предпрод/i.test(b.title || '') && !/post|пост/i.test(b.title || ''); });
  ((board && board.columns) || []).forEach(function (c) {
    opts += '<option value="' + esc(c.id) + '"' + (String(sel) === String(c.id) ? ' selected' : '') + '>' + esc(c.title) + (c.isDone ? ' (Done)' : '') + '</option>';
  });
  return opts;
}

// Колоната „готово за продукция" — същите колони, но с авто-разпознаване по име.
function kpAdmReadyColOpts(boardId, sel) {
  var board = (_kpAdm.boards || []).find(function (b) { return String(b.id) === String(boardId); });
  if (!board) board = (_kpAdm.boards || []).find(function (b) { return /pre[\s-]*produc|предпрод/i.test(b.title || '') && !/post|пост/i.test(b.title || ''); });
  var cols = (board && board.columns) || [];
  var auto = cols.find(function (c) { return /продукц/i.test(c.title || '') && !c.isDone; });
  var opts = '<option value=""' + (!sel ? ' selected' : '') + '>— авто: ' + esc(auto ? auto.title : 'В продукция') + ' —</option>';
  cols.forEach(function (c) {
    opts += '<option value="' + esc(c.id) + '"' + (String(sel) === String(c.id) ? ' selected' : '') + '>' + esc(c.title) + (c.isDone ? ' (Done)' : '') + '</option>';
  });
  return opts;
}

function kpAdminRender() {
  var host = document.getElementById('sgBody');
  if (!host || !_kpAdm) return;
  var s = _kpAdm.s;
  var bcOn = s.kp_bc_enabled !== 'false';
  var html = '';

  // --- 1. Дестинация ---
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">📦 Къде се създават КП картите</div>' +
    '<div class="sg-section__desc">Всеки нов контент план (ръчен бутон или авто-графикът) създава карта тук. Списъкът с клиенти е в <a href="#/kp-auto">КП-Автоматизация</a>.</div>' +
    '<div class="ga-row ga-row--config">' +
      '<label class="ga-toggle"><input type="checkbox" ' + (bcOn ? 'checked' : '') + ' onchange="kpAdmSave(\'kp_bc_enabled\', this.checked ? \'true\' : \'false\', true)"> Създавай в Basecamp</label>' +
      '<span class="ga-dim">' + (bcOn ? 'картите отиват в Basecamp' : 'изключено — картите остават в локалната платформа (старо поведение)') + '</span>' +
    '</div>';

  if (bcOn) {
    if (_kpAdm.bcError) {
      html += '<div class="ga-empty" style="color:var(--yellow);margin-top:10px">⚠ Basecamp не отговори (' + esc(_kpAdm.bcError) + ') — дъската/колоната не могат да се изберат сега, но останалите настройки работят.</div>';
    } else {
      html += '<div class="sg-kp-grid">' +
        '<label class="sg-kp-field"><span class="sg-kp-label">Дъска (Card Table)</span>' +
          '<select class="ga-select sg-kp-select" id="kpAdmBoard" onchange="kpAdmBoardChange(this.value)">' + kpAdmBoardOpts(s.kp_bc_board_id) + '</select></label>' +
        '<label class="sg-kp-field"><span class="sg-kp-label">Колона</span>' +
          '<select class="ga-select sg-kp-select" id="kpAdmCol" onchange="kpAdmSave(\'kp_bc_column_id\', this.value)">' + kpAdmColOpts(s.kp_bc_board_id, s.kp_bc_column_id) + '</select></label>' +
      '</div>';
    }
    html += '<div class="sg-kp-grid">' +
      '<label class="sg-kp-field"><span class="sg-kp-label">Ръчното пускане създава картата като</span>' +
        '<select class="ga-select sg-kp-select" onchange="kpAdmSave(\'kp_bc_actor\', this.value)">' +
          '<option value="user"' + (s.kp_bc_actor !== 'bot' ? ' selected' : '') + '>Логнатия потребител</option>' +
          '<option value="bot"' + (s.kp_bc_actor === 'bot' ? ' selected' : '') + '>Бота ThePactAlerts</option>' +
        '</select>' +
        '<span class="sg-kp-note">Авто-графикът винаги действа като бота.</span></label>' +
      '<label class="sg-kp-field"><span class="sg-kp-label">Следващ КП се пуска, щом главната карта стигне</span>' +
        '<select class="ga-select sg-kp-select" onchange="kpAdmSave(\'kp_bc_check_scope\', this.value, true)">' +
          '<option value="ready"' + (s.kp_bc_check_scope !== 'board' && s.kp_bc_check_scope !== 'column' ? ' selected' : '') + '>колоната „готово за продукция"</option>' +
          '<option value="column"' + (s.kp_bc_check_scope === 'column' ? ' selected' : '') + '>щом напусне колоната за създаване</option>' +
          '<option value="board"' + (s.kp_bc_check_scope === 'board' ? ' selected' : '') + '>щом излезе от целия борд (Done)</option>' +
        '</select>' +
        '<span class="sg-kp-note">Брои се само <strong>главната</strong> КП карта („{клиент} КП-11"); картите за отделните видеа не задържат следващия план.</span></label>' +
    '</div>' +
    (s.kp_bc_check_scope !== 'board' && s.kp_bc_check_scope !== 'column' && !_kpAdm.bcError
      ? '<div class="sg-kp-grid">' +
          '<label class="sg-kp-field"><span class="sg-kp-label">Колона „готово за продукция"</span>' +
            '<select class="ga-select sg-kp-select" onchange="kpAdmSave(\'kp_bc_ready_column_id\', this.value)">' + kpAdmReadyColOpts(s.kp_bc_board_id, s.kp_bc_ready_column_id) + '</select>' +
            '<span class="sg-kp-note">Стигне ли главната карта дотук, планът е приет и следващият се пуска веднага — без значение колко дни по-рано е.</span></label>' +
        '</div>'
      : '') +
    '<div class="ga-row">' +
      '<label class="ga-toggle"><input type="checkbox" ' + (s.kp_bc_notify === 'true' ? 'checked' : '') + ' onchange="kpAdmSave(\'kp_bc_notify\', this.checked ? \'true\' : \'false\')"> Basecamp известие при създаване</label>' +
      '<span class="ga-dim">изключено = картата се появява тихо</span>' +
    '</div>' +
    '<div class="ga-row ga-row--foot">' +
      '<button class="btn btn-sm" onclick="kpAdmTest(this)">🔧 Провери връзката</button>' +
      '<span class="ga-dim">показва къде точно ще отиде следващата КП карта — нищо не се създава</span>' +
    '</div>';
  }
  html += '</div>';

  // --- 2. Заглавие и текст ---
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">✏️ Заглавие и текст на картата</div>' +
    '<div class="sg-section__desc">Плейсхолдърите се заменят автоматично при създаване.</div>' +
    '<label class="sg-kp-field"><span class="sg-kp-label">Заглавие</span>' +
      '<input type="text" class="ga-input" id="kpAdmTitle" value="' + esc(s.kp_bc_title_template || '{клиент} КП-{номер}') + '" onblur="kpAdmSave(\'kp_bc_title_template\', this.value || \'{клиент} КП-{номер}\')">' +
      '<span class="sg-kp-note">{клиент} = име на клиента · {номер} = номер на КП. Пример: „Cineland КП-18".</span></label>' +
    '<label class="sg-kp-field" style="margin-top:12px"><span class="sg-kp-label">Основен текст</span>' +
      '<textarea class="ga-input sg-kp-textarea" id="kpAdmTplMain" rows="7">' + esc(_kpAdm.tpl.template || '') + '</textarea>' +
      '<span class="sg-kp-note">{first_publish_date} = дата на първото видео · {publish_dates} = всички дати (по една на ред) · {video_sections} = секциите за видеата · {клиент} · {номер}</span></label>' +
    '<label class="sg-kp-field" style="margin-top:12px"><span class="sg-kp-label">Секция за всяко видео</span>' +
      '<textarea class="ga-input sg-kp-textarea" id="kpAdmTplVideo" rows="7">' + esc(_kpAdm.tpl.videoSection || '') + '</textarea>' +
      '<span class="sg-kp-note">{N} = номер на видеото. Повтаря се за всяко видео в плана.</span></label>' +
    '<div class="ga-row ga-row--foot">' +
      '<button class="btn btn-sm" onclick="kpAdmSaveTemplates(this)">💾 Запази текстовете</button>' +
    '</div>' +
  '</div>';

  // --- 3. Коментар с тагове под новата КП карта ---
  var cmOn = s.kp_comment_enabled !== 'false';
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">💬 Коментар под новата КП карта</div>' +
    '<div class="sg-section__desc">Веднага след създаването на КП картата ботът пише коментар под нея: тагва хората, отговорни за контент плановете, ' +
      'и добавя какво конкретно трябва да се направи по този план — извадено от проекта на клиента в Basecamp (съобщения, отворени задачи, коментари, чат). ' +
      'Кой се тагва се задава в <a href="#/admin/team">Екип и роли</a> (позиция „прави КП").</div>' +
    '<div class="ga-row ga-row--config">' +
      '<label class="ga-toggle"><input type="checkbox" ' + (cmOn ? 'checked' : '') + ' onchange="kpAdmSave(\'kp_comment_enabled\', this.checked ? \'true\' : \'false\', true)"> Включено</label>' +
      '<span class="ga-dim">' + (cmOn ? 'всяка нова КП карта получава коментар' : 'изключено — картата се създава без коментар') + '</span>' +
    '</div>';
  if (cmOn) {
    html += '<div class="ga-row">' +
        '<label class="ga-toggle"><input type="checkbox" ' + (s.kp_comment_ai !== 'false' ? 'checked' : '') + ' onchange="kpAdmSave(\'kp_comment_ai\', this.checked ? \'true\' : \'false\')"> 🤖 Claude обобщава проекта на клиента</label>' +
        '<span class="ga-dim">изключено = сухо изброяване на последните съобщения и отворени задачи</span>' +
      '</div>' +
      '<div class="sg-kp-rows">' +
        kpAdmNumRow('kp_comment_lookback_days', 'Чете назад от проекта на клиента', s.kp_comment_lookback_days || '45', 'календарни дни') +
      '</div>';
  }
  html += '</div>';

  // --- 4. Дати и обем ---
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">📆 Дати и обем</div>' +
    '<div class="sg-kp-rows">' +
      kpAdmNumRow('kp_bc_due_days', 'Срок на КП картата (Due date)', s.kp_bc_due_days === undefined ? '10' : s.kp_bc_due_days, 'работни дни преди първото видео · празно = без срок', true) +
      kpAdmNumRow('kp_calendar_window', 'Календарен прозорец', s.kp_calendar_window || '30', 'резерва · дължината на месеца се хваща автоматично (28/30/31 дни)') +
      kpAdmNumRow('kp_days_before_next_kp', 'Създаване на следващ КП', s.kp_days_before_next_kp || '15', 'работни дни преди първото видео на следващия КП') +
      kpAdmNumRow('kp_default_videos', 'Видеа по подразбиране', s.kp_default_videos || '10', 'за нов клиент, ако не е зададено друго') +
    '</div>' +
  '</div>';

  // --- 5. Авто-създаване ---
  var autoOn = s.kp_auto_create_enabled !== 'false';
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">⏰ Автоматично създаване</div>' +
    '<div class="sg-section__desc">Всеки ден в зададения час (българско време) проверява клиентите и пуска КП карта на всеки, който няма активна и му е дошло времето.</div>' +
    '<div class="ga-row ga-row--config">' +
      '<label class="ga-toggle"><input type="checkbox" ' + (autoOn ? 'checked' : '') + ' onchange="kpAdmSave(\'kp_auto_create_enabled\', this.checked ? \'true\' : \'false\', true)"> Включено</label>' +
      '<span class="sg-kp-label" style="margin-left:10px">Час:</span>' +
      '<input type="time" class="ga-input" style="flex:0 0 110px;min-width:110px" value="' + esc(s.kp_auto_create_time || '08:00') + '" onchange="kpAdmSave(\'kp_auto_create_time\', this.value || \'08:00\')">' +
      '<label class="ga-toggle"><input type="checkbox" ' + (s.kp_auto_create_weekends === 'true' ? 'checked' : '') + ' onchange="kpAdmSave(\'kp_auto_create_weekends\', this.checked ? \'true\' : \'false\')"> и в събота/неделя</label>' +
    '</div>' +
    '<div class="sg-kp-note" style="margin-top:8px">Промените важат веднага — графикът се презарежда автоматично.</div>' +
  '</div>';

  // --- 6. Локални карти (старото поведение, когато Basecamp е изключен) ---
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">🗃 Локални карти в платформата</div>' +
    '<div class="sg-section__desc">Важи, когато „Създавай в Basecamp" горе е изключено: КП картата се създава в платформата, ' +
      'а бутонът „Създай видео задачи" ги разпределя в избраната колона. При Basecamp режим тези три настройки не се ползват.</div>' +
    '<div class="sg-kp-grid">' +
      '<label class="sg-kp-field"><span class="sg-kp-label">Колона „Измисляне" (тук отива КП картата)</span>' +
        '<select class="ga-select sg-kp-select" onchange="kpAdmSave(\'kp_izmislyane_column_id\', this.value)">' +
          kpAdmLocalColOpts(s.kp_izmislyane_column_id) + '</select></label>' +
      '<label class="sg-kp-field"><span class="sg-kp-label">Колона „Разпределение" (тук отиват видео задачите)</span>' +
        '<select class="ga-select sg-kp-select" onchange="kpAdmSave(\'kp_razpredelenie_column_id\', this.value)">' +
          kpAdmLocalColOpts(s.kp_razpredelenie_column_id) + '</select></label>' +
    '</div>' +
    '<div class="sg-kp-rows" style="margin-top:12px">' +
      kpAdmNumRow('kp_days_brainstorm', 'Дата за измисляне', s.kp_days_brainstorm || '10', 'работни дни преди публикуване') +
    '</div>' +
  '</div>';

  host.innerHTML = html;
}

// Опции „дъска → колона" от локалната платформа (за секция „Локални карти").
function kpAdmLocalColOpts(sel) {
  var opts = '<option value="">— автоматично по име —</option>';
  ((_kpAdm && _kpAdm.localBoards) || []).forEach(function (b) {
    (b.columns || []).forEach(function (c) {
      opts += '<option value="' + esc(c.id) + '"' + (String(sel) === String(c.id) ? ' selected' : '') + '>' +
        esc(b.title) + ' → ' + esc(c.title) + '</option>';
    });
  });
  return opts;
}

// Един ред „число + описание" за секцията с дати.
function kpAdmNumRow(key, label, value, hint, allowEmpty) {
  return '<div class="sg-kp-row">' +
    '<span class="sg-kp-row__label">' + esc(label) + '</span>' +
    '<input type="number" min="0" max="90" class="ga-input sg-kp-num" value="' + esc(value == null ? '' : String(value)) + '"' +
      ' onblur="kpAdmSave(\'' + key + '\', this.value' + (allowEmpty ? '' : ' || \'0\'') + ')">' +
    '<span class="sg-kp-row__hint">' + esc(hint) + '</span>' +
  '</div>';
}

// Запазва настройка + (по избор) презарежда КП секцията, за да се преначертае.
function kpAdmSave(key, value, rerender) {
  saveSetting(key, value);
  if (_kpAdm) _kpAdm.s[key] = String(value);
  if (typeof _platformConfig === 'object') _platformConfig[key] = String(value);
  showToast('Запазено ✓', 'success', 1500);
  if (rerender) kpAdminRender();
}

// Смяна на дъската: нулира колоната (авто) — колоните са на новата дъска.
function kpAdmBoardChange(boardId) {
  saveSetting('kp_bc_column_id', '');
  if (_kpAdm) _kpAdm.s.kp_bc_column_id = '';
  kpAdmSave('kp_bc_board_id', boardId);
  var colSel = document.getElementById('kpAdmCol');
  if (colSel) colSel.innerHTML = kpAdmColOpts(boardId, '');
}

async function kpAdmSaveTemplates(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  try {
    var title = (document.getElementById('kpAdmTitle') || {}).value;
    if (title) await saveSetting('kp_bc_title_template', title);
    var res = await fetch('/api/kp/template', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template: (document.getElementById('kpAdmTplMain') || {}).value,
        videoSection: (document.getElementById('kpAdmTplVideo') || {}).value,
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showToast('Текстовете са запазени ✓', 'success');
  } catch (e) {
    showToast('Грешка: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Запази текстовете'; }
  }
}

async function kpAdmTest(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Проверка…'; }
  try {
    var res = await fetch('/api/kp/bc-test', { method: 'POST' });
    var j = await res.json();
    if (j.ok) {
      var scopeTxt = '';
      if (j.checkScope === 'ready') {
        scopeTxt = j.blockingColumns && j.blockingColumns.length
          ? ' · следващ КП, щом главната карта напусне: ' + j.blockingColumns.join(' / ')
          : ' · ⚠ няма колона „В продукция" на дъската — брои се целият борд';
      }
      showToast('✓ КП картите отиват в: ' + j.board + ' → ' + j.column +
        (j.dueDays != null ? ' · срок ' + j.dueDays + ' раб. дни преди 1-то видео' : ' · без срок') +
        scopeTxt + ' · пример: „' + j.titleExample + '"', 'success', 10000);
    } else {
      showToast('⚠ ' + (j.error || 'Неуспешна проверка'), 'error', 8000);
    }
  } catch (e) {
    showToast('Грешка: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔧 Провери връзката'; }
  }
}

// ==================== DASHBOARD ДЪСКИ (кои Card Tables виждат всички) ====================
// Глобален списък в app_settings (bc_dashboard_boards). Дъските идват на живо от
// Basecamp (Video Production) → нови/премахнати процеси се управляват само оттук.

var _sgDash = null; // { boards: [{id,title,columns,cards}], enabled: [ids] | null (null = всички) }

async function sgDashBoardsLoad() {
  var host = document.getElementById('sgDashBoards');
  if (!host) return;
  try {
    var res = await fetch('/api/bc-board/boards-config');
    if (!res.ok) { var j = await res.json().catch(function () { return {}; }); throw new Error(j.error || ('HTTP ' + res.status)); }
    _sgDash = await res.json();
    sgDashBoardsRender();
  } catch (e) {
    host.innerHTML = '<div style="color:var(--red);font-size:13px">Грешка при зареждане от Basecamp: ' + esc(e.message) + '</div>';
  }
}

function sgDashBoardsRender() {
  var host = document.getElementById('sgDashBoards');
  if (!host || !_sgDash) return;
  var enabled = _sgDash.enabled; // null = всички са включени
  var isOn = function (id) { return !enabled || enabled.indexOf(String(id)) !== -1; };
  host.innerHTML = (_sgDash.boards || []).map(function (b) {
    return '<label class="sg-dashboard-row">' +
      '<input type="checkbox" ' + (isOn(b.id) ? 'checked' : '') + ' onchange="sgDashBoardToggle(\'' + String(b.id) + '\', this.checked)">' +
      '<span class="sg-dashboard-row__name">' + esc(b.title) + '</span>' +
      '<span class="sg-dashboard-row__meta">' + b.columns + ' колони · ' + b.cards + ' карти</span>' +
    '</label>';
  }).join('') +
  '<div class="sg-dashboard-note">Изключена дъска изчезва от Dashboard-а на всички. В Basecamp нищо не се променя.</div>';
}

function sgDashBoardToggle(id, on) {
  if (!_sgDash) return;
  var all = (_sgDash.boards || []).map(function (b) { return String(b.id); });
  var cur = _sgDash.enabled ? _sgDash.enabled.slice() : all.slice(); // първа промяна тръгва от „всички"
  cur = cur.filter(function (x) { return all.indexOf(x) !== -1; });   // чисти дъски, които вече не съществуват
  if (on) { if (cur.indexOf(String(id)) === -1) cur.push(String(id)); }
  else cur = cur.filter(function (x) { return x !== String(id); });
  _sgDash.enabled = cur;
  fetch('/api/bc-board/boards-config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: cur }),
  }).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showToast(on ? 'Дъската е добавена към Dashboard-а на всички ✓' : 'Дъската е махната от Dashboard-а.', 'success');
  }).catch(function (e) { showToast('Грешка: ' + e.message, 'error'); sgDashBoardsLoad(); });
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
  var team = d.team || [];
  var html = '';

  // Глобален ред: on/off + Campfire ping + Message Board линк
  html += '<div class="ga-row ga-row--config">' +
      '<label class="ga-toggle"><input type="checkbox" ' + (d.enabled ? 'checked' : '') + ' onchange="gaToggleEnabled(this.checked)"> Включено</label>' +
      '<label class="ga-toggle" title="Ред в Campfire чата на проекта с таг на създателя и отговорниците — най-близкото до Ping, което Basecamp API позволява.">' +
        '<input type="checkbox" ' + (d.pingCampfire ? 'checked' : '') + ' onchange="gaTogglePing(this.checked)"> 🔔 Ping в Campfire</label>' +
      '<input type="text" class="ga-input ga-input--board" id="gaBoardUrl" value="' + esc(d.boardUrl) + '" placeholder="Линк към Basecamp Message Board…">' +
      '<button class="btn btn-sm" onclick="gaSaveBoard()">Запази</button>' +
    '</div>';

  // Екип от Basecamp (Video Production) — от него идват отговорниците
  var syncedTxt = d.peopleSyncedAt
    ? 'обновен ' + esc(new Date(d.peopleSyncedAt).toLocaleString('bg-BG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
    : 'още не е зареждан';
  html += '<div class="ga-team">' +
      '<span>👤 Екип от Basecamp (Video Production): <strong>' + team.length + ' души</strong> · <span class="ga-dim">' + syncedTxt + '</span></span>' +
      '<button class="ga-btn" onclick="gaRefreshTeam(this)">🔄 Обнови екипа</button>' +
    '</div>';
  if (!team.length) {
    html += '<div class="ga-empty" style="color:var(--yellow)">Няма заредени хора — натисни „Обнови екипа" (тегли членовете на Video Production от Basecamp).</div>';
  }

  // ➕ Добавяне на календар — първо и откроено
  html += '<div class="ga-add">' +
      '<div class="ga-add__hdr">➕ Добави календар за следене</div>' +
      '<div class="ga-row" style="margin-top:6px">' +
        '<input type="text" class="ga-input" id="gaNewCal" placeholder="Постави Calendar ID (…@group.calendar.google.com) или embed линк (…?src=…)">' +
        '<button class="btn btn-sm" onclick="gaAddFeed()">Добави</button>' +
      '</div>' +
      '<div class="ga-share">Стъпка 1: сподели календара с този имейл ' +
        '(в Google Calendar: <b>Настройки на календара → Споделяне с конкретни хора → Добави хора</b>):' +
        '<code class="ga-sa" id="gaSaEmail">' + esc(d.saEmail || 'няма credentials') + '</code>' +
        '<button class="ga-copy" title="Копирай" onclick="gaCopySa()">⧉</button>' +
      '</div>' +
      '<div class="ga-share"><b>Кои права да избереш — това решава какво може календарът:</b>' +
        '<br>· <b>„Вижда всички подробности"</b> → календарът се <b>вижда</b> в производствения календар и поражда известия, но <b>не можеш да насрочваш карти в него</b>.' +
        '<br>· <b>„Прави промени по събития"</b> → освен това можеш и да <b>добавяш карти</b> в него (появява се в „Добавяй в"). За календар на видеограф избери <b>това</b>.' +
      '</div>' +
      '<div class="ga-share">Стъпка 2: постави горе Calendar ID-то или embed линка. Намираш ги в <b>Настройки на календара → Интегриране на календара</b>. ' +
        'Правата се проверяват сами при следващото отваряне на производствения календар — ако там пише „само четене", значи споделянето е с „Вижда всички подробности".' +
      '</div>' +
    '</div>';

  // Следени календари
  html += '<div class="ga-feeds">';
  if (!d.feeds.length) html += '<div class="ga-empty">Няма добавени календари.</div>';
  d.feeds.forEach(function (f) {
    var status;
    if (f.last_error) status = '<span class="ga-status ga-status--err" title="' + esc(f.last_error) + '">⚠ ' + esc(f.last_error) + '</span>';
    else if (f.last_sync_at) status = '<span class="ga-status ga-status--ok">✓ Свързан · sync ' + esc(new Date(f.last_sync_at).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' })) + '</span>';
    else status = '<span class="ga-status">⏳ Очаква първи sync</span>';

    var chips = (f.responsibles || []).map(function (pid) {
      var p = team.find(function (x) { return String(x.person_id) === String(pid); });
      return '<span class="ga-chip">' + esc(p ? p.name : '#' + pid) +
        '<button onclick="gaRemoveResponsible(' + f.id + ',\'' + String(pid) + '\')" title="Махни">✕</button></span>';
    }).join('');
    var opts = '<option value="">+ отговорник</option>' + team
      .filter(function (p) { return (f.responsibles || []).indexOf(String(p.person_id)) === -1; })
      .map(function (p) { return '<option value="' + String(p.person_id) + '">' + esc(p.name) + '</option>'; }).join('');

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

  // Съответствия Google имейл ↔ Basecamp човек
  html += '<div class="ga-map">' +
      '<div class="ga-map__hdr">Съответствия на имейли <span class="ga-dim">— само когато Google имейлът е различен от Basecamp имейла</span></div>';
  d.personMap.forEach(function (m) {
    html += '<div class="ga-map__row"><code>' + esc(m.google_email) + '</code> → ' + esc(m.person_name || ('#' + m.bc_person_id)) +
      ' <button class="ga-btn ga-btn--del" onclick="gaDelMap(\'' + esc(m.google_email).replace(/'/g, "\\'") + '\')">✕</button></div>';
  });
  html += '<div class="ga-row">' +
      '<input type="text" class="ga-input" id="gaMapEmail" placeholder="google имейл">' +
      '<select class="ga-select" id="gaMapUser">' +
        team.map(function (p) { return '<option value="' + String(p.person_id) + '">' + esc(p.name) + '</option>'; }).join('') +
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

function gaRefreshTeam(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  _gaCall('/api/gcal-alerts/refresh-people', 'POST')
    .then(function (r) { showToast('Екипът е обновен: ' + r.count + ' души.', 'success'); gaLoad(); })
    .catch(function (e) { showToast('Грешка: ' + e.message, 'error', 6000); })
    .finally(function () { if (btn) { btn.disabled = false; btn.textContent = '🔄 Обнови екипа'; } });
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

function gaTogglePing(on) {
  _gaCall('/api/gcal-alerts/config', 'PUT', { pingCampfire: on })
    .then(function () { _gaData.pingCampfire = on; showToast(on ? 'Campfire ping е включен.' : 'Campfire ping е спрян.', 'success'); })
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
  _gaSetResponsibles(feedId, (f.responsibles || []).concat([String(val)]));
}

function gaRemoveResponsible(feedId, pid) {
  var f = _gaData.feeds.find(function (x) { return x.id === feedId; });
  _gaSetResponsibles(feedId, (f.responsibles || []).filter(function (x) { return String(x) !== String(pid); }));
}

function gaAddMap() {
  var email = (document.getElementById('gaMapEmail') || {}).value || '';
  var pid = (document.getElementById('gaMapUser') || {}).value;
  if (!email.trim() || !pid) return;
  _gaCall('/api/gcal-alerts/person-map', 'PUT', { google_email: email, bc_person_id: String(pid) }).then(gaLoad)
    .catch(function (e) { showToast(e.message, 'error'); });
}

function gaDelMap(email) {
  _gaCall('/api/gcal-alerts/person-map', 'PUT', { google_email: email, bc_person_id: null }).then(gaLoad)
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

// ==================== ТЕМА: ШРИФТ + ЦВЕТОВЕ ====================

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
  renderSettings(document.getElementById('pageContent'), 'theme');
}

// ==================== СЕКЦИЯ: PM AGENT ====================
// AI project manager (Фаза 0/1): снапшот на Basecamp + одит „какво изпускаме".
// Одитният доклад се публикува в Basecamp от ThePactAlerts (известие само до админа)
// и се пази и тук, в журнала.

var _agPollTimer = null;
var _agSettings = {};

function sgSectionAgent(host) {
  host.innerHTML =
    '<div class="sg-section">' +
      '<div class="sg-section__hdr">🤖 PM Agent</div>' +
      '<div class="sg-section__desc">Агентът държи снапшот на целия Basecamp (карти, коментари, клиентски проекти) и при одит го анализира с Claude (Opus). Докладът пристига като съобщение от ThePactAlerts — известие получаваш само ти.</div>' +
      '<div id="agBody"><div class="ga-loading">Зареждане…</div></div>' +
    '</div>';
  agLoad();
}

async function agLoad() {
  var body = document.getElementById('agBody');
  if (!body) { agStopPoll(); return; }
  try {
    var results = await Promise.all([
      fetch('/api/agent/status'),
      fetch('/api/settings'),
    ]);
    if (!results[0].ok) throw new Error('HTTP ' + results[0].status);
    var data = await results[0].json();
    try { _agSettings = (await results[1].json()).settings || {}; } catch (e2) { _agSettings = {}; }
    agRender(data);
    var hasRunning = (data.runs || []).some(function (r) { return r.status === 'running'; });
    if (hasRunning) agStartPoll(); else agStopPoll();
  } catch (e) {
    body.innerHTML = '<div style="color:var(--red);font-size:13px">Грешка: ' + esc(e.message) + '</div>';
    agStopPoll();
  }
}

function agStartPoll() {
  if (_agPollTimer) return;
  _agPollTimer = setInterval(function () {
    if (!document.getElementById('agBody')) { agStopPoll(); return; }
    agLoad();
  }, 5000);
}
function agStopPoll() {
  if (_agPollTimer) { clearInterval(_agPollTimer); _agPollTimer = null; }
}

function agFmtTime(t) {
  if (!t) return '—';
  var d = new Date(t);
  return d.toLocaleDateString('bg-BG') + ' ' + d.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
}

function agKindLabel(k) {
  return k === 'audit' ? '🕵️ Одит' : k === 'digest' ? '📋 Дайджест' : '🔄 Синхрон';
}

function agStatusBadge(s) {
  if (s === 'running') return '<span style="color:var(--yellow,#e5c07b)">⏳ работи…</span>';
  if (s === 'done') return '<span style="color:var(--green,#46a374)">✓ готово</span>';
  return '<span style="color:var(--red)">✗ грешка</span>';
}

function agRender(data) {
  var body = document.getElementById('agBody');
  if (!body) return;
  var c = data.counts || {};
  var runs = data.runs || [];
  var busy = runs.some(function (r) { return r.status === 'running'; });

  var html =
    '<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:13px;margin-bottom:14px">' +
      '<span>📁 Проекти: <b>' + (c.projects || 0) + '</b></span>' +
      '<span>🗂 Карти: <b>' + (c.cards || 0) + '</b></span>' +
      '<span>💬 Коментари: <b>' + (c.comments || 0) + '</b></span>' +
      '<span>✉ Съобщения: <b>' + (c.messages || 0) + '</b></span>' +
      '<span>☐ Задачи: <b>' + (c.todos || 0) + '</b></span>' +
      '<span>🔥 Чат: <b>' + (c.campfireLines || 0) + '</b></span>' +
      '<span>Последен синхрон: <b>' + agFmtTime(c.lastSyncAt) + '</b></span>' +
    '</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">' +
      '<button class="btn btn-sm" onclick="agSync(false)"' + (busy ? ' disabled' : '') + '>🔄 Синхронизирай</button>' +
      '<button class="btn btn-sm" onclick="agSync(true)"' + (busy ? ' disabled' : '') + ' title="Изтегля всичко наново (карти, коментари, клиентски проекти)">⟳ Пълен синхрон</button>' +
      '<button class="btn btn-sm btn-primary" onclick="agAudit()"' + (busy ? ' disabled' : '') + '>🕵️ Пусни одит</button>' +
      '<button class="btn btn-sm" onclick="agDigest()"' + (busy ? ' disabled' : '') + ' title="Обобщение на промените от последния дайджест + текущите рискове">📋 Пусни дайджест</button>' +
      '<button class="btn btn-sm" onclick="agWatchdog()" title="Провери за клиенти без отговор от екипа">⚠️ Чакащи клиенти</button>' +
      '<a class="btn btn-sm" href="#/agent" style="text-decoration:none">💬 Отвори чата</a>' +
    '</div>' +
    agSettingsHtml();

  if (runs.length) {
    html += '<div class="sg-section__hdr" style="font-size:13px">Журнал</div>';
    html += runs.map(function (r) {
      var stats = r.stats || {};
      var extra = '';
      if (r.kind === 'audit' && stats.costUsd != null) extra = ' · ~$' + stats.costUsd;
      if (stats.seconds) extra += ' · ' + stats.seconds + 'с';
      var links = '';
      if (r.status === 'done' && r.kind === 'audit') {
        links += ' <a href="javascript:void(0)" onclick="agShowReport(' + r.id + ')">виж доклада</a>';
        if (r.bc_message_url) links += ' · <a href="' + esc(r.bc_message_url) + '" target="_blank" rel="noopener">в Basecamp ↗</a>';
      }
      var err = r.status === 'error' && r.error ? '<div style="color:var(--red);font-size:12px;margin-top:2px">' + esc(String(r.error).slice(0, 300)) + '</div>' : '';
      return '<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:13px">' +
        agKindLabel(r.kind) + ' · ' + agStatusBadge(r.status) + ' · ' + agFmtTime(r.started_at) + esc(extra) + links + err +
      '</div>';
    }).join('');
  }

  html += '<div id="agReport" style="margin-top:16px"></div>';
  // Poll-ът презарежда цялата секция — пазим отворения доклад да не изчезне.
  var prevReport = document.getElementById('agReport');
  var prevReportHtml = prevReport ? prevReport.innerHTML : '';
  body.innerHTML = html;
  if (prevReportHtml) {
    var holder = document.getElementById('agReport');
    if (holder) holder.innerHTML = prevReportHtml;
  }
}

async function agSync(full) {
  try {
    var res = await fetch('/api/agent/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full: Boolean(full) }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    agLoad(); agStartPoll();
  } catch (e) { alert('Грешка: ' + e.message); }
}

async function agAudit() {
  if (!confirm('Пускам пълен одит с Claude (Opus). Отнема няколко минути и струва няколко долара. Продължавам ли?')) return;
  try {
    var res = await fetch('/api/agent/audit', { method: 'POST' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    agLoad(); agStartPoll();
  } catch (e) { alert('Грешка: ' + e.message); }
}

async function agShowReport(runId) {
  var holder = document.getElementById('agReport');
  if (!holder) return;
  holder.innerHTML = '<div class="ga-loading">Зареждане на доклада…</div>';
  try {
    var res = await fetch('/api/agent/runs/' + runId);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    // Докладът е генериран от нашия агент (доверен HTML) и е видим само за админ.
    holder.innerHTML =
      '<div class="sg-section" style="margin-top:8px">' +
        '<div class="sg-section__hdr">Доклад #' + runId + '</div>' +
        '<div class="ag-report" style="font-size:14px;line-height:1.55">' + (data.run && data.run.report ? data.run.report : '<em>Празен доклад.</em>') + '</div>' +
      '</div>';
    holder.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    holder.innerHTML = '<div style="color:var(--red);font-size:13px">Грешка: ' + esc(e.message) + '</div>';
  }
}

// ---------- PM Agent: настройки за дайджест/watchdog ----------

function agSettingsHtml() {
  var st = _agSettings || {};
  var dOn = st.pm_agent_digest_enabled === 'true';
  var wOn = st.pm_agent_watchdog_enabled === 'true';
  var time = st.pm_agent_digest_time || '08:30';
  var hours = st.pm_agent_watchdog_hours || '24';
  return '<div style="border-top:1px solid rgba(255,255,255,.08);padding-top:12px;margin-bottom:14px;font-size:13px">' +
    '<div style="font-weight:600;margin-bottom:8px">Автоматика</div>' +
    '<div style="display:flex;gap:22px;flex-wrap:wrap;align-items:center">' +
      '<label style="display:flex;gap:6px;align-items:center;cursor:pointer">' +
        '<input type="checkbox" ' + (dOn ? 'checked' : '') + ' onchange="agSaveSetting(&quot;pm_agent_digest_enabled&quot;, this.checked ? &quot;true&quot; : &quot;false&quot;)"> Дневен дайджест в' +
      '</label>' +
      '<input type="time" value="' + esc(time) + '" onchange="agSaveSetting(&quot;pm_agent_digest_time&quot;, this.value)" style="padding:4px 8px;border-radius:6px;background:var(--bg-card,#1b2930);color:inherit;border:1px solid rgba(255,255,255,.15)"> (делнични дни)' +
      '<label style="display:flex;gap:6px;align-items:center;cursor:pointer">' +
        '<input type="checkbox" ' + (wOn ? 'checked' : '') + ' onchange="agSaveSetting(&quot;pm_agent_watchdog_enabled&quot;, this.checked ? &quot;true&quot; : &quot;false&quot;)"> Watchdog: клиент без отговор над' +
      '</label>' +
      '<input type="number" min="1" max="168" value="' + esc(hours) + '" onchange="agSaveSetting(&quot;pm_agent_watchdog_hours&quot;, this.value)" style="width:64px;padding:4px 8px;border-radius:6px;background:var(--bg-card,#1b2930);color:inherit;border:1px solid rgba(255,255,255,.15)"> часа' +
    '</div>' +
    '<div style="opacity:.65;margin-top:6px">И двете пристигат като Basecamp съобщение от ThePactAlerts — известие получаваш само ти.</div>' +
  '</div>';
}

async function agSaveSetting(key, value) {
  try {
    var res = await fetch('/api/settings/' + encodeURIComponent(key), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(value) }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _agSettings[key] = String(value);
    if (typeof showToast === 'function') showToast('Запазено', 'success');
  } catch (e) { alert('Грешка при запис: ' + e.message); }
}

async function agDigest() {
  try {
    var res = await fetch('/api/agent/digest', { method: 'POST' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    agLoad(); agStartPoll();
  } catch (e) { alert('Грешка: ' + e.message); }
}

async function agWatchdog() {
  try {
    var res = await fetch('/api/agent/watchdog', { method: 'POST' });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    if (data.skipped === 'watchdog-disabled') alert('Watchdog-ът е изключен — включи го от настройката по-долу.');
    else alert(data.alerts ? ('Изпратени ' + data.alerts + ' аларми към Basecamp.') : 'Няма чакащи клиенти над прага.');
  } catch (e) { alert('Грешка: ' + e.message); }
}

// ==================== СЕКЦИЯ: СИСТЕМА ====================
// Тук са настройките, които преди живееха в стария панел („Разширени"):
// дневният отчет в Campfire, прозорецът за редакция на коментари, синхронът към
// Google Calendar и двете логически настройки, които кодът наистина чете.
// Мъртвите настройки от стария панел (board_keyword_*, deadline_soon_days,
// auto_refresh_seconds, kp_card_pattern, kp_days_filming/editing/upload) не са
// пренесени — нищо в кода не ги ползваше.

var _sysData = null; // { s: settings, rooms: [...] }

function sgSectionSystem(host) {
  host.innerHTML = '<div class="sg-section"><div class="ga-loading">Зареждане…</div></div>';
  sysLoad();
}

async function sysLoad() {
  var host = document.getElementById('sgBody');
  if (!host) return;
  try {
    var results = await Promise.all([
      fetch('/api/settings').then(function (r) { return r.json(); }),
      fetch('/api/campfire/rooms').then(function (r) { return r.json(); }).catch(function () { return []; }),
    ]);
    _sysData = {
      s: results[0].settings || {},
      rooms: Array.isArray(results[1]) ? results[1] : [],
    };
    sysRender();
  } catch (e) {
    host.innerHTML = '<div class="sg-section"><div style="color:var(--red);font-size:13px">Грешка при зареждане: ' + esc(e.message) + '</div></div>';
  }
}

function sysRender() {
  var host = document.getElementById('sgBody');
  if (!host || !_sysData) return;
  var s = _sysData.s;
  var reportOn = s.daily_report_enabled !== 'false';
  var gcalOn = s.google_calendar_enabled === 'true';
  var html = '';

  // --- 1. Дневен отчет ---
  var roomOpts = '<option value="">— избери канал —</option>' + _sysData.rooms.map(function (r) {
    return '<option value="' + esc(r.id) + '"' + (String(s.daily_report_room_id) === String(r.id) ? ' selected' : '') + '>' + esc(r.name) + '</option>';
  }).join('');
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">📊 Дневен отчет</div>' +
    '<div class="sg-section__desc">Сутрешно съобщение в Campfire — задачите за деня, публикациите и просрочените.</div>' +
    '<div class="ga-row ga-row--config">' +
      '<label class="ga-toggle"><input type="checkbox" ' + (reportOn ? 'checked' : '') +
        ' onchange="sysSave(\'daily_report_enabled\', this.checked ? \'true\' : \'false\', true)"> Включено</label>' +
      '<span class="ga-dim">' + (reportOn ? 'отчетът се изпраща по график' : 'изключено — нищо не се изпраща') + '</span>' +
    '</div>' +
    '<div class="sg-kp-grid">' +
      '<label class="sg-kp-field"><span class="sg-kp-label">Campfire канал</span>' +
        '<select class="ga-select sg-kp-select" onchange="sysSave(\'daily_report_room_id\', this.value)">' + roomOpts + '</select></label>' +
      '<label class="sg-kp-field"><span class="sg-kp-label">Час (cron израз)</span>' +
        '<input type="text" class="ga-input" value="' + esc(s.daily_report_cron || '30 9 * * 1-5') + '" placeholder="30 9 * * 1-5"' +
          ' onblur="sysSave(\'daily_report_cron\', this.value || \'30 9 * * 1-5\')">' +
        '<span class="sg-kp-note">„30 9 * * 1-5" = понеделник–петък в 9:30.</span></label>' +
    '</div>' +
    '<div class="ga-row ga-row--foot">' +
      '<button class="btn btn-sm" onclick="testDailyReport(this)">📤 Изпрати сега</button>' +
      '<span class="ga-dim">изпраща веднага в избрания канал</span>' +
    '</div>' +
  '</div>';

  // --- 2. Коментари ---
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">💬 Коментари</div>' +
    '<div class="sg-kp-rows">' +
      sysNumRow('comment_edit_window_minutes', 'Прозорец за редакция', s.comment_edit_window_minutes || '10', 1440, 'минути след изпращане, в които авторът може да редактира') +
    '</div>' +
  '</div>';

  // --- 3. Google Calendar (изнасяне на събития) ---
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">📅 Google Calendar — синхрон</div>' +
    '<div class="sg-section__desc">Изнася събитията от „Календар" в платформата към този Google календар. ' +
      'Различно от <a href="#/admin/calendar">Производствен календар</a>, където се управляват календарите за снимки и известията.</div>' +
    '<div class="ga-row ga-row--config">' +
      '<label class="ga-toggle"><input type="checkbox" ' + (gcalOn ? 'checked' : '') +
        ' onchange="sysSave(\'google_calendar_enabled\', this.checked ? \'true\' : \'false\', true)"> Включено</label>' +
      '<span class="ga-dim">' + (gcalOn ? 'синхронизацията работи' : 'изключено') + '</span>' +
    '</div>' +
    '<label class="sg-kp-field" style="margin-top:12px"><span class="sg-kp-label">Calendar ID</span>' +
      '<input type="text" class="ga-input" value="' + esc(s.google_calendar_id || '') + '" placeholder="xxxxx@group.calendar.google.com"' +
        ' onblur="sysSave(\'google_calendar_id\', this.value)"></label>' +
    '<div class="ga-share" style="display:block;line-height:1.6">' +
      '<strong>Настройка:</strong> Google Cloud Console → Google Calendar API → Service Account → JSON ключът се качва като ' +
      '<code>google-credentials.json</code> в root папката на сървъра → календарът се споделя със service account имейла (Make changes to events) → Calendar ID-то идва тук.' +
    '</div>' +
    '<div class="ga-row ga-row--foot">' +
      '<button class="btn btn-sm" onclick="testGoogleCalendar(this)">🔗 Тествай връзката</button>' +
      '<span class="ga-dim">проверява дали credentials-ът работи</span>' +
    '</div>' +
  '</div>';

  // --- 4. Логика: таймер + успеваемост ---
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">⏱ Таймер и успеваемост</div>' +
    '<div class="sg-section__desc">Таймерът на всяка дъска в Dashboard брои от последната просрочена задача. ' +
      'По подразбиране реагира само на production датите (измисляне, заснемане, монтаж, качване), не и на общия краен срок.</div>' +
    '<div class="ga-row ga-row--config">' +
      '<label class="ga-toggle"><input type="checkbox" ' + (s.timer_checks_due_on === 'true' ? 'checked' : '') +
        ' onchange="sysSave(\'timer_checks_due_on\', this.checked ? \'true\' : \'false\')"> Крайният срок (due date) също спира таймера</label>' +
    '</div>' +
    '<div class="sg-kp-rows" style="margin-top:12px">' +
      sysNumRow('success_rate_days', 'Успеваемост — период', s.success_rate_days || '90', 365, 'дни назад, за които се смята процентът завършени навреме (начална страница)', 7) +
    '</div>' +
  '</div>';

  host.innerHTML = html;
}

function sysNumRow(key, label, value, max, hint, min) {
  return '<div class="sg-kp-row">' +
    '<span class="sg-kp-row__label">' + esc(label) + '</span>' +
    '<input type="number" min="' + (min == null ? 0 : min) + '" max="' + max + '" class="ga-input sg-kp-num" value="' + esc(String(value)) + '"' +
      ' onblur="sysSave(\'' + key + '\', this.value || \'0\')">' +
    '<span class="sg-kp-row__hint">' + esc(hint) + '</span>' +
  '</div>';
}

// Запис + (по избор) преначертаване на секцията.
function sysSave(key, value, rerender) {
  saveSetting(key, value);
  if (_sysData) _sysData.s[key] = String(value);
  if (typeof _platformConfig === 'object') _platformConfig[key] = String(value);
  showToast('Запазено ✓', 'success', 1500);
  if (rerender) sysRender();
}

// ==================== СЕКЦИЯ: СЪЗДАВАНЕ НА ЗАДАЧИ ====================
// Настройките на инструмента от More (#/create-task) + историята кой какво е поръчвал.
// Картите ги създава ботът ThePactAlerts, затова в Basecamp авторът е винаги един —
// тази таблица е единственото място, където се вижда истинският поръчител.
var _tskAdm = null; // { s, init, tpl, history }

function sgSectionTasks(host) {
  host.innerHTML = '<div class="sg-section"><div class="ga-loading">Зареждане…</div></div>';
  tskAdmLoad();
}

async function tskAdmLoad() {
  var host = document.getElementById('sgBody');
  try {
    var results = await Promise.all([
      fetch('/api/settings').then(function (r) { return r.json(); }),
      fetch('/api/task-creator/init').then(function (r) { return r.json(); }).catch(function (e) { return { error: e.message }; }),
      fetch('/api/task-creator/templates').then(function (r) { return r.json(); }),
      fetch('/api/task-creator/history?limit=60').then(function (r) { return r.json(); }).catch(function () { return { items: [] }; }),
    ]);
    _tskAdm = {
      s: results[0].settings || {},
      init: results[1] || {},
      tpl: results[2] || {},
      history: (results[3] && results[3].items) || [],
    };
    tskAdmRender();
  } catch (e) {
    if (host) host.innerHTML = '<div class="sg-section"><div style="color:var(--red);font-size:13px">Грешка при зареждане: ' + esc(e.message) + '</div></div>';
  }
}

function tskAdmBoardOpts(sel) {
  var opts = '<option value=""' + (!sel ? ' selected' : '') + '>— авто: Pre-Production —</option>';
  ((_tskAdm.init || {}).boards || []).forEach(function (b) {
    opts += '<option value="' + esc(b.id) + '"' + (String(sel) === String(b.id) ? ' selected' : '') + '>' + esc(b.title) + '</option>';
  });
  return opts;
}

function tskAdmColOpts(boardId, sel) {
  var boards = (_tskAdm.init || {}).boards || [];
  var board = boards.find(function (b) { return String(b.id) === String(boardId); });
  if (!board) board = boards.find(function (b) { return /pre[\s-]*produc|предпрод/i.test(b.title || '') && !/post|пост/i.test(b.title || ''); });
  var opts = '<option value=""' + (!sel ? ' selected' : '') + '>— авто: Измисляне —</option>';
  ((board && board.columns) || []).forEach(function (c) {
    opts += '<option value="' + esc(c.id) + '"' + (String(sel) === String(c.id) ? ' selected' : '') + '>' + esc(c.title) + (c.isDone ? ' (Done)' : '') + '</option>';
  });
  return opts;
}

function tskAdmRender() {
  var host = document.getElementById('sgBody');
  if (!host || !_tskAdm) return;
  var s = _tskAdm.s, tpl = _tskAdm.tpl, init = _tskAdm.init;
  var html = '';

  // --- 1. Дестинация за задачите „Измисляне" ---
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">💡 Задача за измисляне — къде отива</div>' +
    '<div class="sg-section__desc">Инструментът е в <a href="#/create-task">More → Създаване на задачи</a> и е достъпен за всички. ' +
      'Празно = авто (Pre-Production → Измисляне) или каквото е зададено в <a href="#/admin/kp">КП-Автоматизация</a>.</div>' +
    (init.error
      ? '<div class="ga-empty" style="color:var(--yellow)">⚠ Basecamp не отговори (' + esc(init.error) + ') — дъската не може да се избере сега.</div>'
      : '<div class="sg-kp-grid">' +
          '<label class="sg-kp-field"><span class="sg-kp-label">Дъска (Card Table)</span>' +
            '<select class="ga-select sg-kp-select" id="tskAdmBoard" onchange="tskAdmBoardChange(this.value)">' + tskAdmBoardOpts(s.task_plan_board_id) + '</select></label>' +
          '<label class="sg-kp-field"><span class="sg-kp-label">Колона</span>' +
            '<select class="ga-select sg-kp-select" id="tskAdmCol" onchange="tskAdmSave(\'task_plan_column_id\', this.value)">' + tskAdmColOpts(s.task_plan_board_id, s.task_plan_column_id) + '</select></label>' +
        '</div>') +
    '<div class="sg-kp-rows" style="margin-top:12px">' +
      '<div class="sg-kp-row"><span class="sg-kp-row__label">Брой видеа по подразбиране</span>' +
        '<input type="number" min="1" max="60" class="ga-input sg-kp-num" value="' + esc(String(tpl.defaultVideos || 10)) + '" onblur="tskAdmSave(\'task_default_videos\', this.value || \'10\')">' +
        '<span class="sg-kp-row__hint">колко видео секции стоят във формата при отваряне</span></div>' +
      '<div class="sg-kp-row"><span class="sg-kp-row__label">Максимум видеа</span>' +
        '<input type="number" min="1" max="60" class="ga-input sg-kp-num" value="' + esc(String(tpl.maxVideos || 30)) + '" onblur="tskAdmSave(\'task_max_videos\', this.value || \'30\')">' +
        '<span class="sg-kp-row__hint">таван, за да не се налее борда по грешка (хард лимит 60)</span></div>' +
    '</div>' +
  '</div>';

  // --- 2. Шаблон на задачата за измисляне ---
  var own = tpl.ownTemplate || tpl.ownVideoSection;
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">✏️ Шаблон на задачата за измисляне</div>' +
    '<div class="sg-section__desc">' + (own
      ? 'Инструментът има <strong>собствен</strong> шаблон. Изтрий текста и запази, за да се върне към шаблона от <a href="#/admin/kp">КП-Автоматизация</a>.'
      : 'В момента се ползва шаблонът от <a href="#/admin/kp">КП-Автоматизация</a>. Промениш ли текста тук, инструментът ще си има собствен.') + '</div>' +
    '<label class="sg-kp-field"><span class="sg-kp-label">Основен текст</span>' +
      '<textarea class="ga-input sg-kp-textarea" id="tskAdmTplMain" rows="7">' + esc(tpl.template || '') + '</textarea>' +
      '<span class="sg-kp-note">{клиент} = името на задачата · {video_sections} = секциите за видеата · {брой} = избраният брой видеа</span></label>' +
    '<label class="sg-kp-field" style="margin-top:12px"><span class="sg-kp-label">Секция за всяко видео</span>' +
      '<textarea class="ga-input sg-kp-textarea" id="tskAdmTplVideo" rows="7">' + esc(tpl.videoSection || '') + '</textarea>' +
      '<span class="sg-kp-note">{N} = номер на видеото. Повтаря се за всяко избрано видео.</span></label>' +
    '<span class="sg-kp-note" style="display:block;margin-top:10px">Полето „Допълнителна информация" от формата влиза на реда „Допълнителна информация" в основния текст ' +
      '(на мястото на ХХХ). Може и изрично — с плейсхолдъра <code>{доп_информация}</code>. Няма ли нито едното, текстът се добавя най-отдолу.</span>' +
    '<div class="ga-row ga-row--foot">' +
      '<button class="btn btn-sm" onclick="tskAdmSaveTemplates(this)">💾 Запази шаблона</button>' +
    '</div>' +
  '</div>';

  // --- 2б. Шаблон в описанието на единичната задача ---
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">📝 Описание на единичната задача</div>' +
    '<div class="sg-section__desc">' + (tpl.ownSingleTemplate
      ? 'Инструментът има <strong>собствен</strong> текст. Изтрий го и запази, за да се върне автоматичният (секцията за едно видео).'
      : 'По подразбиране е секцията за едно видео отгоре, без реда със заглавието — той е самото име на задачата. Промениш ли текста, инструментът ще си има собствен.') +
      ' Формата тръгва с този текст попълнен, а човекът само сменя ХХХ-тата.</div>' +
    '<textarea class="ga-input sg-kp-textarea" id="tskAdmTplSingle" rows="9">' + esc(tpl.singleTemplate || '') + '</textarea>' +
    '<div class="ga-row ga-row--foot">' +
      '<button class="btn btn-sm" onclick="tskAdmSaveTemplates(this)">💾 Запази шаблона</button>' +
    '</div>' +
  '</div>';

  // --- 3. Стъпки на единичната задача ---
  var steps = tpl.steps || [];
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">🎬 Стъпки на единичната задача</div>' +
    '<div class="sg-section__desc">Всяка нова единична задача получава тези стъпки. Числото е колко <strong>работни дни преди датата за публикуване</strong> ' +
      'пада стъпката — по него се смятат сами останалите дати във формата. Отмесванията 11 / 6 / 1 са същите, с които работи и авто-синхронът на датите; ' +
      '„Измисляне" е само на този инструмент. Полетата във формата се подреждат по числото — първо най-отдалеченото от публикуването.</div>' +
    '<div class="sg-kp-rows" id="tskAdmSteps">' +
      '<div class="sg-kp-row" style="border-top:none">' +
        '<span class="sg-kp-row__hint" style="flex:1;min-width:220px">Заглавие на стъпката в Basecamp</span>' +
        '<span class="sg-kp-row__hint" style="flex:0 0 150px">Име на полето</span>' +
        '<span class="sg-kp-row__hint" style="flex:0 0 74px;text-align:center">Дни</span>' +
        '<span style="width:34px"></span>' +
      '</div>' +
      steps.map(function (st, i) {
        return '<div class="sg-kp-row">' +
          '<input type="text" class="ga-input" style="flex:1;min-width:220px" value="' + esc(st.title) + '" data-tsk-step-title="' + i + '">' +
          '<input type="text" class="ga-input" style="flex:0 0 150px" value="' + esc(st.label || '') + '" data-tsk-step-label="' + i + '">' +
          '<input type="number" min="0" max="365" class="ga-input sg-kp-num" value="' + esc(String(st.offset)) + '" data-tsk-step-offset="' + i + '">' +
          '<button class="btn btn-sm btn-ghost" style="color:var(--red)" onclick="tskAdmRemoveStep(' + i + ')">✕</button>' +
        '</div>';
      }).join('') +
    '</div>' +
    '<div class="ga-row ga-row--foot">' +
      '<button class="btn btn-sm" onclick="tskAdmAddStep()">+ Стъпка</button>' +
      '<button class="btn btn-sm" onclick="tskAdmSaveSteps(this)">💾 Запази стъпките</button>' +
      '<button class="btn btn-sm btn-ghost" onclick="tskAdmResetSteps()">↺ По подразбиране</button>' +
    '</div>' +
  '</div>';

  // --- 4. История ---
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">📜 История — кой какви задачи е поръчвал</div>' +
    '<div class="sg-section__desc">Картите в Basecamp се създават от бота ThePactAlerts, затова истинският поръчител се вижда само тук.</div>' +
    tskAdmHistoryHtml() +
  '</div>';

  host.innerHTML = html;
}

function tskAdmHistoryHtml() {
  var items = _tskAdm.history || [];
  if (!items.length) return '<div class="ga-empty">Още никой не е създавал задачи през инструмента.</div>';
  var rows = items.map(function (it) {
    var who = it.current_name || it.user_name || '—';
    var kind = it.kind === 'plan' ? 'Измисляне' : 'Единична';
    var title = it.card_url
      ? '<a href="' + esc(it.card_url) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a>'
      : esc(it.title);
    var where = esc(it.board_title || '') + (it.column_title ? ' → ' + esc(it.column_title) : '');
    var extra = it.kind === 'plan'
      ? (it.video_count ? it.video_count + ' видеа' : '')
      : (it.due_on ? 'публикуване ' + esc(formatDate(String(it.due_on))) : '');
    return '<tr>' +
      '<td style="white-space:nowrap;color:var(--text-dim)">' + esc(new Date(it.created_at).toLocaleString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</td>' +
      '<td>' + esc(who) + '</td>' +
      '<td><span class="tcl-kind tcl-kind--' + (it.kind === 'plan' ? 'plan' : 'single') + '">' + kind + '</span></td>' +
      '<td>' + title + '</td>' +
      '<td style="color:var(--text-dim)">' + where + '</td>' +
      '<td style="color:var(--text-dim);white-space:nowrap">' + extra + '</td>' +
    '</tr>';
  }).join('');
  return '<div style="overflow-x:auto"><table class="tcl-table">' +
    '<thead><tr><th>Кога</th><th>Кой</th><th>Вид</th><th>Задача</th><th>Къде</th><th>Детайли</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
}

function tskAdmSave(key, value, rerender) {
  saveSetting(key, value);
  if (_tskAdm) _tskAdm.s[key] = String(value);
  showToast('Запазено ✓', 'success', 1500);
  if (rerender) tskAdmRender();
}

function tskAdmBoardChange(boardId) {
  tskAdmSave('task_plan_board_id', boardId);
  tskAdmSave('task_plan_column_id', ''); // колоната от старата дъска вече не важи
  var col = document.getElementById('tskAdmCol');
  if (col) col.innerHTML = tskAdmColOpts(boardId, '');
}

// Текстовите полета тръгват попълнени с наследения текст. Ако човек не го е пипал,
// НЕ го записваме като собствен — иначе едно натискане на „Запази" би откачило
// инструмента от КП шаблона завинаги. Празен низ = изтриване → пак се наследява.
function _tskAdmTplValue(id, original, isOwn) {
  var v = (document.getElementById(id) || {}).value;
  if (v == null) return null; // полето го няма на екрана — не го пипаме
  return (!isOwn && v === (original || '')) ? '' : v;
}

async function tskAdmSaveTemplates(btn) {
  var tpl = _tskAdm.tpl || {};
  var body = {
    template: _tskAdmTplValue('tskAdmTplMain', tpl.template, tpl.ownTemplate),
    videoSection: _tskAdmTplValue('tskAdmTplVideo', tpl.videoSection, tpl.ownVideoSection),
    singleTemplate: _tskAdmTplValue('tskAdmTplSingle', tpl.singleTemplate, tpl.ownSingleTemplate),
  };
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Запазване…'; }
  try {
    var res = await fetch('/api/task-creator/templates', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showToast('Шаблонът е запазен ✓', 'success');
    await tskAdmLoad();
  } catch (e) {
    showToast('Грешка: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Запази шаблона'; }
  }
}

function tskAdmCollectSteps() {
  var host = document.getElementById('tskAdmSteps');
  if (!host) return [];
  var titles = host.querySelectorAll('[data-tsk-step-title]');
  var out = [];
  Array.prototype.forEach.call(titles, function (t) {
    var i = t.getAttribute('data-tsk-step-title');
    var l = host.querySelector('[data-tsk-step-label="' + i + '"]');
    var o = host.querySelector('[data-tsk-step-offset="' + i + '"]');
    if (t.value.trim()) {
      out.push({
        title: t.value.trim(),
        label: ((l && l.value) || '').trim(),
        offset: parseInt(o && o.value, 10) || 0,
      });
    }
  });
  return out;
}

function tskAdmAddStep() {
  _tskAdm.tpl.steps = tskAdmCollectSteps().concat([{ key: 'new', title: '', label: '', offset: 0 }]);
  tskAdmRender();
}

function tskAdmRemoveStep(idx) {
  var steps = tskAdmCollectSteps();
  steps.splice(idx, 1);
  _tskAdm.tpl.steps = steps;
  tskAdmRender();
}

// Празен списък към сървъра = изтриване на настройката → връщат се 11/6/1.
function tskAdmResetSteps() { tskAdmSaveSteps(null, []); }

async function tskAdmSaveSteps(btn, override) {
  var steps = override || tskAdmCollectSteps();
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Запазване…'; }
  try {
    var res = await fetch('/api/task-creator/steps', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps: steps }),
    });
    var data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || ('HTTP ' + res.status));
    showToast('Стъпките са запазени ✓', 'success');
    await tskAdmLoad();
  } catch (e) {
    showToast('Грешка: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Запази стъпките'; }
  }
}
