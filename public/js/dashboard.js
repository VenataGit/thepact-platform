// ==================== DASHBOARD — Basecamp-backed ====================
// Landing page after login. Pulls Video Production tasks from Basecamp and groups them by
// board (card table) -> column. Drag a card to another column to move it in Basecamp
// (recorded as the logged-in user). Two-stage load keeps the 300+ card board responsive.

// --- per-USER visibility settings (hidden / minimized / maximized boards, hidden columns) ---
// Stored server-side (user_prefs, key 'dash_prefs') so each person's setup follows them
// on any device. They arrive together with the structure (GET /api/bc-board → prefs).
let _dashPrefs = null;      // { hiddenBoards:[], hiddenCols:[], minimized:[], maximized:null }
let _dashPrefsSaveT = null;
let _dashPrefsDirty = false; // unsaved local changes — don't let a server reload clobber them

function _dashPrefsNorm(p) {
  const arr = (v) => (Array.isArray(v) ? v.map(String) : []);
  p = p || {};
  return {
    hiddenBoards: arr(p.hiddenBoards), hiddenCols: arr(p.hiddenCols),
    minimized: arr(p.minimized), maximized: p.maximized ? String(p.maximized) : null,
  };
}
// One-time seed from the old per-browser localStorage keys, so nobody loses the setup
// they already had before the prefs moved to the server.
function _dashPrefsSeedFromLocal() {
  const ls = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
  return _dashPrefsNorm({ hiddenBoards: ls('thepact-dash-hidden-boards'), hiddenCols: ls('thepact-dash-hidden-cols') });
}
function dashSavePrefs() {
  if (!_dashPrefs) return;
  _dashPrefs.maximized = expandedDashCol || null;
  _dashPrefsDirty = true;
  clearTimeout(_dashPrefsSaveT);
  _dashPrefsSaveT = setTimeout(() => {
    fetch('/api/bc-board/prefs', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_dashPrefs),
    }).then((r) => { if (r.ok) _dashPrefsDirty = false; })
      .catch(() => { /* offline — prefs stay in memory for this session */ });
  }, 400);
}
function getDashHiddenBoards() { return new Set(_dashPrefs ? _dashPrefs.hiddenBoards : []); }
function saveDashHiddenBoards(set) { if (_dashPrefs) { _dashPrefs.hiddenBoards = [...set]; dashSavePrefs(); } }
function getDashHiddenCols() { return new Set(_dashPrefs ? _dashPrefs.hiddenCols : []); }
function saveDashHiddenCols(set) { if (_dashPrefs) { _dashPrefs.hiddenCols = [...set]; dashSavePrefs(); } }
function getDashMinimized() { return new Set(_dashPrefs ? _dashPrefs.minimized : []); }
function saveDashMinimized(set) { if (_dashPrefs) { _dashPrefs.minimized = [...set]; dashSavePrefs(); } }

function initDashDefaults(boards) {
  // Hide the noisier internal boards by default; the team can re-enable them in ⚙ Настройки.
  if (!localStorage.getItem('thepact-dash-defaults-bc')) {
    const hidden = getDashHiddenBoards();
    boards.forEach((b) => { if (/задачи|ops\/admin|услуги извън/i.test(b.title)) hidden.add(String(b.id)); });
    saveDashHiddenBoards(hidden);
    localStorage.setItem('thepact-dash-defaults-bc', '1');
  }
  // Hide "Not now" + Done columns across all boards by default (separate one-time
  // flag so it doesn't clobber board choices the user already made).
  if (!localStorage.getItem('thepact-dash-coldefaults-bc')) {
    const hiddenCols = getDashHiddenCols();
    boards.forEach((b) => (b.columns || []).forEach((c) => {
      if (c.isDone || /not\s*now/i.test(c.title || '') || /\bdone\b|готово/i.test(c.title || '')) hiddenCols.add(String(c.id));
    }));
    saveDashHiddenCols(hiddenCols);
    localStorage.setItem('thepact-dash-coldefaults-bc', '1');
  }
}

let _dashStruct = null;     // { boards: [{ id, title, columns: [{ id, title, cardsCount, isDone }] }] }
let _dashLayout = {};       // global { boardOrder: [ids], colOrder: { boardId: [ids] } } — set by an admin
const _dashCards = {};      // boardId -> { colId -> [cards] }
const _dashLoading = {};    // boardId -> bool
const _dashTimers = {};     // boardId -> { since, paused } — "time since no overdue" timer
const _dashOnHold = {};     // boardId -> { colId -> [on-hold cards] } (shown below normals)
let _dashAutoRefreshId = null;
let expandedDashCol = null;   // board id expanded to full width (others collapse)
let _dashDragCardId = null, _dashDragBoardId = null, _dashDragFromCol = null;

// --- филтър (⛃ Филтър до ⚙ Настройки) ------------------------------------------
// Само за текущата сесия — нарочно НЕ се пази (нито в prefs, нито в localStorage),
// за да не завариш дашборда мистериозно "празен" при следващо влизане. „Изчисти"
// връща нормалния изглед с всички задачи.
let _dashFilter = { client: '', block: '', due: '', assignee: '' };

function dashFilterCount() { return ['client', 'block', 'due', 'assignee'].filter((k) => _dashFilter[k]).length; }
function dashFilterActive() { return dashFilterCount() > 0; }

// Клиентът и блокът живеят само в заглавието на картата — Basecamp няма структурно поле
// за тях. Разпознаваме СЪЩИТЕ три префикса като src/services/folder-paths.js, а не само
// КП: клиент с добавена кампания или реклама иначе изчезваше от филтъра (Венци, 25.08.2026
// — „избирам MASTERHAUS и виждам само задачите по КП, а не КМП или РЕК").
const DASH_KINDS = [
  { key: 'kp', re: /^(?:КП|KP)$/i, label: 'КП' },
  { key: 'campaign', re: /^(?:КМП|KMP)$/i, label: 'КМП' },
  { key: 'ads', re: /^(?:РЕК|REK)$/i, label: 'РЕК' },
];

// "Cineland КП-18 - Видео 3 - …" / "Credissimo КМП-3 - …" / "Credissimo РЕК-8 - …"
// Търпи „КП 12", „КП-012", тире/дълго тире, както и опашка след номера.
function dashParseClientBlock(title) {
  const m = String(title || '').trim().match(/^(.+?)\s+([А-Яа-яA-Za-z]{2,3})\s*[-–—]?\s*0*(\d+)\b/);
  if (!m) return null;
  const kind = DASH_KINDS.find((k) => k.re.test(m[2]));
  if (!kind) return null;
  const client = m[1].trim().replace(/\s+/g, ' ');
  const number = parseInt(m[3], 10);
  if (!client || !Number.isFinite(number) || number < 1) return null;
  return { client, kind: kind.key, number, block: kind.key + ':' + number, label: kind.label + '-' + number };
}

