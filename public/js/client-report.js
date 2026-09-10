// ==================== СТАТИСТИКА (само за админ) ====================
// Брой нови задачи / заснето / монтирано / качено / премествания между
// отделите — нарязани по клиент, по отдел (екип) и по конкретен човек, за
// избран период. Данните идват от /api/client-report (requireAdmin), което
// чете bc_stage_events (services/stage-log.js) — засичано на всеки 15 мин
// от pm-agent snapshot-а.
//
// Едно зареждане на периода носи и трите разреза наведнъж (byClient /
// byDepartment / byPerson) — превключването на таб само сменя кой се
// показва, без ново запитване. Кликване на ред във всеки таб филтрира
// детайлните таблици долу по съответното измерение (клиент/отдел/човек).

let _crState = { from: null, to: null, tab: 'client', filter: null, data: null };

const CR_TABS = [
  { id: 'client', label: 'По клиенти', field: 'client', col: 'Клиент' },
  { id: 'department', label: 'По отдели', field: 'department', col: 'Отдел' },
  { id: 'person', label: 'По хора', field: 'person', col: 'Човек' },
];

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
  if (kind === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // понеделник
    return { from: crDateStr(d), to: today };
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

function crTab() {
  return CR_TABS.find((t) => t.id === _crState.tab) || CR_TABS[0];
}

async function renderClientReport(el) {
  el.className = 'flush-top';
  if (!currentUser || currentUser.role !== 'admin') {
    el.innerHTML = '<div class="home-content-box"><h2>📊 Статистика</h2><p>Тази страница е само за администратор.</p></div>';
    return;
  }
  if (!_crState.from) Object.assign(_crState, crPreset('month'), { tab: 'client', filter: null });

  el.innerHTML = `
    <div class="home-content-box home-content-box--wide tr-page">
      <div class="tr-head">
        <h2>📊 Статистика</h2>
        <div class="tr-presets">
          <button class="cr-preset" data-p="week">Тази седмица</button>
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
      <div class="tr-presets" id="crTabs" style="margin-bottom:12px">
        ${CR_TABS.map((t) => `<button class="cr-tab tr-preset" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div class="tr-box"><h3 id="crBucketTitle"></h3><div id="crByBucket"></div></div>
      <div class="tr-box"><h3 id="crNewTitle">Нови задачи</h3><div id="crNew"></div></div>
      <div class="tr-box"><h3 id="crStepTitle">Заснето / Монтирано / Качено</h3><div id="crSteps"></div></div>
      <div class="tr-box"><h3 id="crMoveTitle">Преместени към следващия отдел</h3><div id="crMoves"></div></div>
    </div>`;

  el.querySelectorAll('.cr-preset').forEach((b) => b.addEventListener('click', () => {
    Object.assign(_crState, crPreset(b.dataset.p), { filter: null });
    renderClientReport(el);
  }));
  document.getElementById('crApply').addEventListener('click', () => {
    _crState.from = document.getElementById('crFrom').value || _crState.from;
    _crState.to = document.getElementById('crTo').value || _crState.to;
    _crState.filter = null;
    renderClientReport(el);
  });
  el.querySelectorAll('.cr-tab').forEach((b) => b.addEventListener('click', () => {
    _crState.tab = b.dataset.tab;
    _crState.filter = null;
    crHighlightTab();
    crRenderBucket();
    crRenderDetail();
  }));
  crHighlightTab();

  await crLoad();
}

function crHighlightTab() {
  document.querySelectorAll('.cr-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === _crState.tab));
}

async function crLoad() {
  const q = '?from=' + _crState.from + '&to=' + _crState.to;
  const r = await fetch('/api/client-report' + q);
  if (!r.ok) return;
  const data = await r.json();
  _crState.data = data;
  crRenderBucket();
  crRenderDetail();
}

function crBucketRows() {
  const data = _crState.data;
  if (!data) return [];
  if (_crState.tab === 'department') return data.byDepartment || [];
  if (_crState.tab === 'person') return data.byPerson || [];
  return data.byClient || [];
}

function crRenderBucket() {
  const tab = crTab();
  document.getElementById('crBucketTitle').textContent = tab.label;
  const rows = crBucketRows();
  const host = document.getElementById('crByBucket');
  host.innerHTML = rows.length
    ? '<table class="admin-table tr-table"><thead><tr><th>' + tab.col + '</th><th>Нови задачи</th>' +
      '<th>Сценарий</th><th>Заснемане</th><th>Монтаж</th><th>Качване</th><th>Премествания</th></tr></thead><tbody>' +
      rows.map((c, i) => '<tr class="cr-bucket-row' + (_crState.filter === c.name ? ' cr-active' : '') + '" data-i="' + i + '"><td><b>' + esc(c.name) + '</b></td>' +
        '<td>' + c.newTasks + '</td><td>' + c.idea + '</td><td>' + c.shoot + '</td>' +
        '<td>' + c.edit + '</td><td>' + c.upload + '</td><td>' + c.moves + '</td></tr>').join('') +
      '</tbody></table>'
    : '<div class="tr-empty">Няма данни за периода.</div>';
  host.querySelectorAll('.cr-bucket-row').forEach((row) => row.addEventListener('click', () => {
    const c = rows[Number(row.dataset.i)];
    _crState.filter = _crState.filter === c.name ? null : c.name;
    crRenderBucket();
    crRenderDetail();
  }));
}

function crFilterChip() {
  return _crState.filter
    ? ' <span class="tr-filterchip">' + esc(_crState.filter) + ' <a href="#" class="cr-clear-filter" title="Махни филтъра">✕</a></span>'
    : '';
}

function crMatch(row) {
  const f = _crState.filter;
  if (!f) return true;
  return row[crTab().field] === f;
}

function crRenderDetail() {
  const data = _crState.data;
  if (!data) return;

  const newTasks = (data.newTasks || []).filter(crMatch);
  document.getElementById('crNewTitle').innerHTML = 'Нови задачи (' + newTasks.length + ')' + crFilterChip();
  document.getElementById('crNew').innerHTML = newTasks.length
    ? '<table class="admin-table tr-table"><thead><tr><th>Кога</th><th>Клиент</th><th>Отдел</th><th>Човек</th><th>Видео</th><th>Задача</th></tr></thead><tbody>' +
      newTasks.map((t) => '<tr><td>' + crFmtWhen(t.createdAt) + '</td><td>' + esc(t.client) + '</td>' +
        '<td>' + esc(t.department) + '</td><td>' + esc(t.person) + '</td>' +
        '<td>' + (t.video ? 'Видео ' + t.video : '') + '</td>' +
        '<td>' + (t.url ? '<a href="' + esc(t.url) + '" target="_blank">' + crVideoLabel(t) + ' ↗</a>' : crVideoLabel(t)) + '</td></tr>').join('') +
      '</tbody></table>'
    : '<div class="tr-empty">Няма нови задачи за периода' + (_crState.filter ? ' за ' + esc(_crState.filter) : '') + '.</div>';

  const stepEvents = (data.stepEvents || []).filter(crMatch);
  document.getElementById('crStepTitle').innerHTML = 'Заснето / Монтирано / Качено (' + stepEvents.length + ')' + crFilterChip();
  document.getElementById('crSteps').innerHTML = stepEvents.length
    ? '<table class="admin-table tr-table"><thead><tr><th>Кога</th><th>Клиент</th><th>Отдел</th><th>Човек</th><th>Видео</th><th>Стъпка</th><th>Задача</th></tr></thead><tbody>' +
      stepEvents.map((e) => '<tr><td>' + crFmtWhen(e.occurredAt) + '</td><td>' + esc(e.client) + '</td>' +
        '<td>' + esc(e.department) + '</td><td>' + esc(e.person) + '</td>' +
        '<td>' + (e.video ? 'Видео ' + e.video : '') + '</td><td>' + esc(e.stepLabel) + '</td>' +
        '<td>' + (e.url ? '<a href="' + esc(e.url) + '" target="_blank">' + crVideoLabel(e) + ' ↗</a>' : crVideoLabel(e)) + '</td></tr>').join('') +
      '</tbody></table>'
    : '<div class="tr-empty">Няма засечени стъпки за периода' + (_crState.filter ? ' за ' + esc(_crState.filter) : '') + '.</div>';

  const moveEvents = (data.moveEvents || []).filter(crMatch);
  document.getElementById('crMoveTitle').innerHTML = 'Преместени към следващия отдел (' + moveEvents.length + ')' + crFilterChip();
  document.getElementById('crMoves').innerHTML = moveEvents.length
    ? '<table class="admin-table tr-table"><thead><tr><th>Кога</th><th>Клиент</th><th>Човек</th><th>Видео</th><th>От → Към</th><th>Задача</th></tr></thead><tbody>' +
      moveEvents.map((e) => '<tr><td>' + crFmtWhen(e.occurredAt) + '</td><td>' + esc(e.client) + '</td>' +
        '<td>' + esc(e.person) + '</td>' +
        '<td>' + (e.video ? 'Видео ' + e.video : '') + '</td>' +
        '<td>' + esc(e.fromBoard) + ' → ' + esc(e.toBoard) + '</td>' +
        '<td>' + (e.url ? '<a href="' + esc(e.url) + '" target="_blank">' + crVideoLabel(e) + ' ↗</a>' : crVideoLabel(e)) + '</td></tr>').join('') +
      '</tbody></table>'
    : '<div class="tr-empty">Няма премествания за периода' + (_crState.filter ? ' за ' + esc(_crState.filter) : '') + '.</div>';

  document.querySelectorAll('.cr-clear-filter')
    .forEach((a) => a.addEventListener('click', (ev) => {
      ev.preventDefault(); _crState.filter = null; crRenderBucket(); crRenderDetail();
    }));
}
