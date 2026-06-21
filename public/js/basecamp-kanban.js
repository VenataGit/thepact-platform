// Basecamp-backed kanban board. Two-stage load (structure first, then cards per board)
// so a 300+ card board stays responsive. Moves cards in Basecamp as the logged-in user.
(function () {
  const HIDDEN_BOARDS_KEY = 'thepact-bc-hidden-boards';
  const HIDDEN_COLS_KEY = 'thepact-bc-hidden-cols';
  let _struct = null;        // { boards: [{ id, title, columns: [{ id, title, cardsCount }] }] }
  const _cards = {};         // boardId -> { colId -> [cards] }
  const _loading = {};       // boardId -> bool
  let _dragCardId = null, _dragBoardId = null, _dragFromCol = null;
  let _timer = null;

  function getSet(key) { try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); } }
  function saveSet(key, set) { localStorage.setItem(key, JSON.stringify([...set])); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
  function initials(name) { return String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase(); }
  function toast(msg, type) { if (window.showToast) window.showToast(msg, type); }

  function dueBadge(dueOn) {
    if (!dueOn) return '';
    const d = new Date(dueOn + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / 86400000);
    let cls = 'bc-due--ok';
    if (diff < 0) cls = 'bc-due--over';
    else if (diff === 0) cls = 'bc-due--today';
    else if (diff <= 3) cls = 'bc-due--soon';
    return `<span class="bc-due ${cls}">${d.toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit' })}</span>`;
  }

  window.renderBasecampBoard = async function (el) {
    el.innerHTML = `<div class="bc-wrap">
      <div class="bc-head">
        <h1 class="bc-title">Basecamp — Video Production</h1>
        <div class="bc-head-right">
          <button class="bc-btn" onclick="bcReload()">↻ Презареди</button>
          <button class="bc-btn" onclick="bcToggleSettings()">⚙ Настройки</button>
        </div>
      </div>
      <div id="bcSettings" class="bc-settings" style="display:none"></div>
      <div id="bcBoards" class="bc-boards"><div class="bc-loading">Зареждам структурата…</div></div>
    </div>`;
    await loadStructure(true);
    if (_timer) clearInterval(_timer);
    _timer = setInterval(() => {
      if (location.hash.indexOf('#/basecamp') !== 0) { clearInterval(_timer); _timer = null; return; }
      loadStructure(false);
    }, 60000);
  };

  window.bcReload = function () { loadStructure(true); };

  async function loadStructure(spinner) {
    const host = document.getElementById('bcBoards');
    if (!host) return;
    if (spinner) host.innerHTML = '<div class="bc-loading">Зареждам структурата…</div>';
    try {
      const res = await fetch('/api/bc-board');
      if (res.status === 401) { host.innerHTML = '<div class="bc-empty">Сесията изтече. <a href="/login.html">Влез отново</a>.</div>'; return; }
      if (!res.ok) { const e = await res.json().catch(() => ({})); host.innerHTML = `<div class="bc-empty">Грешка: ${esc(e.error || res.status)}</div>`; return; }
      _struct = await res.json();
      renderAll();
      const hiddenBoards = getSet(HIDDEN_BOARDS_KEY);
      const visible = (_struct.boards || []).filter((b) => !hiddenBoards.has(String(b.id)));
      visible.sort((a, b) => boardCardTotal(a) - boardCardTotal(b)); // light boards fill in first
      loadBoardsLimited(visible.map((b) => b.id), 1);
    } catch { host.innerHTML = '<div class="bc-empty">Няма връзка със сървъра.</div>'; }
  }

  async function loadBoardCards(boardId) {
    _loading[boardId] = true;
    renderBoardSection(boardId);
    try {
      const res = await fetch('/api/bc-board/cards?board=' + encodeURIComponent(boardId));
      if (!res.ok) throw new Error('cards');
      const data = await res.json();
      const byCol = {};
      (data.columns || []).forEach((c) => { byCol[c.id] = c.cards || []; });
      _cards[boardId] = byCol;
    } catch { /* leave unloaded; user can press Презареди */ }
    _loading[boardId] = false;
    renderBoardSection(boardId);
  }

  function boardCardTotal(b) { return (b.columns || []).reduce((s, c) => s + (c.cardsCount || 0), 0); }

  // Load boards' cards with limited concurrency so total Basecamp calls stay under the rate limit.
  async function loadBoardsLimited(ids, limit) {
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, ids.length || 1) }, async () => {
      while (i < ids.length) { await loadBoardCards(ids[i++]); }
    });
    await Promise.all(workers);
  }

  function renderAll() {
    const host = document.getElementById('bcBoards');
    if (!host || !_struct) return;
    const hiddenBoards = getSet(HIDDEN_BOARDS_KEY);
    const boards = (_struct.boards || []).filter((b) => !hiddenBoards.has(String(b.id)));
    if (!boards.length) { host.innerHTML = '<div class="bc-empty">Няма видими дъски. Виж ⚙ Настройки.</div>'; return; }
    host.innerHTML = boards.map(boardSectionHtml).join('');
  }

  function renderBoardSection(boardId) {
    const sec = document.querySelector(`.bc-board[data-board-id="${boardId}"]`);
    if (!sec || !_struct) { renderAll(); return; }
    const b = (_struct.boards || []).find((x) => String(x.id) === String(boardId));
    if (b) sec.outerHTML = boardSectionHtml(b);
  }

  function boardSectionHtml(b) {
    const hiddenCols = getSet(HIDDEN_COLS_KEY);
    const cols = (b.columns || []).filter((c) => !hiddenCols.has(String(c.id)));
    const loaded = !!_cards[b.id];
    const tag = loaded ? '' : (_loading[b.id] ? ' <span class="bc-mini">зареждам…</span>' : '');
    return `<section class="bc-board" data-board-id="${b.id}">
      <div class="bc-board-title">${esc(b.title)}${tag}</div>
      <div class="bc-cols">${cols.map((c) => colHtml(b, c, loaded)).join('')}</div>
    </section>`;
  }

  function colHtml(board, col, loaded) {
    const cards = ((_cards[board.id] || {})[col.id] || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
    const count = loaded ? cards.length : (col.cardsCount || 0);
    const body = loaded
      ? cards.map((card) => cardHtml(board, card)).join('')
      : `<div class="bc-col-skel">${Array(Math.min(col.cardsCount || 0, 4)).fill('<div class="bc-skel"></div>').join('')}</div>`;
    return `<div class="kanban-column bc-col">
      <div class="bc-col-head"><span class="bc-col-name">${esc(col.title)}</span><span class="bc-col-count">${count}</span></div>
      <div class="column-cards bc-col-cards" data-col-id="${col.id}" data-board-id="${board.id}"
           ondragover="bcDragOver(event)" ondragleave="bcDragLeave(event)" ondrop="bcDrop(event)">${body}</div>
    </div>`;
  }

  function cardHtml(board, card) {
    const av = (card.assignees || []).slice(0, 3).map((a) => `<span class="bc-av" title="${esc(a.name)}">${esc(initials(a.name))}</span>`).join('');
    const steps = card.stepsCount ? `<span class="bc-steps">☑ ${card.stepsCount}</span>` : '';
    return `<div class="kanban-card bc-card${card.completed ? ' bc-card--done' : ''}" draggable="true"
        data-card-id="${card.id}" data-board-id="${board.id}"
        ondragstart="bcDragStart(event)" ondragend="bcDragEnd(event)">
      <div class="bc-card-title">${esc(card.title)}</div>
      <div class="bc-card-foot"><span class="bc-avs">${av}</span><span class="bc-foot-right">${steps}${dueBadge(card.dueOn)}</span></div>
    </div>`;
  }

  // ---- drag & drop (moves within the same card table only) ----
  window.bcDragStart = function (e) {
    const card = e.target.closest('.bc-card');
    _dragCardId = card.dataset.cardId;
    _dragBoardId = card.dataset.boardId;
    const zone = card.closest('.bc-col-cards');
    _dragFromCol = zone && zone.dataset.colId;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  };
  window.bcDragEnd = function (e) {
    const card = e.target.closest('.bc-card');
    if (card) card.classList.remove('dragging');
    document.querySelectorAll('.bc-col-cards.drag-over').forEach((n) => n.classList.remove('drag-over'));
    _dragCardId = null;
  };
  window.bcDragOver = function (e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); };
  window.bcDragLeave = function (e) { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over'); };
  window.bcDrop = async function (e) {
    e.preventDefault();
    const zone = e.currentTarget;
    zone.classList.remove('drag-over');
    if (!_dragCardId) return;
    const targetCol = zone.dataset.colId;
    const targetBoard = zone.dataset.boardId;
    const cardId = _dragCardId;
    const fromCol = _dragFromCol;
    _dragCardId = null;
    if (targetBoard !== _dragBoardId) { toast('Местене между различни дъски още не се поддържа.', 'warn'); return; }
    if (targetCol === fromCol) return;
    const cardEl = document.querySelector(`.bc-card[data-card-id="${cardId}"]`);
    if (cardEl) zone.appendChild(cardEl); // optimistic
    try {
      const res = await fetch('/api/bc-board/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardTableId: Number(targetBoard), cardId: Number(cardId), targetColumnId: Number(targetCol), position: 0 }),
      });
      if (!res.ok) throw new Error('move failed');
      toast('Преместено в Basecamp ✓', 'success');
      setTimeout(() => loadBoardCards(targetBoard), 900); // reconcile just this board
    } catch {
      toast('Грешка при местене — връщам.', 'error');
      loadBoardCards(targetBoard);
    }
  };

  // ---- settings: choose which boards/columns are visible (per browser) ----
  window.bcToggleSettings = function () {
    const p = document.getElementById('bcSettings');
    if (!p) return;
    if (p.style.display !== 'none') { p.style.display = 'none'; return; }
    const hiddenBoards = getSet(HIDDEN_BOARDS_KEY);
    const hiddenCols = getSet(HIDDEN_COLS_KEY);
    p.innerHTML = '<div class="bc-settings-title">Какво да се вижда</div>' + ((_struct && _struct.boards) || []).map((b) => {
      const bChk = !hiddenBoards.has(String(b.id)) ? 'checked' : '';
      const colsHtml = (b.columns || []).map((c) => {
        const cChk = !hiddenCols.has(String(c.id)) ? 'checked' : '';
        return `<label class="bc-set-col"><input type="checkbox" ${cChk} onchange="bcToggleCol('${c.id}', this.checked)"> ${esc(c.title)} <span class="bc-mini">(${c.cardsCount || 0})</span></label>`;
      }).join('');
      return `<div class="bc-set-board">
        <label class="bc-set-board-row"><input type="checkbox" ${bChk} onchange="bcToggleBoard('${b.id}', this.checked)"> <b>${esc(b.title)}</b></label>
        <div class="bc-set-cols">${colsHtml}</div>
      </div>`;
    }).join('');
    p.style.display = 'block';
  };
  window.bcToggleBoard = function (id, visible) {
    const s = getSet(HIDDEN_BOARDS_KEY); if (visible) s.delete(String(id)); else s.add(String(id)); saveSet(HIDDEN_BOARDS_KEY, s);
    renderAll();
    if (visible && !_cards[id]) loadBoardCards(id);
  };
  window.bcToggleCol = function (id, visible) {
    const s = getSet(HIDDEN_COLS_KEY); if (visible) s.delete(String(id)); else s.add(String(id)); saveSet(HIDDEN_COLS_KEY, s);
    renderAll();
  };
})();
