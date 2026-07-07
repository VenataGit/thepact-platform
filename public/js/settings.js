// ==================== ГЛОБАЛНИ НАСТРОЙКИ (нов админ панел) ====================
// Панелът е разделен на подменюта (лява навигация): #/admin/<секция>.
//   🎨 Тема               — шрифт + основни цветове (прилага се за целия екип)
//   📋 КП-Автоматизация   — къде отиват КП картите (Basecamp), текстове, дати, график
//   🗂 Dashboard          — кои Card Tables виждат всички
//   📅 Календар известия  — Google Calendar → Basecamp
// Старият панел остава достъпен на #/admin-legacy (линк долу в навигацията).

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
  { id: 'kp', icon: '📋', label: 'КП-Автоматизация', hint: 'Basecamp, текстове, график', adminOnly: true },
  { id: 'dashboard', icon: '🗂', label: 'Dashboard', hint: 'Дъски за всички', adminOnly: true },
  { id: 'calendar', icon: '📅', label: 'Календар известия', hint: 'GCal → Basecamp', adminOnly: false },
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
  if (currentUser && currentUser.role !== 'admin' && currentUser.role !== 'mini_admin') {
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--red)">Нямаш достъп до тази страница.</div>';
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
          '<a class="sg-nav__item sg-nav__item--legacy" href="#/admin-legacy">' +
            '<span class="sg-nav__icon">🛠</span>' +
            '<span class="sg-nav__txt"><span class="sg-nav__label">Разширени</span>' +
            '<span class="sg-nav__hint">Стар панел</span></span>' +
          '</a>' +
        '</nav>' +
        '<div class="sg-body" id="sgBody"></div>' +
      '</div>' +
    '</div>';

  var body = document.getElementById('sgBody');
  if (active === 'theme') sgSectionTheme(body);
  else if (active === 'kp') sgSectionKp(body);
  else if (active === 'dashboard') sgSectionDashboard(body);
  else if (active === 'calendar') sgSectionCalendar(body);
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
    '<div class="sg-foot">' +
      '<button class="btn btn-sm" onclick="sgResetAll()">↺ Нулирай темата</button>' +
    '</div>';
  sgRenderFonts();
  sgRenderColors();
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
      '<div class="sg-section__hdr">📅 Календар известия</div>' +
      '<div class="sg-section__desc">Ново събитие в Google Calendar → съобщение в Basecamp с тагнати създател и отговорници. Промяна или отмяна → коментар под същото съобщение. Никой друг не получава известие.</div>' +
      '<div id="gaBody"><div class="ga-loading">Зареждане…</div></div>' +
    '</div>';
  gaLoad();
}

// ==================== СЕКЦИЯ: КП-АВТОМАТИЗАЦИЯ ====================
// Настройки за създаването на КП (контент план) карти: дестинация в Basecamp
// (дъска/колона), заглавие и текстове, дати, авто-график. Самите клиенти са на #/kp-auto.

var _kpAdm = null; // { s: settings, tpl: {template, videoSection}, boards: [...] | null, bcError }

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
    ]);
    _kpAdm = {
      s: results[0].settings || {},
      tpl: results[1] || {},
      boards: results[2].boards || null,
      bcError: results[2].error || null,
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
      '<label class="sg-kp-field"><span class="sg-kp-label">Следващ КП се пуска, щом предишният напусне</span>' +
        '<select class="ga-select sg-kp-select" onchange="kpAdmSave(\'kp_bc_check_scope\', this.value)">' +
          '<option value="column"' + (s.kp_bc_check_scope !== 'board' ? ' selected' : '') + '>колоната (напр. Измисляне)</option>' +
          '<option value="board"' + (s.kp_bc_check_scope === 'board' ? ' selected' : '') + '>целия борд (без Done)</option>' +
        '</select>' +
        '<span class="sg-kp-note">Така се разпознава „клиентът вече има активен КП".</span></label>' +
    '</div>' +
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

  // --- 3. Дати и обем ---
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">📆 Дати и обем</div>' +
    '<div class="sg-kp-rows">' +
      kpAdmNumRow('kp_bc_due_days', 'Срок на КП картата (Due date)', s.kp_bc_due_days === undefined ? '10' : s.kp_bc_due_days, 'работни дни преди първото видео · празно = без срок', true) +
      kpAdmNumRow('kp_calendar_window', 'Календарен прозорец', s.kp_calendar_window || '30', 'календарни дни, в които се разпределят видеата') +
      kpAdmNumRow('kp_days_before_next_kp', 'Създаване на следващ КП', s.kp_days_before_next_kp || '15', 'работни дни преди първото видео на следващия КП') +
      kpAdmNumRow('kp_default_videos', 'Видеа по подразбиране', s.kp_default_videos || '10', 'за нов клиент, ако не е зададено друго') +
    '</div>' +
  '</div>';

  // --- 4. Авто-създаване ---
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

  host.innerHTML = html;
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
      showToast('✓ КП картите отиват в: ' + j.board + ' → ' + j.column +
        (j.dueDays != null ? ' · срок ' + j.dueDays + ' раб. дни преди 1-то видео' : ' · без срок') +
        ' · пример: „' + j.titleExample + '"', 'success', 8000);
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

  // Глобален ред: on/off + Message Board линк
  html += '<div class="ga-row ga-row--config">' +
      '<label class="ga-toggle"><input type="checkbox" ' + (d.enabled ? 'checked' : '') + ' onchange="gaToggleEnabled(this.checked)"> Включено</label>' +
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
      '<div class="ga-share">Стъпка 1: сподели календара (Настройки → Споделяне с конкретни хора → „Вижда всички подробности") с:' +
        '<code class="ga-sa" id="gaSaEmail">' + esc(d.saEmail || 'няма credentials') + '</code>' +
        '<button class="ga-copy" title="Копирай" onclick="gaCopySa()">⧉</button>' +
        '<span class="ga-dim">Стъпка 2: постави линка/ID-то горе.</span>' +
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
