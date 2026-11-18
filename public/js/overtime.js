// ==================== OVERTIME ====================
// Вариант 1 от /demo/overtime.html (избран от Венци, 02.11.2026): форма + сметка на
// живо + списък. Всеки вижда само своите записи; админ вижда всички хора (филтърът
// е на сървъра — /api/overtime). Без одобрение, без редакция — само изтриване на
// свой запис. „Добавено на" = кога е въведен записът. За всеки запис човекът избира
// плащане или почивка. Сметката: public/js/overtime-calc.js (обща със сървъра).
// 02.11.2026 (2): #/overtime е „Моят overtime" за ВСЕКИ (и за админ). Всички служители
// се виждат само в #/overtime/admin — бутон „🔒 Админ" само за role = admin. Там са и
// бележките на админа (напр. „дойде 3 ч по-късно след overtime-а").
// 19.11.2026: „➖ Минус време" — админът/пуснатият записва на човек закъснение, тръгване
// по-рано, отсъствие или ръчно часове (сметката: OvertimeCalc.deduction). Човекът вижда
// своето в „Моят overtime"; остатък = overtime − минус. Записва и трие само админ.

let _otState = { range: 'month', user: 0, data: null, clients: null, adminView: false };

function otFmtH(m) {
  m = Number(m) || 0;
  if (!m) return '0 ч';
  const h = Math.floor(m / 60), mm = m % 60;
  return (h ? h + ' ч' : '') + (h && mm ? ' ' : '') + (mm ? mm + ' мин' : '');
}
function otDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function otFmtDate(s) {
  const [y, m, d] = String(s).split('-');
  return d + '.' + m + '.' + y;
}
function otRange(kind) {
  const now = new Date();
  if (kind === 'month') return { from: otDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), to: otDateStr(now) };
  if (kind === 'lastmonth') return { from: otDateStr(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: otDateStr(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (kind === 'year') return { from: now.getFullYear() + '-01-01', to: otDateStr(now) };
  // „📅 Период" — избран на ръка (Венци, 09.11.2026)
  if (kind === 'custom') return { from: _otState.cfrom || '', to: _otState.cto || '' };
  return { from: '', to: '' }; // всичко
}
const OT_KINDS = ['Снимки', 'Пътуване', 'Събитие', 'Монтаж', 'Техника / подготовка', 'Друго'];
const OT_COMP = { pay: '💰 Плащане', rest: '🏖 Почивка' };

// Пълен админ ИЛИ поименно пуснат от Настройки → ⏱ Overtime достъп (09.11.2026) — решава сървърът.
let _otManager = null;
async function otCheckManager() {
  try {
    const r = await fetch('/api/overtime/me');
    _otManager = r.ok ? !!(await r.json()).manager : false;
  } catch (e) { _otManager = false; }
  return _otManager;
}
function otIsAdmin() { return !!_otManager; }

async function renderOvertime(el, sub) {
  el.className = 'flush-top';
  const today = otDateStr(new Date());
  await otCheckManager(); // всеки път наново — достъпът може да е даден/отнет междувременно
  if (sub === 'admin' && !otIsAdmin()) { location.hash = '#/overtime'; return; }
  const adminView = sub === 'admin';
  if (adminView !== _otState.adminView) { _otState.adminView = adminView; _otState.user = 0; }
  const people = ((typeof allUsers !== 'undefined' && allUsers) || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'bg'));
  el.innerHTML = `
    <div class="home-content-box home-content-box--wide tr-page ot-page">
      <div class="tr-head">
        <h2 id="otTitle">${adminView ? '🔒 Overtime — всички служители' : '⏱ Моят overtime'}</h2>
        ${adminView ? '<a class="tr-csv ot-switch" href="#/overtime">← Моят overtime</a>'
          : (otIsAdmin() ? '<a class="tr-csv ot-switch" href="#/overtime/admin" title="Записите на всички служители + бележки">🔒 Админ</a>' : '')}
      </div>
      <div class="ot-form-grid"${adminView ? ' style="display:none"' : ''}>
        <div class="tr-box">
          <h3>+ Нов overtime</h3>
          <label class="ot-f">Дата<input type="date" id="otDate" value="${today}" max="${today}"></label>
          <div class="ot-row">
            <label class="ot-f">От<input type="time" id="otFrom" value="19:00"></label>
            <label class="ot-f">До<input type="time" id="otTo" value="21:00"></label>
          </div>
          <div class="ot-row">
            <label class="ot-f">За кого (клиент)<input type="text" id="otClient" list="otClients" placeholder="напр. име на клиента" maxlength="200"><datalist id="otClients"></datalist></label>
            <label class="ot-f">Какво<select id="otKind">${OT_KINDS.map((k) => '<option>' + esc(k) + '</option>').join('')}</select></label>
          </div>
          <div class="ot-f">Как да се компенсира
            <div class="ot-comp">
              <label><input type="radio" name="otComp" value="pay"> 💰 Плащане</label>
              <label><input type="radio" name="otComp" value="rest"> 🏖 Почивка</label>
            </div>
          </div>
          <label class="ot-f">Подробности (какво точно, къде, с кого)<textarea id="otNote" maxlength="4000" placeholder="напр. Вечерно събитие — репортаж + 3 интервюта"></textarea></label>
          <button class="tr-apply" id="otSave">Запиши</button>
          <span class="tr-dim" style="margin-left:8px">Записът не може да се редактира — ако объркаш, изтрий го и го въведи пак.</span>
        </div>
        <div>
          <div id="otCalc"></div>
          <p class="tr-dim ot-rules">Работно време: делник 10:00–19:00 (8 ч + 1 ч обяд) — това време не се брои. В събота, неделя и официален празник се брои целият интервал. Ако „До" е по-рано от „От" (напр. 20:00 → 02:00), значи си работил след полунощ.</p>
        </div>
      </div>
      <div class="tr-head" style="margin-top:4px">
        <h3 style="margin:0;font-size:15px" id="otListTitle">Записи</h3>
        <div class="tr-presets">
          <button class="cr-tab tr-preset" data-r="month">Този месец</button>
          <button class="cr-tab tr-preset" data-r="lastmonth">Миналия месец</button>
          <button class="cr-tab tr-preset" data-r="year">Тази година</button>
          <button class="cr-tab tr-preset" data-r="all">Всичко</button>
          <button class="cr-tab tr-preset" data-r="custom">📅 Период</button>
        </div>
        <div class="tr-range" id="otCustom" style="display:none;margin-left:0">
          <input type="date" id="otCFrom">
          <span>—</span>
          <input type="date" id="otCTo">
          <button class="tr-apply" id="otCApply">Покажи</button>
        </div>
        <select class="tc-sel" id="otUser" style="display:none;margin-left:auto"></select>
      </div>
      <div class="tr-tiles" id="otTiles"></div>
      <div class="tr-box" id="otPeopleBox" style="display:none"><h3>По човек</h3><div id="otPeople"></div></div>
      <div class="tr-box"><div id="otList"><div class="tr-empty">Зареждане…</div></div></div>
      <div class="tr-box" id="otMinusBox"${adminView ? '' : ' style="display:none"'}>
        <h3>➖ Минус време${adminView ? '' : ' <span class="tr-dim" style="font-weight:400">— записано от админ</span>'}</h3>
        ${adminView ? `<div class="ot-form-grid">
          <div>
            <div class="ot-row">
              <label class="ot-f">Човек<select id="otmUser"><option value="">— избери —</option>${people.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('')}</select></label>
              <label class="ot-f" style="flex:0 0 160px">Дата<input type="date" id="otmDate" value="${today}" max="${today}"></label>
            </div>
            <div class="ot-row">
              <label class="ot-f">Какво<select id="otmKind">
                <option value="late">Закъснение</option>
                <option value="early">Тръгнал по-рано</option>
                <option value="absence">Отсъствие (от–до)</option>
                <option value="other">Друго (ръчно часове)</option>
              </select></label>
              <label class="ot-f" data-mk="late">Дошъл в<input type="time" id="otmAtLate" value="11:00"></label>
              <label class="ot-f" data-mk="early" style="display:none">Тръгнал в<input type="time" id="otmAtEarly" value="17:00"></label>
              <label class="ot-f" data-mk="absence" style="display:none">От<input type="time" id="otmFrom" value="13:00"></label>
              <label class="ot-f" data-mk="absence" style="display:none">До<input type="time" id="otmTo" value="15:00"></label>
              <label class="ot-f" data-mk="other" style="display:none">Часове<input type="number" id="otmH" min="0" max="24" value="1"></label>
              <label class="ot-f" data-mk="other" style="display:none">Минути<input type="number" id="otmM" min="0" max="59" step="5" value="0"></label>
            </div>
            <label class="ot-f">Информация (по желание)<textarea id="otmNote" maxlength="4000" placeholder="напр. Дойде в 13:00 след overtime-а предния ден, без да го е отбелязал"></textarea></label>
            <button class="tr-apply" id="otmSave">Запиши минус</button>
          </div>
          <div><div id="otmCalc"></div><p class="tr-dim ot-rules">Минутите се смятат спрямо работното време 10:00–19:00. Отсъствие се брои само в работното време и е най-много 8 ч на ден. За почивен ден ползвай „Друго“. Човекът вижда записа при себе си, а остатъкът (overtime − минус) се смята автоматично.</p></div>
        </div>` : ''}
        <div id="otMinusList"></div>
      </div>
      ${adminView ? `<div class="tr-box ot-notes">
        <h3>📝 Бележки на админа <span class="tr-dim" style="font-weight:400">— виждат се само от админи</span></h3>
        <div class="ot-row">
          <label class="ot-f" style="flex:0 0 160px">Дата<input type="date" id="otnDate" value="${today}"></label>
          <label class="ot-f">За кого<select id="otnUser"><option value="">— общо —</option>${people.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('')}</select></label>
        </div>
        <label class="ot-f">Бележка<textarea id="otnText" maxlength="4000" placeholder="напр. Дойде в 13:00 вместо 10:00 след overtime-а от предния ден — не е отбелязал по-късното идване"></textarea></label>
        <button class="tr-apply" id="otnSave">Запиши бележка</button>
        <div id="otnList" style="margin-top:12px"></div>
      </div>` : ''}
    </div>`;

  const upd = () => otRenderCalc();
  ['otDate', 'otFrom', 'otTo'].forEach((id) => document.getElementById(id).addEventListener('input', upd));
  upd();
  document.getElementById('otSave').addEventListener('click', otSave);
  if (adminView) {
    document.getElementById('otnSave').addEventListener('click', otSaveNote);
    document.getElementById('otmSave').addEventListener('click', otSaveMinus);
    ['otmDate', 'otmKind', 'otmAtLate', 'otmAtEarly', 'otmFrom', 'otmTo', 'otmH', 'otmM'].forEach((id) =>
      document.getElementById(id).addEventListener('input', otRenderMinusCalc));
    otRenderMinusCalc();
  }
  el.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.r === 'custom') {
      // първо показва полетата (с текущия период вътре); зарежда чак с „Покажи"
      const cur = otRange(_otState.range);
      if (!_otState.cfrom) { _otState.cfrom = cur.from || otRange('month').from; _otState.cto = cur.to || otRange('month').to; }
    }
    _otState.range = b.dataset.r; otLoad();
  }));
  document.getElementById('otCApply').addEventListener('click', () => {
    const f = document.getElementById('otCFrom').value, t = document.getElementById('otCTo').value;
    if (!f || !t) { showToast('Избери начална и крайна дата.', 'error'); return; }
    if (f > t) { showToast('Началната дата е след крайната.', 'error'); return; }
    _otState.cfrom = f; _otState.cto = t; _otState.range = 'custom'; otLoad();
  });
  document.getElementById('otUser').addEventListener('change', (e) => { _otState.user = Number(e.target.value) || 0; otLoad(); });
  otLoadClients();
  await otLoad();
}