// Вратичката „Клиент - Задача" (същата конвенция като folder-paths.js): задача извън
// КП/КМП/РЕК също носи името на клиента. Ползва се САМО за съвпадение по вече избран
// клиент — НЕ и за списъка с клиенти, за да не се напълни падащото меню с измислени
// „клиенти" от вътрешни задачи от вида „Сайт - редизайн".
function dashParseFreeClient(title) {
  const m = String(title || '').trim().match(/^([^-–—]{1,60}?)\s+[-–—]\s+.+$/);
  const client = m ? m[1].trim().replace(/\s+/g, ' ') : '';
  return client || null;
}

function dashDueMatches(card, mode) {
  if (mode === 'nodate') return !card.dueOn;
  if (!card.dueOn) return false;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = _parseDateMidnight(card.dueOn);
  const diff = Math.round((d - now) / 86400000);
  // Просрочена = датата е минала. Чекнатата стъпка вече НЕ извинява просрочието — иначе
  // черна карта нямаше да се показва под филтъра „Просрочени". (Венци, 25.08.2026)
  if (mode === 'overdue') return diff < 0 && !card.completed;
  if (mode === 'today') return diff === 0;
  if (mode === 'soon') return diff >= 0 && diff <= 3;
  if (mode === 'week') return diff >= 0 && diff <= 7;
  return true;
}

function dashCardMatches(card) {
  const f = _dashFilter;
  if (!dashFilterActive()) return true;
  if (f.client || f.block) {
    const p = dashParseClientBlock(card.title);
    // Избран блок (КП-18, КМП-3, РЕК-8) → картата трябва да е точно от него.
    if (f.block && (!p || p.block !== f.block)) return false;
    if (f.client) {
      // Клиентът се търси и по вратичката, за да излязат ВСИЧКИ негови задачи, а не
      // само тези с КП/КМП/РЕК номер.
      const client = p ? p.client : dashParseFreeClient(card.title);
      if (!client || client.toLowerCase() !== f.client.toLowerCase()) return false;
    }
  }
  if (f.assignee && !(card.assignees || []).some((a) => String(a.id) === String(f.assignee))) return false;
  if (f.due && !dashDueMatches(card, f.due)) return false;
  return true;
}

// Картите, от които се градят опциите на филтъра: САМО актуалните и налични задачи —
// тези, които реално стоят по видимите таблици/колони на дашборда.
//
// Не стига да се минат всички заредени карти: скритите колони пак се теглят от
// Basecamp (а по подразбиране „Done" и „Not now" са скрити), а дъска, скрита след
// като веднъж се е заредила, си остава в _dashCards. И двете вкарват в списъка
// клиенти, които са приключени или изобщо не са на дъската — точно това, което
// Венци не иска да вижда. Затова филтрираме изрично по видимост.
//
// Активна карта = отворена задача: не е завършена и не е в Done колона (същата
// дефиниция като `active` в src/services/bc-aggregate.js). On hold картите остават —
// те се показват на дъската и клиентът им още е в игра.
function dashVisibleActiveCards() {
  if (!_dashStruct) return [];
  const hiddenCols = getDashHiddenCols();
  const out = [];
  dashOrderedVisibleBoards().forEach((b) => {   // вече без скритите дъски
    const byCol = _dashCards[b.id];
    if (!byCol) return;                          // дъската още не е заредена
    const hold = _dashOnHold[b.id] || {};
    (b.columns || []).forEach((c) => {
      if (c.isDone || hiddenCols.has(String(c.id))) return;
      [...(byCol[c.id] || []), ...(hold[c.id] || [])].forEach((card) => {
        if (!card.completed) out.push(card);
      });
    });
  });
  return out;
}

// Клиентите в филтъра вървят винаги по едно и също правило: първо българските
// (кирилица), после английските (латиница), всяка група по азбучен ред. Новодобавен
// клиент се подрежда по това правило, а не се лепи където му падне.
//
// Нарочно НЕ разчитаме само на localeCompare(.., 'bg') за разделянето на двете групи:
// то дава кирилица-първо само ако браузърът има българските collation данни. Липсват
// ли, пада към root подредбата — а тя слага латиницата ПЪРВА, тоест точно обратното.
// Затова групата се смята изрично по първата буква, а localeCompare се ползва само
// вътре в групата.
function _dashScriptRank(s) {
  const m = String(s || '').match(/\p{L}/u);   // първата буква, без водещи кавички/цифри
  return m && /[Ѐ-ӿ]/.test(m[0]) ? 0 : 1;
}

function dashClientCompare(a, b) {
  a = String(a); b = String(b);
  const ra = _dashScriptRank(a), rb = _dashScriptRank(b);
  if (ra !== rb) return ra - rb;                                   // кирилица преди латиница
  const cmp = a.localeCompare(b, ra === 0 ? 'bg' : 'en', { sensitivity: 'base', numeric: true });
  if (cmp) return cmp;
  return a < b ? -1 : a > b ? 1 : 0;   // тотална подредба — за да не „трепти" при равни имена
}

// Опциите се градят от видимите активни карти. Списъкът с блокове се стеснява до
// избрания клиент, за да не предлагаме комбинации, които не съществуват.
//
// Клиентите идват САМО от заглавия с КП/КМП/РЕК — там името е гарантирано клиентско.
// Вратичката „Клиент - Задача" нарочно не пълни менюто (виж dashParseFreeClient), но
// щом клиентът веднъж е в списъка, изборът му хваща и свободните му задачи.
function dashFilterOptions() {
  const clients = new Map(), blocks = new Map(), assignees = new Map();
  dashVisibleActiveCards().forEach((c) => {
    const p = dashParseClientBlock(c.title);
    if (p) {
      clients.set(p.client.toLowerCase(), p.client);
      if (!_dashFilter.client || p.client.toLowerCase() === _dashFilter.client.toLowerCase()) blocks.set(p.block, p);
    }
    (c.assignees || []).forEach((a) => assignees.set(String(a.id), a.name));
  });
  const kindOrder = DASH_KINDS.map((k) => k.key);
  return {
    clients: [...clients.values()].sort(dashClientCompare),
    blocks: [...blocks.values()].sort((a, b) =>
      kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || b.number - a.number),
    assignees: [...assignees.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'bg')),
  };
}

