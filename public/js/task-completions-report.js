// ==================== ГОТОВИ ЗАДАЧИ ====================
// Админ и мини админ виждат всички; всеки друг вижда САМО своите (13.10.2026 —
// „всеки да може да си следи колко видеа е направил"). Филтрирането е на
// сървъра (/api/task-completions/report), тук само се скрива класацията.
// Отделна страница от „Статистика" — Венци поиска да не се смесва с
// отчета по клиенти/отдели/хора (15.09.2026: „става голяма мешаница").
//
// Данни от бутона „✓ Готово" в The Pact Tools (в прозорчето на таймера) —
// изричен клик от самия човек, не автоматично засичане.
//
// „Кой още е работил" — вариант 2 от демото /demo/done-coworkers.html (избран от
// Венци): значка „👥 N" на реда разгъва кой друг е цъкнал по същата задача, кога
// и дали преди/след; в класацията — „сам / с други". Отдел = позицията на човека,
// закачена към Pre-Production / Production / Post-Production / Project Management
// в ⚙ Настройки на тази страница (само за пълен админ).

let _tcState = { from: null, to: null, person: null, dept: null, data: null, open: new Set() };

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

function tcIsFullAdmin() {
  return !!currentUser && currentUser.role === 'admin';
}

async function renderTaskCompletionsReport(el) {
  el.className = 'flush-top';
  const mine = !currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'mini_admin');
  if (!_tcState.from) Object.assign(_tcState, tcPreset('today'), { person: null, dept: null });

  el.innerHTML = `
    <div class="home-content-box home-content-box--wide tr-page">
      <div class="tr-head">
        <h2>✓ ${mine ? 'Моите готови задачи' : 'Готови задачи'}</h2>
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
          ${tcIsFullAdmin() ? '<button class="tr-csv" id="tcGear" title="Позиции → отдел и хората в този отчет (само за админ)">⚙ Настройки</button>' : ''}
        </div>
      </div>
      <p class="tr-dim" style="margin:0 0 12px">
        ${mine ? 'Виждаш само своите задачи — тези, които САМ си отбелязал с бутона „✓ Готово" в разширението.' : `Само задачите, които някой САМ е отбелязал с бутона „✓ Готово" в разширението — не автоматично
        засичане.`} „👥" показва кой още е цъкнал „✓ Готово" по същата задача. Данните тръгват от 10.09.2026 нататък.
      </p>
      <div class="tr-presets" id="tcDeptFilter" style="margin-bottom:12px"></div>
      <div class="tr-tiles" id="tcTiles"></div>
      <div class="tr-box"${mine ? ' style="display:none"' : ''}><h3>Класация по човек</h3><div id="tcByUser"></div></div>
      <div class="tr-box"><h3 id="tcItemsTitle">Готови задачи</h3><div id="tcItems"></div></div>
    </div>
    <div class="tc-modal-bg" id="tcModal"><div class="tc-modal" id="tcModalBody"></div></div>`;

  el.querySelectorAll('.tc-preset').forEach((b) => b.addEventListener('click', () => {
    Object.assign(_tcState, tcPreset(b.dataset.p), { person: null, dept: null });
    renderTaskCompletionsReport(el);
  }));
  document.getElementById('tcApply').addEventListener('click', () => {
    _tcState.from = document.getElementById('tcFrom').value || _tcState.from;
    _tcState.to = document.getElementById('tcTo').value || _tcState.to;
    _tcState.person = null;
    _tcState.dept = null;
    renderTaskCompletionsReport(el);
  });
  const gear = document.getElementById('tcGear');
  if (gear) gear.addEventListener('click', () => { tcOpenSettings(); });
  document.getElementById('tcModal').addEventListener('click', (e) => {
    if (e.target.id === 'tcModal') tcCloseSettings();
  });

  await tcLoad();
}