function otRenderCalc() {
  const box = document.getElementById('otCalc');
  if (!box || !window.OvertimeCalc) return;
  const r = OvertimeCalc.calc(document.getElementById('otDate').value, document.getElementById('otFrom').value, document.getElementById('otTo').value);
  if (r.error) { box.innerHTML = '<div class="ot-calc ot-calc--zero"><div class="tr-dim">' + esc(r.error) + '</div></div>'; return; }
  const h = OvertimeCalc.hhmm;
  const li = r.parts.map((p) => '<li>' + h(p.from) + '–' + h(p.to) + ' · ' + otFmtH(p.to - p.from) + ' — ' +
    (p.ot ? '<b class="ot-amber">overtime</b>, ' : 'не се брои, ') + esc(p.label) + '</li>').join('');
  box.innerHTML = '<div class="ot-calc' + (r.ot ? '' : ' ot-calc--zero') + '"><div class="tr-dim">Overtime</div><div class="ot-calc__big">' + otFmtH(r.ot) + '</div>' +
    '<div class="tr-dim">Общо ' + otFmtH(r.total) + (r.nextDay ? ' · минава през полунощ' : '') + '</div><ul>' + li + '</ul>' +
    (r.parts.some((p) => !p.ot) ? '<div class="ot-warn">Част от времето е в работно време (10:00–19:00) и не се брои.</div>' : '') + '</div>';
}