// Картите в една колона — точно тези, които стоят под заглавието ѝ (спазва активния
// филтър). On Hold картите не влизат: те си имат собствен брояч в разделителя
// „⏸ On Hold (N)" отдолу.
function dashColCards(boardId, colId) {
  return ((_dashCards[boardId] || {})[colId] || []).filter(dashCardMatches);
}
// Числото до заглавието на колоната. Незаредена дъска пада към структурния брой от
// Basecamp — оправя се щом картите дойдат.
function dashColCount(board, col) {
  return _dashCards[board.id] ? dashColCards(board.id, col.id).length : (col.cardsCount || 0);
}

// Числото до името на дъската = сборът на броячите на ВИДИМИТЕ колони, за да се връзва
// с числата отдолу. Скритите колони („Done" и „Not now" са скрити по подразбиране)
// вече не се броят — преди влизаха и хедърът излизаше по-голям без видима причина.
// Венци, 31.07.2026: „Нека да са само видимите колони".
function dashBoardTotal(b) {
  const hiddenCols = getDashHiddenCols();
  return (b.columns || [])
    .filter((c) => !hiddenCols.has(String(c.id)))
    .reduce((s, c) => s + dashColCount(b, c), 0);
}

// Order `items` by a saved array of ids; unlisted items keep their original order at the end.
function applyOrder(items, order) {
  if (!order || !order.length) return items;
  const idx = {}; order.forEach((id, i) => { idx[String(id)] = i; });
  return items.map((it, i) => ({ it, i })).sort((a, b) => {
    const ia = idx[String(a.it.id)], ib = idx[String(b.it.id)];
    const va = ia === undefined ? 1000 + a.i : ia;
    const vb = ib === undefined ? 1000 + b.i : ib;
    return va - vb;
  }).map((x) => x.it);
}

// Резервна подредба, ако админ не е задал своя: Pre → Production → Post → Project
// Management. Сървърът вече връща дъските в този ред (services/bc-aggregate.js →
// sortBoards), така че тук е само предпазна мрежа — двете места се държат еднакво.
function dashBoardRank(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('pre-produc') || t.includes('pre produc') || t.includes('предпрод')) return 0;
  if (t.includes('post-produc') || t.includes('post produc') || t.includes('пост')) return 2;
  if (t.includes('produc')) return 1; // "Production" (pre/post already matched above)
  if (t.includes('project manage') || t.includes('акаунт') || t.includes('account')) return 3;
  return 999; // everything else keeps its natural order, after the four core boards
}
function applyDefaultBoardOrder(boards) {
  return boards.map((b, i) => ({ b, i }))
    .sort((a, x) => (dashBoardRank(a.b.title) - dashBoardRank(x.b.title)) || (a.i - x.i))
    .map((o) => o.b);
}

async function renderDashboard(el) {
  setBreadcrumb(null);
  el.className = 'full-width dash-page';
  el.innerHTML = '<div class="dash-wrap">' +
    '<div class="dash-board" id="dashBoard"><div style="padding:40px;color:var(--text-dim)">Зареждам от Basecamp…</div></div>' +
  '</div>';
  await dashLoadStructure();
  dashStartAutoRefresh();
}

async function dashLoadStructure() {
  const host = document.getElementById('dashBoard');
  try {
    const res = await fetch('/api/bc-board');
    if (res.status === 401) { if (host) host.innerHTML = '<div style="padding:40px;color:var(--text-dim)">Сесията изтече. <a href="/login.html">Влез отново</a>.</div>'; return; }
    if (!res.ok) { const e = await res.json().catch(() => ({})); if (host) host.innerHTML = '<div style="padding:40px;color:var(--text-dim)">Грешка: ' + esc(e.error || res.status) + '</div>'; return; }
    _dashStruct = await res.json();
    _dashLayout = _dashStruct.layout || {};
    if (_dashPrefs && _dashPrefsDirty) {
      // This tab has changes still on their way to the server — keep them.
    } else if (_dashStruct.prefs) {
      _dashPrefs = _dashPrefsNorm(_dashStruct.prefs);
    } else {
      // First visit since prefs moved server-side: seed from this browser's old
      // localStorage setup + apply the one-time defaults, then persist.
      _dashPrefs = _dashPrefsSeedFromLocal();
      initDashDefaults(_dashStruct.boards || []);
      dashSavePrefs();
    }
    expandedDashCol = _dashPrefs.maximized;
    dashRenderStats();
    dashRenderBoards();
    dashLoadTimers();
    const hidden = getDashHiddenBoards(), minimized = getDashMinimized();
    const visible = (_dashStruct.boards || []).filter((b) => !hidden.has(String(b.id)) && !minimized.has(String(b.id)));
    visible.sort((a, b) => dashBoardTotal(a) - dashBoardTotal(b)); // light boards fill in first
    dashLoadBoardsLimited(visible.map((b) => b.id), 1);
  } catch { if (host) host.innerHTML = '<div style="padding:40px;color:var(--text-dim)">Няма връзка със сървъра.</div>'; }
}

// Load boards' cards with limited concurrency so Basecamp calls stay under the rate limit.
async function dashLoadBoardsLimited(ids, limit) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, ids.length || 1) }, async () => {
    while (i < ids.length) { await dashLoadBoardCards(ids[i++]); }
  });
  await Promise.all(workers);
}

async function dashLoadBoardCards(boardId) {
  _dashLoading[boardId] = true; dashRenderBoardSection(boardId);
  try {
    const res = await fetch('/api/bc-board/cards?board=' + encodeURIComponent(boardId));
    if (!res.ok) throw new Error('cards');
    const data = await res.json();
    const byCol = {}, byHold = {};
    (data.columns || []).forEach((c) => { byCol[c.id] = c.cards || []; byHold[c.id] = c.onHoldCards || []; });
    _dashCards[boardId] = byCol;
    _dashOnHold[boardId] = byHold;
  } catch { /* leave unloaded — user can press ⚙ / reload */ }
  _dashLoading[boardId] = false;
  await dashSyncBoardTimer(boardId);
  dashRenderBoardSection(boardId);
  dashRenderStats();
}

// --- per-board "time since no overdue task" timer ------------------------------
// Backend: board_overdue_timers via /api/timers/boards (GET) + /sync (POST).
// The 1s ticker in sos.js updates any .dash-timer-bar--clean[data-since] live.
async function dashLoadTimers() {
  try {
    const res = await fetch('/api/timers/boards');
    if (!res.ok) return;
    const rows = await res.json();
    (rows || []).forEach((r) => { _dashTimers[String(r.board_id)] = { since: r.started_at, paused: r.is_paused }; });
    dashRenderBoards();
  } catch { /* table may not exist yet — degrade silently (no bars) */ }
}

