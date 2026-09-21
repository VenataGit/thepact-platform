// ==================== ГОТОВИ ЗАДАЧИ (само за админ) ====================
// Отделна страница от „Статистика" — Венци поиска да не се смесва с
// отчета по клиенти/отдели/хора (10.09.2026 → 15.09.2026: „става голяма
// мешаница, нищо не мога да разбера... искам този репорт да си бъде на
// отделен таб/страница").
//
// Данни от бутона „✓ Готово" в The Pact Tools (features/task-done.js, вече
// вграден в прозорчето на таймера) — изричен клик от самия човек, за разлика
// от bc_stage_events, където „кой" е ЗАСЕЧЕН автоматично. Отдел = позицията
// на човека (Настройки → Екип и роли), не дъската на картата — виж
// src/routes/task-completions.js за пълния коментар защо.

let _tcState = { from: null, to: null, filter: null, data: null };

function tcDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function tcPreset(kind) {
  const now = new Date();
  const today = tcDateStr(now);
  if (kind === 'today') return { from: today, to: today };
  if (kind === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // понеделник
    return { from: tcDateStr(d), to: today };
  }
  if (kind === 'month') return { from: tcDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  if (kind === 'lastmonth') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: tcDateStr(first), to: tcDateStr(last) };
  }
  const d30 = new Date(now); d30.setDate(d30.getDate() - 29);
  return { from: tcDateStr(d30), to: today };
}

function tcFmtWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
}

async function renderTaskCompletionsReport(el) {
  el.className = 'flush-top';
  if (!currentUser || currentUser.role !== 'admin') {
    el.innerHTML = '<div class="home-content-box"><h2>✓ Готови задачи</h2><p>Тази страница е само за администратор.</p></div>';
    return;
  }
  if (!_tcState.from) Object.assign(_tcState, tcPreset('today'), { filter: null });

  el.innerHTML = `
    <div class="home-content-box home-content-box--wide tr-page">
      <div class="tr-head">
        <h2>✓ Готови задачи</h2>
        <div class="tr-presets">
          <button class="tc-preset" data-p="today">Днес</button>
          <button class="tc-preset" data-p="week">Тази седмица</button>
          <button class="tc-preset" data-p="month">Този месец</button>
          <button class="tc-preset" data-p="lastmonth">Миналия месец</button>
          <button class="tc-preset" data-p="30">30 дни</button>
        </div>
        <div class="tr-range">
          <input type="date" id="tcFrom" value="${_tcState.from}">
          <span>—</span>
          <input type="date" id="tcTo" value="${_tcState.to}">
          <button class="tr-apply" id="tcApply">Покажи</button>
        </div>
      </div>
      <p class="tr-dim" style="margin:0 0 12px">
        Само задачите, които някой САМ е отбелязал с бутона „✓ Готово" в разширението — не автоматично
        засичане. Данните тръгват от 10.09.2026 нататък.
      </p>
      <div class="tr-tiles" id="tcTiles"></div>
      <div class="tr-box"><h3>Класация по човек</h3><div id="tcByUser"></div></div>
      <div class="tr-box"><h3 id="tcItemsTitle">Готови задачи</h3><div id="tcItems"></div></div>
    </div>`;

  el.querySelectorAll('.tc-preset').forEach((b) => b.addEventListener('click', () => {
    Object.assign(_tcState, tcPreset(b.dataset.p), { filter: null });
    renderTaskCompletionsReport(el);
  }));
  document.getElementById('tcApply').addEventListener('click', () => {
    _tcState.from = document.getElementById('tcFrom').value || _tcState.from;
    _tcState.to = document.getElementById('tcTo').value || _tcState.to;
    _tcState.filter = null;
    renderTaskCompletionsReport(el);
  });

  await tcLoad();
}

async function tcLoad() {
  const q = '?from=' + _tcState.from + '&to=' + _tcState.to;
  const r = await fetch('/api/task-completions/report' + q);
  if (!r.ok) return;
  _tcState.data = await r.json();
  tcRenderTiles();
  tcRenderByUser();
  tcRenderItems();
}

function tcRenderTiles() {
  const data = _tcState.data;
  const host = document.getElementById('tcTiles');
  if (!data) { host.innerHTML = ''; return; }
  const people = (data.byUser || []).length;
  const total = (data.items || []).length;
  host.innerHTML = [
    ['Готови задачи за периода', total],
    ['Хора, отбелязали поне една', people],
  ].map((x) => '<div class="tr-tile"><div class="tr-tile__num">' + x[1] + '</div><div class="tr-tile__label">' + x[0] + '</div></div>').join('');
}

function tcFilterChip() {
  return _tcState.filter
    ? ' <span class="tr-filterchip">' + esc(_tcState.filter) + ' <a href="#" class="tc-clear-filter" title="Махни филтъра">✕</a></span>'
    : '';
}

function tcRenderByUser() {
  const data = _tcState.data;
  const rows = (data && data.byUser) || [];
  const host = document.getElementById('tcByUser');
  host.innerHTML = rows.length
    ? '<table class="admin-table tr-table"><thead><tr><th>#</th><th>Човек</th><th>Отдел</th><th>Готови задачи</th></tr></thead><tbody>' +
      rows.map((u, i) => '<tr class="tc-user-row' + (_tcState.filter === u.name ? ' cr-active' : '') + '" data-i="' + i + '">' +
        '<td>' + (i + 1) + '</td><td><b>' + esc(u.name) + '</b></td>' +
        '<td>' + esc(u.department) + '</td><td>' + u.count + '</td></tr>').join('') +
      '</tbody></table>'
    : '<div class="tr-empty">Никой не е отбелязал задача като готова за периода.</div>';
  host.querySelectorAll('.tc-user-row').forEach((row) => row.addEventListener('click', () => {
    const u = rows[Number(row.dataset.i)];
    _tcState.filter = _tcState.filter === u.name ? null : u.name;
    tcRenderByUser();
    tcRenderItems();
  }));
}

function tcRenderItems() {
  const data = _tcState.data;
  const items = ((data && data.items) || []).filter((it) => !_tcState.filter || it.name === _tcState.filter);
  document.getElementById('tcItemsTitle').innerHTML = 'Готови задачи (' + items.length + ')' + tcFilterChip();
  document.getElementById('tcItems').innerHTML = items.length
    ? '<table class="admin-table tr-table"><thead><tr><th>Кога</th><th>Човек</th><th>Задача</th></tr></thead><tbody>' +
      items.map((it) => '<tr><td>' + tcFmtWhen(it.occurred_at) + '</td><td>' + esc(it.name) + '</td>' +
        '<td>' + (it.url ? '<a href="' + esc(it.url) + '" target="_blank">' + esc(it.title || '') + ' ↗</a>' : esc(it.title || '')) + '</td></tr>').join('') +
      '</tbody></table>'
    : '<div class="tr-empty">Няма отбелязани задачи за периода' + (_tcState.filter ? ' за ' + esc(_tcState.filter) : '') + '.</div>';

  document.querySelectorAll('.tc-clear-filter')
    .forEach((a) => a.addEventListener('click', (ev) => {
      ev.preventDefault(); _tcState.filter = null; tcRenderByUser(); tcRenderItems();
    }));
}