async function otLoadClients() {
  // Подсказки за полето „За кого" — клиентите от таблото. Ако не стане, полето си е свободен текст.
  try {
    if (!_otState.clients) {
      const r = await fetch('/api/clients');
      if (!r.ok) return;
      const d = await r.json();
      _otState.clients = (d.clients || []).map((c) => c.name).filter(Boolean).sort((a, b) => a.localeCompare(b, 'bg'));
    }
    const dl = document.getElementById('otClients');
    if (dl) dl.innerHTML = _otState.clients.concat(['Вътрешно (The Pact)']).map((n) => '<option value="' + esc(n) + '">').join('');
  } catch (e) { /* без подсказки */ }
}

async function otLoad() {
  const { from, to } = otRange(_otState.range);
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (_otState.adminView) { q.set('scope', 'all'); if (_otState.user) q.set('user', _otState.user); }
  document.querySelectorAll('.ot-page [data-r]').forEach((b) => b.classList.toggle('active', b.dataset.r === _otState.range));
  const cbox = document.getElementById('otCustom');
  if (cbox) {
    cbox.style.display = _otState.range === 'custom' ? '' : 'none';
    document.getElementById('otCFrom').value = _otState.cfrom || '';
    document.getElementById('otCTo').value = _otState.cto || '';
  }
  const r = await fetch('/api/overtime?' + q.toString());
  const list = document.getElementById('otList');
  if (!r.ok) { if (list) list.innerHTML = '<div class="tr-empty">Грешка при зареждане.</div>'; return; }
  _otState.data = await r.json();
  otRenderAll();
  if (_otState.adminView) otLoadNotes();
}

