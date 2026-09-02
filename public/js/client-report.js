// ==================== ОТЧЕТ „ПО КЛИЕНТИ" (само за админ) ====================
// Какво е влязло, заснето, монтирано и качено за всеки клиент — за избран период.
// Данните идват от /api/client-report (requireAdmin), което чете bc_cards_snap
// (нови карти) + bc_stage_events (services/stage-log.js — стъпка чекната и
// преместване между отдели, засичани от pm-agent snapshot-а на всеки 15 мин).
//
// Данните тръгват от 02.09.2026 нататък — Basecamp не пази история на
// завършването на стъпки, затова минали месеци не могат да се възстановят.

let _crState = { from: null, to: null, client: null, data: null };

function crDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function crPreset(kind) {
  const now = new Date();
  const today = crDateStr(now);
  if (kind === 'month') return { from: crDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  if (kind === 'lastmonth') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: crDateStr(first), to: crDateStr(last) };
  }
  const d30 = new Date(now); d30.setDate(d30.getDate() - 29);
  return { from: crDateStr(d30), to: today };
}

function crFmtWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
}

function crVideoLabel(row) {
  return row.title ? esc(row.title) : '';
}

async function renderClientReport(el) {
  el.className = 'flush-top';
  if (!currentUser || currentUser.role !== 'admin') {
    el.innerHTML = '<div class="home-content-box"><h2>📊 Отчет по клиенти</h2><p>Тази страница е само за администратор.</p></div>';
    return;
  }
  if (!_crState.from) Object.assign(_crState, crPreset('month'), { client: null });

  el.innerHTML = `
    <div class="home-content-box home-content-box--wide tr-page">
      <div class="tr-head">
        <h2>📊 Отчет по клиенти</h2>
        <div class="tr-presets">
          <button class="cr-preset" data-p="month">Този месец</button>
          <button class="cr-preset" data-p="lastmonth">Миналия месец</button>
          <button class="cr-preset" data-p="30">30 дни</button>
        </div>
        <div class="tr-range">
          <input type="date" id="crFrom" value="${_crState.from}">
          <span>—</span>
          <input type="date" id="crTo" value="${_crState.to}">
          <button class="tr-apply" id="crApply">Покажи</button>
        </div>
      </div>
      <p class="tr-dim" style="margin:0 0 12px">
        Данните са от 02.09.2026 нататък — колкото по-назад отиде избраният период
        отпреди тази дата, толкова по-непълен ще е отчетът.
      </p>
      <div class="tr-box"><h3>По клиенти</h3><div id="crByClient"></div></div>
      <div class="tr-box"><h3 id="crNewTitle">Нови задачи</h3><div id="crNew"></div></div>
      <div class="tr-box"><h3 id="crStepTitle">Заснето / Монтирано / Качено</h3><div id="crSteps"></div></div>
      <div class="tr-box"><h3 id="crMoveTitle">Преместени към следващия отдел</h3><div id="crMoves"></div></div>
    </div>`;

  el.querySelectorAll('.cr-preset').forEach((b) => b.addEventListener('click', () => {
    Object.assign(_crState, crPreset(b.dataset.p), { client: null });
    renderClientReport(el);
  }));
  document.getElementById('crApply').addEventListener('click', () => {
    _crState.from = document.getElementById('crFrom').value || _crState.from;
    _crState.to = document.getElementById('crTo').value || _crState.to;
    _crState.client = null;
    renderClientReport(el);
  });

  await crLoad();
}

async function crLoad() {
  const q = '?from=' + _crState.from + '&to=' + _crState.to;
  const r = await fetch('/api/client-report' + q);
  if (!r.ok) return;
  const data = await r.json();
  _crState.data = data;

  const byClientHost = document.getElementById('crByClient');
  const rows = data.byClient || [];
  byClientHost.innerHTML = rows.length
    ? '<table class="admin-table tr-table"><thead><tr><th>Клиент</th><th>Нови задачи</th>' +
      '<th>Сценарий</th><th>Заснемане</th><th>Монтаж</th><th>Качване</th><th>Премествания</th></tr></thead><tbody>' +
      rows.map((c, i) => '<tr class="cr-client" data-i="' + i + '"><td><b>' + esc(c.client) + '</b></td>' +
        '<td>' + c.newTasks + '</td><td>' + c.idea + '</td><td>' + c.shoot + '</td>' +
        '<td>' + c.edit + '</td><td>' + c.upload + '</td><td>' + c.moves + '</td></tr>').join('') +
      '</tbody></table>'
    : '<div class="tr-empty">Няма данни за периода.</div>';
  byClientHost.querySelectorAll('.cr-client').forEach((row) => row.addEventListener('click', () => {
    const c = rows[Number(row.dataset.i)];
    _crState.client = _crState.client === c.client ? null : c.client;
    crRenderDetail();
  }));

  crRenderDetail();
}

