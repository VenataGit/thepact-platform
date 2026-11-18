// ==================== МОИТЕ ЗАДАЧИ (Венци, 19.11.2026) ====================
// Всеки човек си избира ЕДНА колона от Video Production (отдел/дъска → колона) в
// „Моите настройки" (#/my-settings) и после през аватара → „Моите задачи" (#/my-tasks)
// вижда само картите в нея — основно от телефон. Началната страница си остава с всичко.
// Изборът се пази на сървъра (GET/PUT /api/bc-board/my-tasks), значи важи на всяко
// устройство. Картите се рисуват със същия renderDashCard като таблото.

// Отделите, които се предлагат (на този етап) — в този ред. Други дъски не се показват.
var MT_DEPTS = ['Pre-Production', 'Production', 'Post-Production', 'Project Management'];

function mtGoFromProfile(hash) {
  if (typeof closeProfile === 'function') closeProfile();
  location.hash = hash;
}

async function mtLoad() {
  const [pRes, sRes] = await Promise.all([fetch('/api/bc-board/my-tasks'), fetch('/api/bc-board')]);
  if (sRes.status === 401) throw new Error('Сесията изтече — влез отново.');
  if (!pRes.ok || !sRes.ok) throw new Error('Не успях да заредя данните от Basecamp.');
  const pref = await pRes.json();
  const struct = await sRes.json();
  const norm = (s) => String(s || '').trim().toLowerCase();
  const boards = [];
  MT_DEPTS.forEach((d) => {
    const b = (struct.boards || []).find((x) => norm(x.title) === norm(d));
    if (b) boards.push(b);
  });
  return { pref, boards, allBoards: struct.boards || [] };
}

// ---------- #/my-tasks ----------
async function renderMyTasks(el) {
  setBreadcrumb(null);
  el.className = 'full-width';
  el.innerHTML = '<div class="mt-wrap"><div class="mt-dim">Зареждам…</div></div>';
  let d;
  try { d = await mtLoad(); } catch (e) {
    el.innerHTML = '<div class="mt-wrap"><div class="mt-dim">' + esc(e.message) + '</div></div>';
    return;
  }
  const board = d.pref.board && d.allBoards.find((b) => String(b.id) === d.pref.board);
  const col = board && (board.columns || []).find((c) => String(c.id) === d.pref.column);
  if (!board || !col) {
    el.innerHTML = '<div class="mt-wrap">' +
      '<h1 class="mt-h1">Моите задачи</h1>' +
      '<div class="mt-panel">' + (d.pref.board ? 'Колоната, която беше избрал, вече я няма в Basecamp. ' : 'Още не си избрал коя колона да виждаш. ') +
      'Избери отдел и колона с твоето име — после тук ще излизат само твоите задачи.' +
      '<div style="margin-top:14px"><a class="btn btn-primary btn-sm" href="#/my-settings">Избери колона</a></div></div>' +
    '</div>';
    return;
  }
  el.innerHTML = '<div class="mt-wrap">' +
    '<div class="mt-head"><div><h1 class="mt-h1">Моите задачи</h1>' +
      '<div class="mt-dim">' + esc(board.title) + ' → <strong>' + esc(col.title) + '</strong></div></div>' +
      '<div class="mt-actions"><button class="btn btn-sm" onclick="router()">↻ Обнови</button>' +
      '<a class="btn btn-sm" href="#/my-settings">⚙ Смени колоната</a></div></div>' +
    '<div class="mt-cards" id="mtCards"><div class="mt-dim">Зареждам картите от Basecamp…</div></div>' +
  '</div>';
  try {
    const res = await fetch('/api/bc-board/cards?board=' + encodeURIComponent(board.id));
    if (!res.ok) throw new Error();
    const data = await res.json();
    const c = (data.columns || []).find((x) => String(x.id) === String(col.id)) || {};
    const cards = (c.cards || []).slice().sort(dashCardCompare);
    const onHold = (c.onHoldCards || []).slice().sort(dashCardCompare);
    const host = document.getElementById('mtCards');
    if (!host) return;
    host.innerHTML = (cards.length || onHold.length)
      ? '<div class="mt-count">' + cards.length + (cards.length === 1 ? ' задача' : ' задачи') + '</div>' +
        cards.map(renderDashCard).join('') +
        (onHold.length ? '<div class="dash-onhold-sep">⏸ On Hold (' + onHold.length + ')</div>' + onHold.map(renderDashCard).join('') : '')
      : '<div class="mt-panel">Няма задачи в тази колона. 🎉</div>';
  } catch {
    const host = document.getElementById('mtCards');
    if (host) host.innerHTML = '<div class="mt-dim">Не успях да заредя картите. Опитай „Обнови".</div>';
  }
}

// ---------- #/my-settings ----------
var _mt = { boards: [], board: null, column: null };

async function renderMySettings(el) {
  setBreadcrumb(null);
  el.className = 'full-width';
  el.innerHTML = '<div class="mt-wrap"><div class="mt-dim">Зареждам…</div></div>';
  let d;
  try { d = await mtLoad(); } catch (e) {
    el.innerHTML = '<div class="mt-wrap"><div class="mt-dim">' + esc(e.message) + '</div></div>';
    return;
  }
  _mt.boards = d.boards;
  _mt.board = d.pref.board;
  _mt.column = d.pref.column;
  if (_mt.board && !_mt.boards.some((b) => String(b.id) === _mt.board)) { _mt.board = null; _mt.column = null; }
  mtRenderSettings(el);
}

function mtRenderSettings(el) {
  el = el || document.getElementById('pageContent');
  const deptBtns = _mt.boards.map((b) =>
    '<button class="mt-chip' + (String(b.id) === _mt.board ? ' mt-chip--on' : '') + '" onclick="mtPickBoard(\'' + b.id + '\')">' + esc(b.title) + '</button>'
  ).join('') || '<div class="mt-dim">Не намирам отделите в Basecamp.</div>';
  const board = _mt.boards.find((b) => String(b.id) === _mt.board);
  const cols = board ? (board.columns || []).map((c) =>
    '<label class="mt-col"><input type="radio" name="mtCol" value="' + c.id + '"' + (String(c.id) === _mt.column ? ' checked' : '') +
    ' onchange="_mt.column=this.value"> <span>' + esc(c.title) + '</span></label>'
  ).join('') : '';
  el.innerHTML = '<div class="mt-wrap">' +
    '<h1 class="mt-h1">Моите настройки</h1>' +
    '<div class="mt-panel">' +
      '<div class="mt-label">Моите задачи — коя колона да виждам</div>' +
      '<div class="mt-step">1. Отдел</div><div class="mt-chips">' + deptBtns + '</div>' +
      (board ? '<div class="mt-step">2. Колона (обикновено тази с твоето име)</div><div class="mt-cols">' + cols + '</div>' : '') +
      '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn btn-primary btn-sm" onclick="mtSave()">Запази</button>' +
        '<a class="btn btn-sm" href="#/my-tasks">Към Моите задачи</a>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function mtPickBoard(id) {
  if (_mt.board !== String(id)) _mt.column = null;
  _mt.board = String(id);
  mtRenderSettings();
}

async function mtSave() {
  if (!_mt.board || !_mt.column) { showToast('Избери отдел и колона', 'error'); return; }
  try {
    const r = await fetch('/api/bc-board/my-tasks', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: _mt.board, column: _mt.column }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Грешка');
    showToast('Запазено', 'success');
    location.hash = '#/my-tasks';
  } catch (e) { showToast(e.message || 'Грешка при запазване', 'error'); }
}
