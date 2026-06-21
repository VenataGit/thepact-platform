// Basecamp-backed kanban board. Reads the Video Production card tables from /api/bc-board
// and moves cards in Basecamp (as the logged-in user) via /api/bc-board/move.
(function () {
  const HIDDEN_BOARDS_KEY = 'thepact-bc-hidden-boards';
  const HIDDEN_COLS_KEY = 'thepact-bc-hidden-cols';
  let _bcData = null;
  let _bcDragCardId = null;
  let _bcDragBoardId = null;
  let _bcDragFromCol = null;
  let _bcTimer = null;

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
          <button class="bc-btn" onclick="bcRefresh(true)">↻ Презареди</button>
          <button class="bc-btn" onclick="bcToggleSettings()">⚙ Настройки</button>
        </div>
      </div>
      <div id="bcSettings" class="bc-settings" style="display:none"></div>
      <div id="bcBoards" class="bc-boards"><div class="bc-loading">Зареждам от Basecamp…</div></div>
    </div>`;
    await bcRefresh(false);
    if (_bcTimer) clearInterval(_bcTimer);
    _bcTimer = setInterval(() => {
      if (location.hash.indexOf('#/basecamp') !== 0) { clearInterval(_bcTimer); _bcTimer = null; return; }
      bcRefresh(false);
    }, 60000);
  };

  window.bcRefresh = async function (spinner) {
    const host = document.getElementById('bcBoards');
    if (!host) return;
    if (spinner) host.innerHTML = '<div class="bc-loading">Зареждам…</div>';
    try {
      const res = await fetch('/api/bc-board');
      if (res.status === 401) { host.innerHTML = '<div class="bc-empty">Сесията изтече. <a href="/login.html">Влез отново</a>.</div>'; return; }
      if (!res.ok) { const e = await res.json().catch(() => ({})); host.innerHTML = `<div class="bc-empty">Грешка: ${esc(e.error || res.status)}</div>`; return; }
      _bcData = await res.json();
      bcRender();
    } catch { host.innerHTML = '<div class="bc-empty">Няма връзка със сървъра.</div>'; }
  };

  function bcRender() {
    const host = document.getElementById('bcBoards');
    if (!host || !_bcData) return;
    const hiddenBoards = getSet(HIDDEN_BOARDS_KEY);
    const hiddenCols = getSet(HIDDEN_COLS_KEY);
    const boards = (_bcData.boards || []).filter((b) => !hiddenBoards.has(String(b.id)));
    if (!boards.length) { host.innerHTML = '<div class="bc-empty">Няма видими дъски. Виж ⚙ Настройки.</div>'; return; }
    host.innerHTML = boards.map((b) => {
      const cols = (b.columns || []).filter((c) => !hiddenCols.has(String(c.id)));
      return `<section class="bc-board">
        <div class="bc-board-title">${esc(b.title)}</div>
        <div class="bc-cols">${cols.map((c) => colHtml(b, c)).join('')}</div>
      </section>`;
    }).join('');
  }

  function colHtml(board, col) {
    const cards = (col.cards || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
    return `<div class="kanban-column bc-col">
      <div class="bc-col-head"><span class="bc-col-name">${esc(col.title)}</span><span class="bc-col-count">${cards.length}</span></div>
      <div class="column-cards bc-col-cards" data-col-id="${col.id}" data-board-id="${board.id}"
           ondragover="bcDragOver(event)" ondragleave="bcDragLeave(event)" ondrop="bcDrop(event)">
        ${cards.map((card) => cardHtml(board, card)).join('')}
      </div>
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
    _bcDragCardId = card.dataset.cardId;
    _bcDragBoardId = card.dataset.boardId;
    _bcDragFromCol = card.closest('.bc-col-cards') && card.closest('.bc-col-cards').dataset.colId;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  };
  window.bcDragEnd = function (e) {
    const card = e.target.closest('.bc-card');
    if (card) card.classList.remove('dragging');
    document.querySelectorAll('.bc-col-cards.drag-over').forEach((n) => n.classList.remove('drag-over'));
    _bcDragCardId = null;
  };
  window.bcDragOver = function (e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); };
  window.bcDragLeave = function (e) { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over'); };
  window.bcDrop = async function (e) {
    e.preventDefault();
    const zone = e.currentTarget;
    zone.classList.remove('drag-over');
    if (!_bcDragCardId) return;
    const targetCol = zone.dataset.colId;
    const targetBoard = zone.dataset.boardId;
    const cardId = _bcDragCardId;
    const fromCol = _bcDragFromCol;
    _bcDragCardId = null;
    if (targetBoard !== _bcDragBoardId) { toast('Местене между различни дъски още не се поддържа.', 'warn'); return; }
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
      // Optimistic move already applied; the 60s auto-refresh reconciles counts/positions.
    } catch {
      toast('Грешка при местене — връщам.', 'error');
      bcRefresh(false);
    }
  };

  // ---- settings: choose which boards/columns are visible (per browser) ----
  window.bcToggleSettings = function () {
    const p = document.getElementById('bcSettings');
    if (!p) return;
    if (p.style.display !== 'none') { p.style.display = 'none'; return; }
    const hiddenBoards = getSet(HIDDEN_BOARDS_KEY);
    const hiddenCols = getSet(HIDDEN_COLS_KEY);
    p.innerHTML = '<div class="bc-settings-title">Какво да се вижда</div>' + (_bcData && _bcData.boards || []).map((b) => {
      const bChk = !hiddenBoards.has(String(b.id)) ? 'checked' : '';
      const colsHtml = (b.columns || []).map((c) => {
        const cChk = !hiddenCols.has(String(c.id)) ? 'checked' : '';
        return `<label class="bc-set-col"><input type="checkbox" ${cChk} onchange="bcToggleCol('${c.id}', this.checked)"> ${esc(c.title)}</label>`;
      }).join('');
      return `<div class="bc-set-board">
        <label class="bc-set-board-row"><input type="checkbox" ${bChk} onchange="bcToggleBoard('${b.id}', this.checked)"> <b>${esc(b.title)}</b></label>
        <div class="bc-set-cols">${colsHtml}</div>
      </div>`;
    }).join('');
    p.style.display = 'block';
  };
  window.bcToggleBoard = function (id, visible) {
    const s = getSet(HIDDEN_BOARDS_KEY); if (visible) s.delete(String(id)); else s.add(String(id)); saveSet(HIDDEN_BOARDS_KEY, s); bcRender();
  };
  window.bcToggleCol = function (id, visible) {
    const s = getSet(HIDDEN_COLS_KEY); if (visible) s.delete(String(id)); else s.add(String(id)); saveSet(HIDDEN_COLS_KEY, s); bcRender();
  };
})();