async function otLoadNotes() {
  const box = document.getElementById('otnList');
  if (!box) return;
  // бележките следват периода горе (Венци, 09.11.2026)
  const { from, to } = otRange(_otState.range);
  const q = new URLSearchParams();
  if (_otState.user) q.set('user', _otState.user);
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const r = await fetch('/api/overtime/notes?' + q.toString());
  if (!r.ok) { box.innerHTML = '<div class="tr-empty">Грешка при зареждане на бележките.</div>'; return; }
  const notes = (await r.json()).notes || [];
  const sel = document.getElementById('otnUser');
  if (sel && _otState.user) sel.value = String(_otState.user);
  if (!notes.length) { box.innerHTML = '<div class="tr-empty">Няма бележки' + (_otState.user ? ' за този човек' : '') + ' за този период.</div>'; return; }
  box.innerHTML = notes.map((n) => '<div class="ot-note-item"><div class="ot-note-item__head"><b>' + otFmtDate(n.note_date) + '</b>' +
    '<span class="ot-tag">' + esc(n.about_name || 'общо') + '</span>' +
    '<span class="tr-dim">записал: ' + esc(n.author_name || '—') + ', ' + new Date(n.created_at).toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' }) + '</span>' +
    '<button class="ot-del" data-ndel="' + n.id + '">Изтрий</button></div><div class="ot-note">' + esc(n.text) + '</div></div>').join('');
  box.querySelectorAll('[data-ndel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Да изтрия ли бележката?')) return;
    const x = await fetch('/api/overtime/notes/' + b.dataset.ndel, { method: 'DELETE' });
    if (!x.ok) { showToast('Грешка при триене', 'error'); return; }
    otLoadNotes();
  }));
}