// After a board's cards load, tell the server whether it currently has an overdue
// card; the server pauses/resumes the timer and returns the fresh state.
async function dashSyncBoardTimer(boardId) {
  if (!_dashCards[boardId]) return;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let hasOverdue = false;
  Object.values(_dashCards[boardId]).forEach((cards) => cards.forEach((c) => {
    const d = c.dueOn ? _parseDateMidnight(c.dueOn) : null;
    // Просрочието се мери само по датата — както и цветът на картата. (Венци, 25.08.2026)
    if (d && d < now && !c.completed) hasOverdue = true;
  }));
  try {
    const res = await fetch('/api/timers/boards/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ board_id: boardId, has_overdue: hasOverdue }]),
    });
    if (!res.ok) return;
    const rows = await res.json();
    (rows || []).forEach((r) => { _dashTimers[String(r.board_id)] = { since: r.started_at, paused: r.is_paused }; });
  } catch { /* degrade silently */ }
}

function _dashFmtElapsed(since) {
  let diff = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
  if (!isFinite(diff) || diff < 0) diff = 0;
  const days = Math.floor(diff / 86400), hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60), secs = diff % 60;
  return days + 'д, ' + hours + 'ч, ' + mins + 'м, ' + secs + 'с';
}

function dashBoardTimerHtml(b) {
  const t = _dashTimers[String(b.id)];
  if (!t) return '';
  if (t.paused) {
    return '<div class="dash-timer-bar dash-timer-bar--overdue"><span class="dash-timer-label">⚠ Има просрочена задача</span></div>';
  }
  return '<div class="dash-timer-bar dash-timer-bar--clean" data-since="' + esc(String(t.since)) + '">' +
    '<span class="dash-timer-label">Без просрочена: </span>' +
    '<span class="dash-timer-value">' + _dashFmtElapsed(t.since) + '</span>' +
  '</div>';
}

function dashRenderStats() {
  // The stats bar (Задачи / Просрочени / Дъски) was removed by request. The dashboard
  // settings gear now lives in the top nav next to the avatar — just reveal it while the
  // dashboard is the active view (router.js hides it again on navigation away).
  const btn = document.getElementById('navDashSettings');
  if (btn) btn.style.display = 'inline-flex';
  const fbtn = document.getElementById('navDashFilter');
  if (fbtn) { fbtn.style.display = 'inline-flex'; dashUpdateFilterBtn(); }
}

var DASH_FILTER_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h18l-7 8.5v6.5l-4 2v-8.5z"/></svg>';

function dashUpdateFilterBtn() {
  const btn = document.getElementById('navDashFilter');
  if (!btn) return;
  const n = dashFilterCount();
  btn.classList.toggle('dash-filter-btn--on', n > 0);
  btn.innerHTML = DASH_FILTER_SVG + '<span>Филтър</span>' + (n ? '<span class="dash-filter-badge">' + n + '</span>' : '');
}

const DASH_DUE_OPTS = [
  ['overdue', 'Просрочени'], ['today', 'Днес'], ['soon', 'До 3 дни'], ['week', 'До 7 дни'], ['nodate', 'Без дата'],
];

function _dashSelect(key, label, placeholder, opts) {
  const cur = _dashFilter[key];
  const o = opts.map(([v, t]) =>
    '<option value="' + esc(String(v)) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(String(t)) + '</option>').join('');
  return '<label class="dash-filter-field"><span class="dash-filter-lbl">' + esc(label) + '</span>' +
    '<select onchange="dashSetFilter(\'' + key + '\', this.value)">' +
      '<option value="">' + esc(placeholder) + '</option>' + o +
    '</select></label>';
}

function showDashFilter() {
  document.querySelectorAll('.dash-filter-panel').forEach((p) => p.remove());
  const btn = document.getElementById('navDashFilter'); if (!btn) return;
  const opts = dashFilterOptions();
  const panel = document.createElement('div'); panel.className = 'dash-filter-panel';
  const n = dashFilterCount();
  let html = '<div class="dash-settings-panel__header"><strong>Филтрирай задачите</strong>' +
    '<button onclick="this.closest(\'.dash-filter-panel\').remove()">✕</button></div>' +
    '<div class="dash-filter-panel__body">';
  html += _dashSelect('client', 'Клиент', 'Всички клиенти', opts.clients.map((c) => [c, c]));
  html += _dashSelect('block', 'КП / КМП / РЕК', 'Всички', opts.blocks.map((b) => [b.block, b.label]));
  html += _dashSelect('due', 'Дата', 'Всички дати', DASH_DUE_OPTS);
  html += _dashSelect('assignee', 'Изпълнител', 'Всички', opts.assignees.map((a) => [a.id, a.name]));
  if (!opts.clients.length) html += '<div class="dash-filter-note">Клиентите се четат от заглавията („Клиент КП-18 — …", КМП, РЕК). Изчакай дъските да се заредят.</div>';
  html += '</div>';
  html += '<div class="dash-settings-panel__footer"><button class="btn btn-sm btn-ghost dash-advanced-btn" onclick="dashClearFilter()"' +
    (n ? '' : ' disabled') + '>Изчисти филтрите' + (n ? ' (' + n + ')' : '') + '</button></div>';
  panel.innerHTML = html;
  const rect = btn.getBoundingClientRect();
  panel.style.cssText = 'position:fixed;top:' + (rect.bottom + 6) + 'px;right:' + Math.max(8, window.innerWidth - rect.right) + 'px;z-index:1000';
  document.body.appendChild(panel);
  setTimeout(() => document.addEventListener('click', function h(ev) {
    if (!document.body.contains(panel)) { document.removeEventListener('click', h); return; }
    if (!panel.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) { panel.remove(); document.removeEventListener('click', h); }
  }), 10);
}

function dashSetFilter(key, val) {
  _dashFilter[key] = val || '';
  if (key === 'client') _dashFilter.block = ''; // блоковете зависят от клиента — старият избор може да не съществува
  dashRenderBoards(); dashUpdateFilterBtn(); showDashFilter();
}

function dashClearFilter() {
  _dashFilter = { client: '', block: '', due: '', assignee: '' };
  dashRenderBoards(); dashUpdateFilterBtn(); showDashFilter();
}

// Below this width the dashboard switches to "focus" mode: one board expanded, the rest
// collapsed to thin strips beside it (same as clicking a board header on desktop).
const DASH_NARROW = 900;
function dashIsNarrow() { return window.innerWidth < DASH_NARROW; }