async function tcLoad() {
  const q = '?from=' + _tcState.from + '&to=' + _tcState.to;
  const r = await fetch('/api/task-completions/report' + q);
  if (!r.ok) return;
  _tcState.data = await r.json();
  _tcState.open.clear();
  tcRenderAll();
}

function tcRenderAll() {
  tcRenderDeptFilter();
  tcRenderTiles();
  tcRenderByUser();
  tcRenderItems();
}

// ---------- филтри ----------

function tcDepartments() {
  const data = _tcState.data || {};
  const list = (data.departments || []).slice();
  // „(без отдел)" и др. — само ако реално ги има в периода
  (data.byUser || []).forEach((u) => { if (!list.includes(u.department)) list.push(u.department); });
  return list;
}

function tcVisible(row) {
  if (_tcState.dept && row.department !== _tcState.dept) return false;
  return true;
}

function tcRenderDeptFilter() {
  const host = document.getElementById('tcDeptFilter');
  if (!_tcState.data || _tcState.data.mine) { host.innerHTML = ''; return; }
  host.innerHTML = '<button class="tc-dept cr-tab tr-preset' + (!_tcState.dept ? ' active' : '') + '" data-d="">Всички отдели</button>' +
    tcDepartments().map((d) => '<button class="tc-dept cr-tab tr-preset' + (_tcState.dept === d ? ' active' : '') + '" data-d="' + esc(d) + '">' + esc(d) + '</button>').join('');
  host.querySelectorAll('.tc-dept').forEach((b) => b.addEventListener('click', () => {
    _tcState.dept = b.dataset.d || null;
    _tcState.person = null; // смяна на отдел изчиства филтъра по конкретен човек
    _tcState.open.clear();
    tcRenderAll();
  }));
}

function tcRenderTiles() {
  const data = _tcState.data;
  const host = document.getElementById('tcTiles');
  if (!data) { host.innerHTML = ''; return; }
  const items = (data.items || []).filter(tcVisible);
  const people = new Set(items.map((it) => it.user_id)).size;
  const team = items.filter((it) => (it.others || []).length).length;
  host.innerHTML = (data.mine
    ? [['Мои готови задачи за периода', items.length], ['от тях заедно с други', team]]
    : [['Готови задачи за периода', items.length], ['Хора, отбелязали поне една', people], ['Отметки по задачи с 2+ души', team]]
  ).map((x) => '<div class="tr-tile"><div class="tr-tile__num">' + x[1] + '</div><div class="tr-tile__label">' + x[0] + '</div></div>').join('');
}

function tcFilterChips() {
  let html = '';
  if (_tcState.dept) {
    html += ' <span class="tr-filterchip">' + esc(_tcState.dept) + ' <a href="#" class="tc-clear-dept" title="Махни филтъра по отдел">✕</a></span>';
  }
  if (_tcState.person) {
    const u = ((_tcState.data && _tcState.data.byUser) || []).find((x) => x.user_id === _tcState.person);
    html += ' <span class="tr-filterchip">' + esc(u ? u.name : '') + ' <a href="#" class="tc-clear-filter" title="Махни филтъра">✕</a></span>';
  }
  return html;
}

// ---------- класация ----------

function tcRenderByUser() {
  const data = _tcState.data;
  const rows = ((data && data.byUser) || []).filter(tcVisible);
  const host = document.getElementById('tcByUser');
  host.innerHTML = rows.length
    ? '<table class="admin-table tr-table"><thead><tr><th>#</th><th>Човек</th><th>Позиция</th><th>Отдел</th><th>Готови задачи</th><th>сам / с други</th></tr></thead><tbody>' +
      rows.map((u, i) => '<tr class="tc-user-row' + (_tcState.person === u.user_id ? ' cr-active' : '') + '" data-u="' + u.user_id + '">' +
        '<td>' + (i + 1) + '</td><td><b>' + esc(u.name) + '</b></td>' +
        '<td>' + esc(u.position) + '</td><td>' + esc(u.department) + '</td><td>' + u.count + '</td>' +
        '<td class="tc-split">' + (u.count - u.team_count) + ' сам · <b>' + u.team_count + ' с други</b></td></tr>').join('') +
      '</tbody></table>'
    : '<div class="tr-empty">Никой не е отбелязал задача като готова за периода.</div>';
  host.querySelectorAll('.tc-user-row').forEach((row) => row.addEventListener('click', () => {
    const id = Number(row.dataset.u);
    _tcState.person = _tcState.person === id ? null : id;
    _tcState.open.clear();
    tcRenderByUser();
    tcRenderItems();
  }));
}