async function otSaveNote() {
  const btn = document.getElementById('otnSave');
  const body = { date: document.getElementById('otnDate').value, about_user_id: Number(document.getElementById('otnUser').value) || null, text: document.getElementById('otnText').value.trim() };
  if (!body.text) { showToast('Напиши бележката.', 'error'); return; }
  btn.disabled = true;
  try {
    const r = await fetch('/api/overtime/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(d.error || 'Грешка при запис', 'error'); return; }
    document.getElementById('otnText').value = '';
    showToast('Бележката е записана', 'success');
    otLoadNotes();
  } finally { btn.disabled = false; }
}

function otRenderAll() {
  const d = _otState.data; if (!d) return;
  const admin = d.scope === 'all'; // админ изглед — сървърът връща 'all' само на админ
  document.getElementById('otListTitle').textContent = admin ? (_otState.user ? 'Записи на човека' : 'Записи на всички') : 'Моите записи';

  const sel = document.getElementById('otUser');
  if (admin) {
    sel.style.display = '';
    sel.innerHTML = '<option value="0">Всички хора</option>' + (d.people || []).map((p) =>
      '<option value="' + p.id + '"' + (p.id === _otState.user ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  }

  const rows = d.entries || [];
  const ded = d.deductions || [];
  const sum = (list) => list.reduce((s, e) => s + (Number(e.ot_minutes) || 0), 0);
  const dsum = (list) => list.reduce((s, e) => s + (Number(e.minutes) || 0), 0);
  const net = sum(rows) - dsum(ded);
  document.getElementById('otTiles').innerHTML = [
    [otFmtH(sum(rows)), 'overtime общо'],
    [otFmtH(sum(rows.filter((e) => e.comp === 'pay'))), '💰 за плащане'],
    [otFmtH(sum(rows.filter((e) => e.comp === 'rest'))), '🏖 за почивка'],
    [(dsum(ded) ? '− ' : '') + otFmtH(dsum(ded)), '➖ минус време'],
    ['<span class="' + (net < 0 ? 'ot-neg' : '') + '">' + otFmtNet(net) + '</span>', '= остатък (overtime − минус)'],
    [rows.length, 'записа']
  ].map((t) => '<div class="tr-tile"><div class="tr-tile__num">' + t[0] + '</div><div class="tr-tile__label">' + t[1] + '</div></div>').join('');
  otRenderMinus(admin);

  // Админ, „Всички хора": обобщение по човек — клик филтрира.
  const pbox = document.getElementById('otPeopleBox');
  if (admin && !_otState.user && (rows.length || ded.length)) {
    const by = {};
    const slot = (e) => (by[e.user_id] = by[e.user_id] || { id: e.user_id, name: e.name, list: [], minus: [] });
    rows.forEach((e) => slot(e).list.push(e));
    ded.forEach((e) => slot(e).minus.push(e));
    const ppl = Object.values(by).sort((a, b) => (sum(b.list) - dsum(b.minus)) - (sum(a.list) - dsum(a.minus)));
    pbox.style.display = '';
    document.getElementById('otPeople').innerHTML = '<table class="tr-table ot-table"><tr><th>Човек</th><th class="ot-num">Записи</th><th class="ot-num">Overtime</th><th class="ot-num">💰 Плащане</th><th class="ot-num">🏖 Почивка</th><th class="ot-num">➖ Минус</th><th class="ot-num">= Остатък</th></tr>' +
      ppl.map((p) => { const n = sum(p.list) - dsum(p.minus); return '<tr class="tc-user-row" data-u="' + p.id + '"><td>' + esc(p.name) + '</td><td class="ot-num">' + p.list.length + '</td><td class="ot-num">' + otFmtH(sum(p.list)) + '</td><td class="ot-num">' +
        otFmtH(sum(p.list.filter((e) => e.comp === 'pay'))) + '</td><td class="ot-num">' + otFmtH(sum(p.list.filter((e) => e.comp === 'rest'))) + '</td>' +
        '<td class="ot-num">' + (p.minus.length ? '− ' + otFmtH(dsum(p.minus)) : '—') + '</td><td class="ot-num"><b class="' + (n < 0 ? 'ot-neg' : '') + '">' + otFmtNet(n) + '</b></td></tr>'; }).join('') + '</table>';
    pbox.querySelectorAll('[data-u]').forEach((tr) => tr.addEventListener('click', () => { _otState.user = Number(tr.dataset.u); otLoad(); }));
  } else pbox.style.display = 'none';

  const list = document.getElementById('otList');
  if (!rows.length) { list.innerHTML = '<div class="tr-empty">Няма записи за този период.</div>'; return; }
  const showName = admin && !_otState.user;
  const me = currentUser && currentUser.id;
  list.innerHTML = '<table class="tr-table ot-table"><tr><th>Дата</th>' + (showName ? '<th>Човек</th>' : '') +
    '<th>От–до</th><th>За кого / какво</th><th class="ot-num">Overtime</th><th>Компенсация</th><th>Добавено на</th><th></th></tr>' +
    rows.map((e) => {
      const off = window.OvertimeCalc ? OvertimeCalc.dayOff(e.work_date) : null;
      const added = new Date(e.created_at).toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const canDel = admin || e.user_id === me;
      return '<tr><td class="ot-nowrap">' + otFmtDate(e.work_date) + (off ? '<br><span class="ot-off">' + esc(off) + '</span>' : '') + '</td>' +
        (showName ? '<td>' + esc(e.name) + '</td>' : '') +
        '<td class="ot-nowrap">' + esc(e.time_from) + '–' + esc(e.time_to) + (e.time_to < e.time_from ? ' <span class="tr-dim">(+1 ден)</span>' : '') + '</td>' +
        '<td><b>' + esc(e.client) + '</b> <span class="ot-tag">' + esc(e.kind) + '</span><div class="ot-note">' + esc(e.note) + '</div></td>' +
        '<td class="ot-num"><b>' + otFmtH(e.ot_minutes) + '</b></td><td class="ot-nowrap">' + (OT_COMP[e.comp] || '') + '</td>' +
        '<td class="ot-nowrap tr-dim">' + added + '</td>' +
        '<td>' + (canDel ? '<button class="ot-del" data-del="' + e.id + '" title="Изтрий записа">Изтрий</button>' : '') + '</td></tr>';
    }).join('') + '</table>';
  list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => otDelete(Number(b.dataset.del))));
}

function otFmtNet(m) { return (m < 0 ? '− ' : '') + otFmtH(Math.abs(m)); }

const OT_DED_KINDS = { late: 'Закъснение', early: 'Тръгнал по-рано', absence: 'Отсъствие', other: 'Друго' };

function otMinusInput() {
  const v = (id) => document.getElementById(id).value;
  const kind = v('otmKind');
  return {
    user_id: Number(v('otmUser')) || null, date: v('otmDate'), kind,
    at: kind === 'late' ? v('otmAtLate') : (kind === 'early' ? v('otmAtEarly') : ''),
    from: v('otmFrom'), to: v('otmTo'),
    minutes: (Number(v('otmH')) || 0) * 60 + (Number(v('otmM')) || 0),
    note: v('otmNote').trim()
  };
}

function otRenderMinusCalc() {
  const box = document.getElementById('otmCalc');
  if (!box || !window.OvertimeCalc) return;
  const inp = otMinusInput();
  document.querySelectorAll('[data-mk]').forEach((l) => { l.style.display = l.dataset.mk === inp.kind ? '' : 'none'; });
  const r = OvertimeCalc.deduction(inp);
  box.innerHTML = r.error
    ? '<div class="ot-calc ot-calc--zero"><div class="tr-dim">' + esc(r.error) + '</div></div>'
    : '<div class="ot-calc ot-calc--minus"><div class="tr-dim">Минус</div><div class="ot-calc__big">− ' + otFmtH(r.minutes) + '</div><div class="tr-dim">' + esc(r.label) + '</div></div>';
}

async function otSaveMinus() {
  const btn = document.getElementById('otmSave');
  const body = otMinusInput();
  if (!body.user_id) { showToast('Избери човек.', 'error'); return; }
  const r0 = OvertimeCalc.deduction(body);
  if (r0.error) { showToast(r0.error, 'error', 5000); return; }
  btn.disabled = true;
  try {
    const r = await fetch('/api/overtime/deductions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(d.error || 'Грешка при запис', 'error', 5000); return; }
    showToast('Записано: − ' + otFmtH(d.minutes), 'success');
    document.getElementById('otmNote').value = '';
    const { from } = otRange(_otState.range);
    if (from && body.date < from) _otState.range = body.date.slice(0, 4) === from.slice(0, 4) ? 'year' : 'all';
    await otLoad();
  } finally { btn.disabled = false; }
}

function otRenderMinus(admin) {
  const box = document.getElementById('otMinusBox');
  const host = document.getElementById('otMinusList');
  if (!box || !host) return;
  const ded = (_otState.data && _otState.data.deductions) || [];
  if (!admin) box.style.display = ded.length ? '' : 'none';
  if (!ded.length) { host.innerHTML = '<div class="tr-empty">Няма минус време за този период.</div>'; return; }
  const showName = admin && !_otState.user;
  host.innerHTML = '<table class="tr-table ot-table" style="margin-top:8px"><tr><th>Дата</th>' + (showName ? '<th>Човек</th>' : '') +
    '<th>Какво</th><th class="ot-num">Минус</th><th>Записал</th>' + (admin ? '<th></th>' : '') + '</tr>' +
    ded.map((e) => '<tr><td class="ot-nowrap">' + otFmtDate(e.work_date) + '</td>' + (showName ? '<td>' + esc(e.name) + '</td>' : '') +
      '<td><b>' + esc(OT_DED_KINDS[e.kind] || e.kind) + '</b>' + (e.label && e.kind !== 'other' ? ' <span class="tr-dim">— ' + esc(e.label) + '</span>' : '') +
        (e.note ? '<div class="ot-note">' + esc(e.note) + '</div>' : '') + '</td>' +
      '<td class="ot-num"><b class="ot-neg">− ' + otFmtH(e.minutes) + '</b></td>' +
      '<td class="ot-nowrap tr-dim">' + esc(e.created_by_name || '—') + ', ' + new Date(e.created_at).toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' }) + '</td>' +
      (admin ? '<td><button class="ot-del" data-mdel="' + Number(e.id) + '">Изтрий</button></td>' : '') + '</tr>').join('') + '</table>';
  host.querySelectorAll('[data-mdel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Да изтрия ли записа за минус време?')) return;
    const x = await fetch('/api/overtime/deductions/' + b.dataset.mdel, { method: 'DELETE' });
    if (!x.ok) { showToast('Грешка при триене', 'error'); return; }
    showToast('Изтрито', 'success');
    otLoad();
  }));
}