// Visible boards in their display order (shared by the renderer and the focus logic).
function dashOrderedVisibleBoards() {
  if (!_dashStruct) return [];
  const hidden = getDashHiddenBoards();
  const boards = (_dashStruct.boards || []).filter((b) => !hidden.has(String(b.id)));
  return (_dashLayout.boardOrder && _dashLayout.boardOrder.length)
    ? applyOrder(boards, _dashLayout.boardOrder)
    : applyDefaultBoardOrder(boards);
}

// Which board is "focused" (maximized). On wide screens it's exactly the user's pick (or
// none). On narrow screens we always focus one — the user's pick if still visible, else the
// first visible non-minimized board — so the layout never falls back to equal-width columns.
// A stale pick (board hidden by the user or disabled by an admin) counts as "none".
function dashEffectiveExpanded() {
  const ordered = dashOrderedVisibleBoards();
  const valid = (expandedDashCol && ordered.some((b) => String(b.id) === expandedDashCol)) ? expandedDashCol : null;
  if (!dashIsNarrow() || valid) return valid;
  const min = getDashMinimized();
  const first = ordered.find((b) => !min.has(String(b.id))) || ordered[0];
  return first ? String(first.id) : null;
}

function dashRenderBoards() {
  const container = document.getElementById('dashBoard');
  if (!container || !_dashStruct) return;
  const boards = dashOrderedVisibleBoards();
  if (!boards.length) { container.innerHTML = '<div style="padding:40px;color:var(--text-dim)">Няма видими дъски. Виж ⚙ Настройки.</div>'; return; }
  container.innerHTML = boards.map(dashBoardSectionHtml).join('');
}

function dashRenderBoardSection(boardId) {
  const sec = document.querySelector('.dash-col[data-board-id="' + boardId + '"]');
  if (!sec || !_dashStruct) { dashRenderBoards(); return; }
  const b = (_dashStruct.boards || []).find((x) => String(x.id) === String(boardId));
  if (b) sec.outerHTML = dashBoardSectionHtml(b);
}

// Windows-style window controls (stroke=currentColor, sized for the 20px buttons).
var DASH_MIN_SVG     = '<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 9.5h7"/></svg>';
var DASH_MAX_SVG     = '<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>';
var DASH_RESTORE_SVG = '<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2" y="4" width="6" height="6" rx="1"/><path d="M4.5 2h5a.5.5 0 0 1 .5.5v5"/></svg>';

function dashBoardSectionHtml(b) {
  const hiddenCols = getDashHiddenCols();
  let cols = (b.columns || []).filter((c) => !hiddenCols.has(String(c.id)));
  cols = applyOrder(cols, (_dashLayout.colOrder || {})[String(b.id)]);
  const loaded = !!_dashCards[b.id];
  const tag = loaded ? '' : (_dashLoading[b.id] ? ' <span class="bc-mini">зареждам…</span>' : '');
  const eff = dashEffectiveExpanded();
  const isExpanded = eff === String(b.id);
  const isMinimized = !isExpanded && getDashMinimized().has(String(b.id));
  const isCollapsed = !isExpanded && (isMinimized || !!eff);
  const colClass = 'dash-col' + (isExpanded ? ' expanded' : '') + (isCollapsed ? ' collapsed' : '') + (isMinimized ? ' minimized' : '');
  const body = isCollapsed ? '' : ('<div class="dash-col-body">' + cols.map((c) => dashSubColHtml(b, c, loaded)).join('') + '</div>');
  const hdrTitle = isCollapsed ? 'Цъкни за връщане' : 'Цъкни за цял екран';
  const tools = '<span class="dash-col-tools">' +
    '<button class="dash-col-btn" onclick="dashMinimizeBoard(event, \'' + b.id + '\')" title="Минимизирай — прибира колоната в тясна лента">' + DASH_MIN_SVG + '</button>' +
    '<button class="dash-col-btn" onclick="dashMaximizeBoard(event, \'' + b.id + '\')" title="' + (isExpanded ? 'Върни нормалния изглед' : 'Само тази колона (цял екран)') + '">' + (isExpanded ? DASH_RESTORE_SVG : DASH_MAX_SVG) + '</button>' +
  '</span>';
  return '<div class="' + colClass + '" data-board-id="' + b.id + '">' +
    '<div class="dash-col-header" onclick="toggleDashCol(\'' + b.id + '\')" title="' + hdrTitle + '"><span class="dash-col-title">' + esc(b.title) + tag + '</span><span class="dash-col-count">' + dashBoardTotal(b) + '</span>' + tools + '</div>' +
    dashBoardTimerHtml(b) +
    body +
  '</div>';
}

// Ред в колоната: ⚡ Приоритет (чекната стъпка „Приоритет") → без дата → по дата
// възходящо (просрочените най-отгоре) → завършените най-долу. При равенство — по
// ръчния Basecamp ред (position).
// Чекнатата стъпка на отдела НЕ мести картата: тя си стои на мястото по дата, само
// цветът ѝ става пулсиращо зелено (виж renderDashCard). (Венци, 25.08.2026)
function dashCardGroup(c) {
  if (c.completed) return 4;
  if (c.priority) return 0;
  if (!c.dueOn) return 1;
  return 2;
}
function dashCardCompare(a, b) {
  const ga = dashCardGroup(a), gb = dashCardGroup(b);
  if (ga !== gb) return ga - gb;
  const da = a.dueOn || '', db = b.dueOn || ''; // '' сортира преди всяка дата
  if (da !== db) return da < db ? -1 : 1;
  return (a.position || 0) - (b.position || 0);
}

function dashSubColHtml(board, col, loaded) {
  const cards = dashColCards(board.id, col.id).sort(dashCardCompare);
  // On Hold картите се подреждат по същото правило като горните — по датата, която
  // следим за тази колона (dueOn идва от стъпката на колоната, виж services/steps.js).
  // Преди тук стоеше само ръчният ред от Basecamp и датите не се гледаха. (17.08.2026)
  const onHold = ((_dashOnHold[board.id] || {})[col.id] || []).filter(dashCardMatches).sort(dashCardCompare);
  const count = dashColCount(board, col);
  const body = loaded
    ? ((cards.map(renderDashCard).join('') || '<div class="dash-subcol-empty"></div>') +
       (onHold.length ? '<div class="dash-onhold-sep">⏸ On Hold (' + onHold.length + ')</div>' + onHold.map(renderDashCard).join('') : ''))
    : '<div class="bc-col-skel">' + Array(Math.min(col.cardsCount || 0, 4)).fill('<div class="bc-skel"></div>').join('') + '</div>';
  return '<div class="dash-subcol">' +
    '<div class="dash-subcol-header"><span class="dash-subcol-title">' + esc(col.title) + '</span><span class="dash-subcol-count">' + count + '</span></div>' +
    '<div class="dash-subcol-cards" data-column-id="' + col.id + '" data-board-id="' + board.id + '" ondragover="dashBcDragOver(event)" ondragleave="dashBcDragLeave(event)" ondrop="dashBcDrop(event)">' + body + '</div>' +
  '</div>';
}

