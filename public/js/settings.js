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
      '<div class="sg-foot">' +
        '<button class="btn btn-sm" onclick="sgResetAll()">↺ Нулирай темата</button>' +
        '<a class="sg-legacy" href="#/admin-legacy">Разширени / стар панел →</a>' +
      '</div>' +
    '</div>';
  sgRenderFonts();
  sgRenderColors();
}

function sgRenderFonts() {
  var host = document.getElementById('sgFonts');
  if (!host) return;
  var cur = _platformConfig.theme_font_family || '';
  host.innerHTML = SG_FONTS.map(function (f) {
    var active = (f.value === cur) ? ' sg-font--active' : '';
    var ff = f.value ? ("'" + f.value + "', sans-serif") : 'var(--font-family)';
    return '<button class="sg-font' + active + '" style="font-family:' + ff + '" onclick="sgApplyFont(' + JSON.stringify(f.value) + ')">' +
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