// ---------- списък + „👥 N" разгъване ----------

function tcRenderItems() {
  const data = _tcState.data;
  const all = (data && data.items) || [];
  const items = all.filter((it) => tcVisible(it) && (!_tcState.person || it.user_id === _tcState.person));
  document.getElementById('tcItemsTitle').innerHTML = 'Готови задачи (' + items.length + ')' + tcFilterChips();

  let html = '<table class="admin-table tr-table"><thead><tr><th>Кога</th><th>Човек</th><th>Отдел</th><th>Задача</th><th title="Кой още е цъкнал „✓ Готово&quot; по същата задача">👥</th></tr></thead><tbody>';
  items.forEach((it) => {
    const idx = all.indexOf(it);
    const others = it.others || [];
    const open = _tcState.open.has(idx);
    html += '<tr><td>' + tcFmtWhen(it.occurred_at) + '</td><td>' + esc(it.name) + '</td>' +
      '<td>' + esc(it.department) + '</td>' +
      '<td>' + (it.url ? '<a href="' + esc(it.url) + '" target="_blank">' + esc(it.title || '') + ' ↗</a>' : esc(it.title || '')) + '</td>' +
      '<td>' + (others.length
        ? '<button class="tc-cnt' + (open ? ' open' : '') + '" data-i="' + idx + '" title="Кой още е работил по задачата">👥 ' + others.length + '</button>'
        : '<span class="tr-dim">—</span>') + '</td></tr>';
    if (open) {
      const mineTs = new Date(it.occurred_at).getTime();
      const everyone = others.concat([{ user_id: it.user_id, name: it.name, position: it.position, department: it.department, occurred_at: it.occurred_at, me: true }])
        .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
      html += '<tr class="tc-sub"><td colspan="5"><div class="tc-sublist">' + everyone.map((p) => {
        const rel = p.me ? 'избраният' : (new Date(p.occurred_at).getTime() < mineTs ? 'преди' : 'след');
        return '<div class="tc-subrow"><span class="tc-when">' + tcFmtWhen(p.occurred_at) + ' · ' + rel + '</span>' +
          '<span class="tc-chip' + (p.me ? ' me' : '') + '">' + esc(p.name) + ' <small>' + esc(p.position) + ' · ' + esc(p.department) + '</small></span></div>';
      }).join('') + '</div></td></tr>';
    }
  });
  html += '</tbody></table>';
  document.getElementById('tcItems').innerHTML = items.length
    ? html
    : '<div class="tr-empty">Няма отбелязани задачи за периода.</div>';

  document.querySelectorAll('.tc-cnt').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.i);
    if (_tcState.open.has(i)) _tcState.open.delete(i); else _tcState.open.add(i);
    tcRenderItems();
  }));
  document.querySelectorAll('.tc-clear-filter')
    .forEach((a) => a.addEventListener('click', (ev) => {
      ev.preventDefault(); _tcState.person = null; tcRenderByUser(); tcRenderItems();
    }));
  document.querySelectorAll('.tc-clear-dept')
    .forEach((a) => a.addEventListener('click', (ev) => {
      ev.preventDefault(); _tcState.dept = null; tcRenderAll();
    }));
}

// ---------- ⚙ Настройки (само пълен админ; сървърът също го пази) ----------