// Inline icons (stroke=currentColor → inherit the date's deadline color / button color).
var DASH_CAL_SVG   = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>';
var DASH_CLOCK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3 2"/></svg>';
var DASH_CHECK_SVG = '<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6.5 9.5 17.5 4 12"/></svg>';

function renderDashCard(card) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = card.dueOn ? _parseDateMidnight(card.dueOn) : null;
  const isPrio = !!card.priority && !card.completed;
  let colorClass = 'dash-card--none'; // no due date (or completed) → neutral grey
  if (isPrio) {
    colorClass = 'dash-card--priority'; // чекната стъпка „Приоритет" → бяла, преди всички
  } else if (d && !card.completed) {
    // Цветът е ИЗЦЯЛО по датата — чекнатата стъпка не го променя. Просрочена карта си е
    // черна, дори отделът да е приключил: датата е датата. Че стъпката е чекната, се вижда
    // от зеленото чекче до таймера, не от фона. (Венци, 25.08.2026)
    const diff = Math.ceil((d - now) / 86400000);
    colorClass = diff < 0 ? 'dash-card--overdue' : diff === 0 ? 'dash-card--today' : diff <= 3 ? 'dash-card--soon' : 'dash-card--ok';
  }
  const noDate = !card.dueOn && !card.completed && !isPrio; // needs a date — flag until one is set
  const assignee = card.assignees && card.assignees[0] ? esc(card.assignees[0].name.split(' ')[0]) : '';
  // Зелено чекче до таймера, щом стъпката на дъската, в която стои картата, е чекната.
  // `dueStepDone` идва от сървъра и е сметнат САМО по стъпката на тази дъска, така че
  // Pre-Production не светва от чекнат монтаж и обратно. Показва се и когато стъпката е
  // без дата (тогава картата е „Няма дата") — отметката си е отметка. (Венци, 25.08.2026)
  const stepDoneMark = card.dueStepDone && !card.completed
    ? '<span class="dash-card__stepdone" title="' + esc(card.dueStep || 'Стъпката на тази колона') + ' — чекната">' + DASH_CHECK_SVG + '</span>'
    : '';
  const dueTip = card.dueFromStep && card.dueStep
    ? ' title="Дата от стъпка: ' + esc(card.dueStep) + (card.dueStepDone ? ' (приключена)' : '') + '"'
    : '';
  const due = card.dueOn
    ? '<div class="dash-card__date"' + dueTip + '>' + DASH_CAL_SVG + '<span>' + formatDate(card.dueOn) + '</span></div>'
    : (noDate ? '<div class="dash-card__nodate"' + (card.dueFromStep && card.dueStep ? ' title="Стъпката „' + esc(card.dueStep) + '" е без дата"' : '') + '>' + DASH_CAL_SVG + '<span>Няма дата</span></div>' : '');
  // Картата е ИСТИНСКИ <a> към Basecamp, а не <div> — само така средният бутон (скролът)
  // отваря задачата в нов раздел НА ЗАДЕН ПЛАН и таблицата остава отпред. С JS не става:
  // `window.open` винаги изважда новия раздел отпред, а средният бутон върху <div> не прави
  // нищо. Левият бутон минава през dashOpenCard и си остава както беше. (Венци, 31.07.2026)
  const url = card.url || '';
  const href = url ? ' href="' + esc(url) + '" target="_blank" rel="noopener"' : '';
  const tag = url ? 'a' : 'div';
  return '<' + tag + ' class="dash-card ' + colorClass + (card.completed ? ' dash-card--done' : '') + (card.onHold ? ' dash-card--onhold' : '') + (noDate ? ' dash-card--nodate' : '') + '" draggable="true" data-card-id="' + card.id + '" data-url="' + esc(url) + '"' + href +
      ' ondragstart="dashBcDragStart(event)" ondragend="dashBcDragEnd(event)" onclick="dashOpenCard(event, this)" title="' + esc(card.title) + ' — отвори в Basecamp' + (url ? ' (среден бутон: нов раздел отзад)' : '') + '">' +
    '<div class="dash-card__title">' + esc(card.title) + '</div>' +
    due +
    '<div class="dash-card__actions">' +
      '<span class="dash-card__actions-left">' +
        '<button class="dash-card__timer" onclick="dashCardTimer(event, \'' + card.id + '\')" title="Следене на времето">' + DASH_CLOCK_SVG + '</button>' +
        stepDoneMark +
      '</span>' +
      (assignee ? '<span class="dash-card__assignee">' + assignee + '</span>' : '') +
    '</div>' +
  '</' + tag + '>';
}

// Time-tracking button: свети червено, докато колега работи по картата (виж
// time-working.js). Клик: показва кой работи; иначе отваря картата в Basecamp,
// където живее таймерът (The Pact Tools разширението).
function dashCardTimer(e, cardId) {
  e.stopPropagation(); // don't open the card in Basecamp
  e.preventDefault();
  const w = typeof _twWorking !== 'undefined' ? _twWorking.get(String(cardId)) : null;
  if (w) {
    if (typeof showToast === 'function') showToast('⏱ ' + w.userName + ' работи по това от ' + twMinutes(w) + ' мин', 'info');
    return;
  }
  const cardEl = e.target.closest('.dash-card');
  const url = cardEl && cardEl.dataset.url;
  if (url) {
    window.open(url, '_blank');
    if (typeof showToast === 'function') showToast('Пусни таймера от прозорчето на The Pact Tools в Basecamp ⏱', 'info');
  }
}