function crFilterChip() {
  return _crState.client
    ? ' <span class="tr-filterchip">' + esc(_crState.client) + ' <a href="#" class="cr-clear-filter" title="Махни филтъра">✕</a></span>'
    : '';
}

function crRenderDetail() {
  const data = _crState.data;
  if (!data) return;
  const f = _crState.client;

  const newTasks = (data.newTasks || []).filter((t) => !f || t.client === f);
  document.getElementById('crNewTitle').innerHTML = 'Нови задачи (' + newTasks.length + ')' + crFilterChip();
  document.getElementById('crNew').innerHTML = newTasks.length
    ? '<table class="admin-table tr-table"><thead><tr><th>Кога</th><th>Клиент</th><th>Видео</th><th>Задача</th></tr></thead><tbody>' +
      newTasks.map((t) => '<tr><td>' + crFmtWhen(t.createdAt) + '</td><td>' + esc(t.client) + '</td>' +
        '<td>' + (t.video ? 'Видео ' + t.video : '') + '</td>' +
        '<td>' + (t.url ? '<a href="' + esc(t.url) + '" target="_blank">' + crVideoLabel(t) + ' ↗</a>' : crVideoLabel(t)) + '</td></tr>').join('') +
      '</tbody></table>'
    : '<div class="tr-empty">Няма нови задачи за периода' + (f ? ' за ' + esc(f) : '') + '.</div>';

  const stepEvents = (data.stepEvents || []).filter((e) => !f || e.client === f);
  document.getElementById('crStepTitle').innerHTML = 'Заснето / Монтирано / Качено (' + stepEvents.length + ')' + crFilterChip();
  document.getElementById('crSteps').innerHTML = stepEvents.length
    ? '<table class="admin-table tr-table"><thead><tr><th>Кога</th><th>Клиент</th><th>Видео</th><th>Стъпка</th><th>Задача</th></tr></thead><tbody>' +
      stepEvents.map((e) => '<tr><td>' + crFmtWhen(e.occurredAt) + '</td><td>' + esc(e.client) + '</td>' +
        '<td>' + (e.video ? 'Видео ' + e.video : '') + '</td><td>' + esc(e.stepLabel) + '</td>' +
        '<td>' + (e.url ? '<a href="' + esc(e.url) + '" target="_blank">' + crVideoLabel(e) + ' ↗</a>' : crVideoLabel(e)) + '</td></tr>').join('') +
      '</tbody></table>'
    : '<div class="tr-empty">Няма засечени стъпки за периода' + (f ? ' за ' + esc(f) : '') + '.</div>';

  const moveEvents = (data.moveEvents || []).filter((e) => !f || e.client === f);
  document.getElementById('crMoveTitle').innerHTML = 'Преместени към следващия отдел (' + moveEvents.length + ')' + crFilterChip();
  document.getElementById('crMoves').innerHTML = moveEvents.length
    ? '<table class="admin-table tr-table"><thead><tr><th>Кога</th><th>Клиент</th><th>Видео</th><th>От → Към</th><th>Задача</th></tr></thead><tbody>' +
      moveEvents.map((e) => '<tr><td>' + crFmtWhen(e.occurredAt) + '</td><td>' + esc(e.client) + '</td>' +
        '<td>' + (e.video ? 'Видео ' + e.video : '') + '</td>' +
        '<td>' + esc(e.fromBoard) + ' → ' + esc(e.toBoard) + '</td>' +
        '<td>' + (e.url ? '<a href="' + esc(e.url) + '" target="_blank">' + crVideoLabel(e) + ' ↗</a>' : crVideoLabel(e)) + '</td></tr>').join('') +
      '</tbody></table>'
    : '<div class="tr-empty">Няма премествания за периода' + (f ? ' за ' + esc(f) : '') + '.</div>';

  document.querySelectorAll('.cr-clear-filter')
    .forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); _crState.client = null; crRenderDetail(); }));
}