async function otSave() {
  const btn = document.getElementById('otSave');
  const comp = document.querySelector('input[name="otComp"]:checked');
  const body = {
    date: document.getElementById('otDate').value,
    from: document.getElementById('otFrom').value,
    to: document.getElementById('otTo').value,
    client: document.getElementById('otClient').value.trim(),
    kind: document.getElementById('otKind').value,
    note: document.getElementById('otNote').value.trim(),
    comp: comp ? comp.value : ''
  };
  btn.disabled = true;
  try {
    const r = await fetch('/api/overtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(d.error || 'Грешка при запис', 'error', 5000); return; }
    showToast('Записано: ' + otFmtH(d.ot_minutes) + ' overtime', 'success');
    document.getElementById('otNote').value = '';
    document.getElementById('otClient').value = '';
    document.querySelectorAll('input[name="otComp"]').forEach((x) => { x.checked = false; });
    // да се вижда новият запис, дори ако е от минал месец
    const { from } = otRange(_otState.range);
    if (from && body.date < from) _otState.range = body.date.slice(0, 4) === from.slice(0, 4) ? 'year' : 'all';
    await otLoad();
  } finally { btn.disabled = false; }
}

async function otDelete(id) {
  const e = ((_otState.data && _otState.data.entries) || []).find((x) => Number(x.id) === id);
  if (!confirm('Да изтрия ли записа' + (e ? ' от ' + otFmtDate(e.work_date) + ' (' + otFmtH(e.ot_minutes) + ')' : '') + '?')) return;
  const r = await fetch('/api/overtime/' + id, { method: 'DELETE' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { showToast(d.error || 'Грешка при триене', 'error'); return; }
  showToast('Изтрито', 'success');
  await otLoad();
}