// --- drag & drop: move a card to another column, in Basecamp ---
// Between columns of one board it is a plain move. Between two boards Basecamp teleports
// the card through a portal (виж routes/bc-board.js) — това е асинхронно и картата излиза
// от другата страна с НОВО id, затова презареждаме и двете дъски след малко.
function dashBcDragStart(e) {
  const card = e.target.closest('.dash-card');
  _dashDragCardId = card.dataset.cardId;
  const zone = card.closest('.dash-subcol-cards');
  _dashDragBoardId = zone && zone.dataset.boardId;
  _dashDragFromCol = zone && zone.dataset.columnId;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function dashBcDragEnd(e) {
  const c = e.target.closest('.dash-card'); if (c) c.classList.remove('dragging');
  document.querySelectorAll('.dash-subcol-cards.drag-over').forEach((n) => n.classList.remove('drag-over'));
  _dashDragCardId = null;
}
function dashBcDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function dashBcDragLeave(e) { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over'); }
async function dashBcDrop(e) {
  e.preventDefault();
  const zone = e.currentTarget; zone.classList.remove('drag-over');
  if (!_dashDragCardId) return;
  const targetCol = zone.dataset.columnId, targetBoard = zone.dataset.boardId;
  const cardId = _dashDragCardId, fromCol = _dashDragFromCol, fromBoard = _dashDragBoardId;
  _dashDragCardId = null;
  const crossBoard = targetBoard !== fromBoard;
  if (!crossBoard && targetCol === fromCol) return;
  const cardEl = document.querySelector('.dash-card[data-card-id="' + cardId + '"]');
  if (cardEl) zone.appendChild(cardEl); // optimistic
  try {
    const res = await fetch('/api/bc-board/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardTableId: Number(targetBoard), fromCardTableId: Number(fromBoard),
        cardId: Number(cardId), targetColumnId: Number(targetCol), position: 0,
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || 'move');
    }
    if (!crossBoard) {
      if (window.showToast) showToast('Преместено в Basecamp ✓', 'success');
      setTimeout(() => dashLoadBoardCards(targetBoard), 900); // reconcile just this board
      return;
    }
    // Teleport: Basecamp го обработва на опашка, затова изчакваме и опресняваме двете дъски.
    if (window.showToast) showToast('Местя в другата дъска… (Basecamp го обработва)', 'info');
    const both = () => { dashLoadBoardCards(fromBoard); dashLoadBoardCards(targetBoard); };
    setTimeout(both, 3000);
    setTimeout(() => { both(); if (window.showToast) showToast('Преместено в Basecamp ✓', 'success'); }, 9000);
  } catch (err) {
    if (window.showToast) showToast('Грешка при местене: ' + (err.message || 'връщам'), 'error');
    dashLoadBoardCards(fromBoard);
    if (crossBoard) dashLoadBoardCards(targetBoard);
  }
}

// --- settings panel: choose which boards/columns are visible ---
function showDashSettings() {
  document.querySelectorAll('.dash-settings-panel').forEach((p) => p.remove());
  if (!_dashStruct) return;
  const hiddenBoards = getDashHiddenBoards(), hiddenCols = getDashHiddenCols();
  const btn = document.querySelector('.dash-settings-btn'); if (!btn) return;
  const panel = document.createElement('div'); panel.className = 'dash-settings-panel';
  const isAdmin = !!(window.currentUser && currentUser.role === 'admin');
  let html = '<div class="dash-settings-panel__header"><strong>Какво да се вижда</strong><button onclick="this.closest(\'.dash-settings-panel\').remove()">✕</button></div>';
  if (isAdmin) html += '<div class="dash-set-note">Стрелките ↑↓ подреждат за <b>всички</b> (ти си админ).</div>';
  html += '<div class="dash-settings-panel__body">';
  const sBoards = applyOrder((_dashStruct.boards || []).slice(), _dashLayout.boardOrder);
  sBoards.forEach((board) => {
    const boardHidden = hiddenBoards.has(String(board.id));
    const bArrows = isAdmin ? '<span class="dash-arrows"><button title="Нагоре" onclick="dashMoveBoard(\'' + board.id + '\',-1)">↑</button><button title="Надолу" onclick="dashMoveBoard(\'' + board.id + '\',1)">↓</button></span>' : '';
    html += '<div class="dash-set-row"><label class="dash-settings-board-row"><input type="checkbox" ' + (!boardHidden ? 'checked' : '') + ' onchange="toggleDashBoard(\'' + board.id + '\', this.checked)"><span><b>' + esc(board.title) + '</b></span></label>' + bArrows + '</div>';
    if (!boardHidden) {
      const sCols = applyOrder((board.columns || []).slice(), (_dashLayout.colOrder || {})[String(board.id)]);
      sCols.forEach((col) => {
        const cArrows = isAdmin ? '<span class="dash-arrows"><button title="Нагоре" onclick="dashMoveCol(\'' + board.id + '\',\'' + col.id + '\',-1)">↑</button><button title="Надолу" onclick="dashMoveCol(\'' + board.id + '\',\'' + col.id + '\',1)">↓</button></span>' : '';
        html += '<div class="dash-set-row dash-set-row--col"><label class="dash-settings-col"><input type="checkbox" ' + (!hiddenCols.has(String(col.id)) ? 'checked' : '') + ' onchange="toggleDashColVisibility(\'' + col.id + '\', this.checked)"><span>' + esc(col.title) + ' <span class="bc-mini">(' + (col.cardsCount || 0) + ')</span></span></label>' + cArrows + '</div>';
      });
    }
  });
  html += '</div>'; // close body
  html += '<div class="dash-settings-panel__footer"><button class="btn btn-sm btn-ghost dash-advanced-btn" onclick="showDashAdvanced()">⚙ Разширени настройки</button></div>';
  panel.innerHTML = html;
  const rect = btn.getBoundingClientRect();
  panel.style.cssText = 'position:fixed;top:' + (rect.bottom + 6) + 'px;right:' + (window.innerWidth - rect.right) + 'px;z-index:1000';
  document.body.appendChild(panel);
  setTimeout(() => document.addEventListener('click', function h(ev) {
    if (!panel.contains(ev.target) && ev.target !== btn) { panel.remove(); document.removeEventListener('click', h); }
  }), 10);
}
// Larger "Advanced settings" modal — placeholder for now; we'll fill it in later.
function showDashAdvanced() {
  document.querySelectorAll('.dash-settings-panel').forEach((p) => p.remove());
  document.querySelectorAll('.dash-advanced-overlay').forEach((o) => o.remove());
  const ov = document.createElement('div');
  ov.className = 'modal-overlay dash-advanced-overlay';
  ov.innerHTML =
    '<div class="dash-advanced-modal">' +
      '<div class="dash-advanced-modal__hdr"><strong>Разширени настройки</strong>' +
        '<button class="dash-advanced-modal__close" aria-label="Затвори">✕</button></div>' +
      '<div class="dash-advanced-modal__body">' +
        '<p class="dash-advanced-empty">Тук ще добавим още настройки на Dashboard-а.<br>Кажи какво да сложим и го изграждаме.</p>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  function onKey(e) { if (e.key === 'Escape') close(); }
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('.dash-advanced-modal__close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
}

function toggleDashBoard(boardId, visible) {
  const hidden = getDashHiddenBoards(); if (visible) hidden.delete(String(boardId)); else hidden.add(String(boardId)); saveDashHiddenBoards(hidden);
  if (!visible && expandedDashCol === String(boardId)) { expandedDashCol = null; dashSavePrefs(); }
  dashRenderStats(); dashRenderBoards();
  if (visible && !_dashCards[boardId]) dashLoadBoardCards(boardId);
  showDashSettings();
}
function toggleDashColVisibility(colId, visible) {
  const hidden = getDashHiddenCols(); if (visible) hidden.delete(String(colId)); else hidden.add(String(colId)); saveDashHiddenCols(hidden);
  dashRenderBoards();
}

// --- Windows-style column controls ---------------------------------------------
//   ─  minimize → the board shrinks to a thin side strip (click the strip to restore)
//   ▢  maximize → the board takes the full width, everything else becomes a strip
//   ❐  restore  → back to the normal equal-width view
function dashMinimizeBoard(e, boardId) {
  e.stopPropagation(); e.preventDefault();
  const id = String(boardId);
  const min = getDashMinimized(); min.add(id); saveDashMinimized(min);
  if (expandedDashCol === id) expandedDashCol = null;
  dashSavePrefs(); dashRenderBoards();
}
function dashMaximizeBoard(e, boardId) {
  e.stopPropagation(); e.preventDefault();
  const id = String(boardId);
  const min = getDashMinimized();
  if (min.has(id)) { min.delete(id); saveDashMinimized(min); }
  expandedDashCol = (expandedDashCol === id && !dashIsNarrow()) ? null : id;
  dashSavePrefs(); dashRenderBoards();
  if (!_dashCards[boardId]) dashLoadBoardCards(boardId);
}

// Click on a header/strip. A minimized strip restores itself (and takes the focus if
// another board was fullscreen — like clicking a window in the taskbar). A normal header
// toggles fullscreen; a strip collapsed by someone else's fullscreen switches it here.
function toggleDashCol(boardId) {
  const id = String(boardId);
  const min = getDashMinimized();
  if (min.has(id)) {
    min.delete(id); saveDashMinimized(min);
    if (expandedDashCol || dashIsNarrow()) expandedDashCol = id;
  } else if (dashIsNarrow()) {
    expandedDashCol = id;
  } else {
    expandedDashCol = (expandedDashCol === id) ? null : id;
  }
  dashSavePrefs(); dashRenderBoards();
  if (!_dashCards[boardId]) dashLoadBoardCards(boardId);
}

// Re-render when the viewport crosses the narrow/wide threshold so the focus layout
// engages (or releases) automatically — but only while the dashboard is the active view.
let _dashWasNarrow = null;
window.addEventListener('resize', () => {
  if (!document.getElementById('dashBoard')) return;
  const narrow = dashIsNarrow();
  if (narrow === _dashWasNarrow) return;
  _dashWasNarrow = narrow;
  dashRenderBoards();
});

// Open a card on its own page in Basecamp, in a new tab.
// Ляв бутон: както досега — нов раздел отпред, направо в задачата.
// Ctrl/⌘/Shift + клик: не пипаме — браузърът сам отваря раздел/прозорец на заден план.
// Средният бутон изобщо не стига дотук (той вдига `auxclick`), картата е <a> и браузърът
// го поема — точно затова се отварят много задачи наведнъж, без връщане назад.
function dashOpenCard(e, el) {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
  const url = el.getAttribute('data-url');
  if (!url) return;
  e.preventDefault(); // картата е <a> — иначе разделът ще се отвори два пъти
  window.open(url, '_blank', 'noopener');
}

// --- admin-only GLOBAL ordering (saved on the server, applies to everyone) ---
function dashMoveBoard(boardId, dir) {
  const all = (_dashStruct.boards || []).map((b) => String(b.id));
  let order = (_dashLayout.boardOrder && _dashLayout.boardOrder.length) ? _dashLayout.boardOrder.map(String) : all.slice();
  all.forEach((id) => { if (!order.includes(id)) order.push(id); });
  order = order.filter((id) => all.includes(id));
  const i = order.indexOf(String(boardId)), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  const t = order[i]; order[i] = order[j]; order[j] = t;
  _dashLayout.boardOrder = order;
  dashSaveLayout(); dashRenderBoards(); showDashSettings();
}
function dashMoveCol(boardId, colId, dir) {
  const board = (_dashStruct.boards || []).find((b) => String(b.id) === String(boardId));
  if (!board) return;
  const all = (board.columns || []).map((c) => String(c.id));
  _dashLayout.colOrder = _dashLayout.colOrder || {};
  let order = (_dashLayout.colOrder[String(boardId)] && _dashLayout.colOrder[String(boardId)].length) ? _dashLayout.colOrder[String(boardId)].map(String) : all.slice();
  all.forEach((id) => { if (!order.includes(id)) order.push(id); });
  order = order.filter((id) => all.includes(id));
  const i = order.indexOf(String(colId)), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  const t = order[i]; order[i] = order[j]; order[j] = t;
  _dashLayout.colOrder[String(boardId)] = order;
  dashSaveLayout(); dashRenderBoardSection(boardId); showDashSettings();
}
async function dashSaveLayout() {
  try {
    await fetch('/api/bc-board/layout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layout: _dashLayout }) });
  } catch { /* non-admins get 403 — ignore */ }
}

function dashStartAutoRefresh() {
  if (_dashAutoRefreshId) clearInterval(_dashAutoRefreshId);
  _dashAutoRefreshId = setInterval(function () {
    const page = (location.hash.split('/')[1] || '').split('?')[0];
    if (page !== 'dashboard') { clearInterval(_dashAutoRefreshId); _dashAutoRefreshId = null; return; }
    if (_dashDragCardId) return; // never refresh mid-drag
    const hidden = getDashHiddenBoards(), minimized = getDashMinimized();
    const visible = (_dashStruct ? _dashStruct.boards : []).filter((b) => !hidden.has(String(b.id)) && !minimized.has(String(b.id)));
    dashLoadBoardsLimited(visible.map((b) => b.id), 1);
  }, 60000);
}

// Kept for compatibility — kanban.js calls this after a local-board move.
async function _dashRefresh() {
  if (location.hash.indexOf('#/dashboard') !== 0) return;
  await dashLoadStructure();
}