async function tcApi(method, url, body) {
  const r = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Грешка');
  return data;
}

function tcCloseSettings() {
  document.getElementById('tcModal').classList.remove('on');
}

async function tcOpenSettings() {
  const modal = document.getElementById('tcModal');
  const body = document.getElementById('tcModalBody');
  modal.classList.add('on');
  body.innerHTML = '<div class="tr-empty">Зареждам…</div>';
  let s;
  try { s = await tcApi('GET', '/api/task-completions/settings'); } catch (e) {
    body.innerHTML = '<div class="tr-empty">' + esc(e.message) + '</div>';
    return;
  }
  const deptOpts = (cur) => '<option value=""' + (!s.departments.includes(cur) ? ' selected' : '') + '>(без отдел)</option>' +
    s.departments.map((d) => '<option' + (cur === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('');
  const posOpts = (cur) => '<option value="">(без позиция)</option>' +
    s.positions.map((p) => '<option value="' + p.id + '"' + (cur === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');

  body.innerHTML =
    '<div class="tc-modal__head"><h3>⚙ Настройки на „Готови задачи"</h3><button class="tc-modal__x" id="tcModalX" title="Затвори">✕</button></div>' +
    '<p class="tr-dim">Важи само за тази страница. Промените се пазят веднага.</p>' +
    '<h4>Позиции → отдел</h4>' +
    '<table class="admin-table tr-table"><thead><tr><th>Позиция</th><th>Отдел в отчета</th></tr></thead><tbody>' +
    s.positions.map((p) => '<tr><td>' + esc(p.name) + '</td><td><select class="tc-sel" data-pos="' + p.id + '">' + deptOpts(p.department) + '</select></td></tr>').join('') +
    '</tbody></table>' +
    '<h4>Хора</h4>' +
    '<p class="tr-dim">Позицията е същата като в Настройки → Екип и роли — смяната тук я сменя и там.</p>' +
    '<table class="admin-table tr-table"><thead><tr><th>Човек</th><th>Позиция</th><th>Отдел</th><th>Отметки</th><th>В отчета</th></tr></thead><tbody>' +
    s.people.map((p) => '<tr' + (p.active ? '' : ' class="tc-inactive"') + '><td>' + esc(p.name) + (p.active ? '' : ' <span class="tr-dim">(неактивен)</span>') + '</td>' +
      '<td><select class="tc-sel" data-person="' + p.user_id + '">' + posOpts(p.position_id) + '</select></td>' +
      '<td class="tr-dim">' + esc(p.department) + '</td><td>' + p.total + '</td>' +
      '<td><input type="checkbox" data-show="' + p.user_id + '"' + (p.hidden ? '' : ' checked') + '></td></tr>').join('') +
    '</tbody></table>';

  document.getElementById('tcModalX').addEventListener('click', tcCloseSettings);
  const saved = async (fn) => {
    try {
      await fn();
      if (typeof showToast === 'function') showToast('Запазено', 'success', 1500);
      await tcLoad();
      await tcOpenSettings(); // отделът на хората зависи от позициите — презареждаме
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message, 'error', 4000);
    }
  };
  body.querySelectorAll('[data-pos]').forEach((sel) => sel.addEventListener('change', () => saved(() =>
    tcApi('PUT', '/api/task-completions/settings/positions/' + sel.dataset.pos, { department: sel.value }))));
  body.querySelectorAll('[data-person]').forEach((sel) => sel.addEventListener('change', () => saved(() =>
    tcApi('PUT', '/api/task-completions/settings/people/' + sel.dataset.person, { position_id: sel.value || null }))));
  body.querySelectorAll('[data-show]').forEach((cb) => cb.addEventListener('change', () => saved(() =>
    tcApi('PUT', '/api/task-completions/settings/people/' + cb.dataset.show, { hidden: !cb.checked }))));
}
