// ==================== THEME ADMIN UI (apply colors, picker, UI handlers) ====================
function _hexToRgba(hex, alpha) {
  hex = (hex || '').replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  var r = parseInt(hex.substring(0,2), 16), g = parseInt(hex.substring(2,4), 16), b = parseInt(hex.substring(4,6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function _loadGoogleFont(fontName) {
  var id = 'theme-google-font', el = document.getElementById(id);
  if (el) el.remove();
  if (!fontName || fontName === 'Inter') return;
  var link = document.createElement('link');
  link.id = id; link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(fontName) + ':wght@400;500;600;700;800;900&display=swap';
  document.head.appendChild(link);
}

function applyThemeColors() {
  var style = document.getElementById('themeOverrides');
  if (!style) { style = document.createElement('style'); style.id = 'themeOverrides'; document.head.appendChild(style); }
  var c = _platformConfig, rootVars = '', extraCss = '';
  // Apply all theme settings — обхожда THEME_TABS вместо THEME_CONFIG за пълно покритие
  THEME_TABS.forEach(function(tab) {
    tab.groups.forEach(function(group) {
      group.items.forEach(function(item) {
        if (!item.css || !c[item.key]) return;
        var val = c[item.key];
        if (item.type === 'range' && item.unit) val = val + item.unit;
        else if (item.type === 'select' && item.css === '--font-family') {
          _loadGoogleFont(val);
          val = '"' + val + '", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        }
        rootVars += '  ' + item.css + ': ' + val + ';\n';
      });
    });
  });
  // Auto-derive dim/tint variants when главните цветове са променени
  var dimMap = { theme_accent: '--accent-dim', theme_green: '--green-dim', theme_yellow: '--yellow-dim', theme_red: '--red-dim', theme_blue: '--blue-dim', theme_orange: '--orange-dim', theme_purple: '--purple-dim', theme_teal: '--teal-dim' };
  Object.keys(dimMap).forEach(function(k) { if (c[k]) rootVars += '  ' + dimMap[k] + ': ' + _hexToRgba(c[k], 0.12) + ';\n'; });
  // Dashboard auto-derive tint backgrounds from border colors
  var dashDerive = { theme_dash_ok: ['--dash-ok-bg', 0.08], theme_dash_soon: ['--dash-soon-bg', 0.08], theme_dash_today: ['--dash-today-bg', 0.12], theme_dash_hold: ['--dash-hold-bg', 0.1] };
  Object.keys(dashDerive).forEach(function(k) { if (c[k]) rootVars += '  ' + dashDerive[k][0] + ': ' + _hexToRgba(c[k], dashDerive[k][1]) + ';\n'; });
  // Auto-derive deadline-dash backgrounds from main deadline backgrounds (за визуална консистентност между kanban и dashboard)
  // Само ако потребителят не е задал директно стойност за dash вариант
  // Hey auto-derive tints
  if (c.theme_hey_unread) rootVars += '  --hey-unread-bg: ' + _hexToRgba(c.theme_hey_unread, 0.06) + ';\n';
  if (c.theme_hey_bookmarks) rootVars += '  --hey-bookmarks-bg: ' + _hexToRgba(c.theme_hey_bookmarks, 0.04) + ';\n';
  if (rootVars) extraCss += ':root {\n' + rootVars + '}\n';
  // Navigation overrides (използва се special CSS защото няма .nav__bar var директно)
  if (c.theme_nav_bg) extraCss += '.nav__bar { background: ' + c.theme_nav_bg + ' !important; }\n';
  if (c.theme_nav_text) {
    extraCss += '.nav__link { color: ' + c.theme_nav_text + '; }\n';
    // Hover is intentionally NOT overridden — Ventsi prefers no hover/active
    // coloring on the main nav. Keep the base layout.css rule (transparent bg).
  }
  // Note: active menu coloring is disabled per user request. The .nav__link.active
  // class is still added by router.js for future styling hooks, but no background
  // or color change is applied here anymore.
  style.textContent = extraCss;
  // Cache for the inline bootstrap script in index.html — prevents FOUC (flash of
  // default theme) on next page load. The bootstrap reads this on DOM parse and
  // injects the <style> before <body> renders.
  try { localStorage.setItem('thepact-theme-css', extraCss); } catch (e) { /* quota / private mode */ }
}

// Текущ активен sub-tab в Персонализация (сесийно)
var _currentThemeTab = 'global';

function loadAdminColors() {
  var el = document.getElementById('adminColorsContent');
  if (!el) return;
  // Общ контейнер: header + sub-tabs + content
  var html = '<div class="theme-admin-wrap">';
  // Header
  html += '<div class="theme-admin-hdr">' +
    '<div class="theme-admin-hint">💡 Промените се прилагат на живо. Кликнете ↺ за връщане към стойност по подразбиране.</div>' +
    '<button class="btn btn-sm theme-reset-all" onclick="resetAllTheme()">↺ Нулирай всичко</button>' +
    '</div>';
  // Sub-tab buttons
  html += '<div class="theme-tabs-nav">';
  THEME_TABS.forEach(function(tab) {
    var isActive = (tab.id === _currentThemeTab) ? ' active' : '';
    html += '<button class="theme-tab-btn' + isActive + '" onclick="showThemeTab(\'' + tab.id + '\')" title="' + esc(tab.description) + '">' +
      '<span class="theme-tab-icon">' + tab.icon + '</span>' +
      '<span class="theme-tab-label">' + esc(tab.label) + '</span>' +
      '</button>';
  });
  html += '</div>';
  // Content area (filled by renderThemeTabContent)
  html += '<div id="themeTabContent" class="theme-tab-content"></div>';
  html += '</div>';
  el.innerHTML = html;
  renderThemeTabContent();
}

function showThemeTab(tabId) {
  _currentThemeTab = tabId;
  // Update tab button active states
  var btns = document.querySelectorAll('.theme-tab-btn');
  btns.forEach(function(b) { b.classList.remove('active'); });
  var idx = 0;
  THEME_TABS.forEach(function(t, i) { if (t.id === tabId) idx = i; });
  if (btns[idx]) btns[idx].classList.add('active');
  renderThemeTabContent();
}

function renderThemeTabContent() {
  var contentEl = document.getElementById('themeTabContent');
  if (!contentEl) return;
  var s = _platformConfig;
  var tab = null;
  for (var i = 0; i < THEME_TABS.length; i++) {
    if (THEME_TABS[i].id === _currentThemeTab) { tab = THEME_TABS[i]; break; }
  }
  if (!tab) tab = THEME_TABS[0];
  var html = '';
  // Tab header with icon, label, description
  html += '<div class="theme-tab-hdr">' +
    '<div class="theme-tab-hdr-icon">' + tab.icon + '</div>' +
    '<div class="theme-tab-hdr-text">' +
      '<h3>' + esc(tab.label) + '</h3>' +
      '<p>' + esc(tab.description) + '</p>' +
    '</div>' +
    '</div>';
  // Render groups
  tab.groups.forEach(function(group) {
    html += '<div class="theme-group">';
    html += '<div class="theme-group-hdr">' +
      '<h4>' + (group.icon || '') + ' ' + esc(group.title) + '</h4>' +
      (group.desc ? '<p class="theme-group-desc">' + esc(group.desc) + '</p>' : '') +
      '</div>';
    html += '<div class="theme-group-items">';
    group.items.forEach(function(item) {
      var val = s[item.key] || item.def;
      html += '<div class="theme-row">';
      html += '<div class="theme-row-label">' +
        '<div class="theme-row-name">' + esc(item.label) + '</div>' +
        (item.hint ? '<div class="theme-row-hint">' + esc(item.hint) + '</div>' : '') +
        '</div>';
      html += '<div class="theme-row-control">';
      if (item.type === 'color') {
        // Detect if value is rgba — show only text input + transparent picker fallback
        var isRgba = (val + '').indexOf('rgba') === 0 || (val + '').indexOf('rgb(') === 0;
        var hexForPicker = isRgba ? _rgbaToHex(val) : val;
        html += '<input type="color" class="theme-color-picker" id="' + item.key + '_picker" value="' + esc(hexForPicker) + '" ' +
          'oninput="previewTheme(\'' + item.key + '\',this.value)" onchange="saveTheme(\'' + item.key + '\',this.value)">';
        html += '<input class="theme-color-text" type="text" id="' + item.key + '_text" value="' + esc(val) + '" ' +
          'onblur="saveTheme(\'' + item.key + '\',this.value,true)">';
        html += '<button class="theme-reset-btn" onclick="resetTheme(\'' + item.key + '\',\'' + esc(item.def) + '\')" title="По подразбиране">↺</button>';
      } else if (item.type === 'range') {
        html += '<input type="range" class="theme-range" id="' + item.key + '_range" value="' + esc(val) + '" ' +
          'min="' + item.min + '" max="' + item.max + '" step="' + item.step + '" ' +
          'oninput="previewTheme(\'' + item.key + '\',this.value);document.getElementById(\'' + item.key + '_val\').textContent=this.value+\'' + (item.unit || '') + '\'" ' +
          'onchange="saveTheme(\'' + item.key + '\',this.value)">';
        html += '<span class="theme-range-val" id="' + item.key + '_val">' + esc(val) + (item.unit || '') + '</span>';
        html += '<button class="theme-reset-btn" onclick="resetThemeRange(\'' + item.key + '\',\'' + item.def + '\',\'' + (item.unit || '') + '\')" title="По подразбиране">↺</button>';
      } else if (item.type === 'select') {
        html += '<select class="theme-select" id="' + item.key + '_select" onchange="saveTheme(\'' + item.key + '\',this.value)">';
        item.options.forEach(function(opt) {
          html += '<option value="' + opt + '"' + (val === opt ? ' selected' : '') + '>' + opt + '</option>';
        });
        html += '</select>';
        html += '<button class="theme-reset-btn" onclick="resetThemeSelect(\'' + item.key + '\',\'' + item.def + '\')" title="По подразбиране">↺</button>';
      }
      html += '</div></div>'; // /control /row
    });
    html += '</div></div>'; // /items /group
  });
  contentEl.innerHTML = html;
}

// Helper: rgba string to approximate hex (за color picker)
function _rgbaToHex(rgba) {
  var m = (rgba + '').match(/rgba?\(([^)]+)\)/);
  if (!m) return '#000000';
  var parts = m[1].split(',').map(function(s) { return parseFloat(s.trim()); });
  var r = Math.round(parts[0] || 0), g = Math.round(parts[1] || 0), b = Math.round(parts[2] || 0);
  function pad(n) { var h = n.toString(16); return h.length < 2 ? '0' + h : h; }
  return '#' + pad(r) + pad(g) + pad(b);
}

function previewTheme(key, value) {
  _platformConfig[key] = value;
  applyThemeColors();
  var t = document.getElementById(key + '_text');
  if (t) t.value = value;
}

function saveTheme(key, value, fromText) {
  _platformConfig[key] = value;
  saveSetting(key, value);
  applyThemeColors();
  if (!fromText) { var t = document.getElementById(key + '_text'); if (t) t.value = value; }
  var p = document.getElementById(key + '_picker');
  // Update picker only if value is hex (picker не приема rgba)
  if (p && /^#[0-9a-fA-F]{6}$/.test(value) && p.value !== value) p.value = value;
}

function resetTheme(key, def) {
  _platformConfig[key] = '';
  saveSetting(key, '');
  applyThemeColors();
  var t = document.getElementById(key + '_text'); if (t) t.value = def;
  var p = document.getElementById(key + '_picker');
  if (p) {
    if (/^#[0-9a-fA-F]{6}$/.test(def)) { p.value = def; }
    else { p.value = _rgbaToHex(def); }
  }
}

function resetThemeRange(key, def, unit) {
  _platformConfig[key] = '';
  saveSetting(key, '');
  applyThemeColors();
  var r = document.getElementById(key + '_range'); if (r) r.value = def;
  var v = document.getElementById(key + '_val'); if (v) v.textContent = def + (unit || '');
}

function resetThemeSelect(key, def) {
  _platformConfig[key] = '';
  saveSetting(key, '');
  applyThemeColors();
  var s = document.getElementById(key + '_select'); if (s) s.value = def;
}

function resetAllTheme() {
  THEME_TABS.forEach(function(tab) {
    tab.groups.forEach(function(group) {
      group.items.forEach(function(item) {
        _platformConfig[item.key] = '';
        saveSetting(item.key, '');
      });
    });
  });
  applyThemeColors();
  loadAdminColors();
}

