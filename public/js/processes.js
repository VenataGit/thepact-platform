// ==================== ПРОЦЕСИ (#/processes) ====================
// Венци избра вариант A от /demo/processes.html (04.11.2026, задача „Процеси"):
//  • отляво меню по отдели (сгъваемо, с брояч и търсене) + „Начало", „Кой за какво", „Чеклисти";
//  • процесът е отгоре надолу: всяка стъпка = блок с един ред + кой я прави, „ℹ️ Повече" за детайлите;
//  • редактират само admin и mini_admin (сървърът го проверява — routes/processes.js);
//  • всяко запазване е нова версия, старите могат да се върнат;
//  • „Кой за какво отговаря" и „Чеклисти по роля" не се пазят никъде — сглобяват се от стъпките,
//    затова се обновяват сами, щом някой смени „кой я прави" на стъпка;
//  • цветовете, ролите и отделите са в „Настройки" (#/processes/settings).
// Адреси: #/processes · #/processes/:id · #/processes/:id/edit · #/processes/new · #/processes/roles ·
//         #/processes/checklists[/:role] · #/processes/settings

const PR = {
  data: null, config: null, canEdit: false, q: '',
  openDepts: new Set(JSON.parse(localStorage.getItem('pr_open_depts') || '[]')),
  open: new Set(), E: null, clOff: {}, rolesView: localStorage.getItem('pr_roles_view') || 'cards',
  clMore: false, cfgDraft: null, orderDraft: null,
};

async function prLoad(force) {
  if (PR.data && !force) return true;
  try {
    const r = await fetch('/api/processes');
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    const j = await r.json();
    PR.data = j.processes || []; PR.config = j.config || { roles: [], depts: [] }; PR.canEdit = !!j.canEdit;
    return true;
  } catch (e) {
    if (typeof showToast === 'function') showToast('Процесите не се заредиха: ' + e.message, 'error', 5000);
    return false;
  }
}

// ---------- помощни ----------
const prRole = (k) => (PR.config.roles || []).find((r) => r.key === k) || { key: k, name: k || '—', color: '#9aa7ad' };
const prDept = (k) => (PR.config.depts || []).find((d) => d.key === k) || { key: k, name: k || '—', icon: '📁', color: '#9aa7ad' };
const prProc = (id) => (PR.data || []).find((p) => p.id === id);
function prInk(hex) { // тъмен или светъл текст върху цвета
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#111';
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#111' : '#fff';
}
function prPill(k) { const r = prRole(k); return `<span class="pr-who" style="background:${esc(r.color)};color:${prInk(r.color)}">${esc(r.name)}</span>`; }
function prText(s) { // текст с нови редове + кликаеми линкове
  return esc(s || '').replace(/https?:\/\/[^\s<]+/g, (u) => { const ok = safeUrl(u.replace(/&amp;/g, '&')); return ok ? `<a href="${u}" target="_blank" rel="noopener">${u}</a>` : u; });
}
function prDate(s) { if (!s) return ''; const d = new Date(s); return d.toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function prByDept() {
  return (PR.config.depts || []).map((d) => ({ d, list: PR.data.filter((p) => p.dept === d.key) }))
    .concat([{ d: { key: '__none', name: 'Без отдел', icon: '📁', color: '#9aa7ad' }, list: PR.data.filter((p) => !(PR.config.depts || []).some((d) => d.key === p.dept)) }])
    .filter((g) => g.d.key !== '__none' || g.list.length);
}
function prSaveOpen() { localStorage.setItem('pr_open_depts', JSON.stringify([...PR.openDepts])); }

// ---------- вход ----------
async function renderProcesses(el, a, b) {
  el.className = 'flush-top full-width';
  setBreadcrumb([{ label: 'Процеси', href: '#/processes' }]);
  if (!PR.data) el.innerHTML = '<div class="pr-loading">Зареждам процесите…</div>';
  if (!(await prLoad())) { el.innerHTML = '<div class="pr-loading">Процесите не се заредиха. Опитай пак след малко.</div>'; return; }
  const id = parseInt(a, 10);
  if (PR.E && !(a === 'new' || (id && b === 'edit' && PR.E.id === id))) PR.E = null; // излязъл от редакцията
  if (a !== 'settings') { PR.cfgDraft = null; PR.orderDraft = null; }
  let main, sideKey = a || 'home';
  if (!a) main = prHome();
  else if (a === 'roles') main = prRolesView();
  else if (a === 'gaps') main = prGapsView();
  else if (a === 'checklists') { main = prChecklists(b); sideKey = 'checklists'; }
  else if (a === 'settings') main = PR.canEdit ? prSettings() : prNoAccess();
  else if (a === 'new') main = PR.canEdit ? prEditor(true) : prNoAccess();
  else if (id && prProc(id)) { main = b === 'edit' ? (PR.canEdit ? prEditor(false, id) : prNoAccess()) : prView(prProc(id)); sideKey = id; const p = prProc(id); if (!PR.openDepts.has(p.dept)) { PR.openDepts.add(p.dept); prSaveOpen(); } }
  else main = `<div class="pr-panel"><h2>Няма такъв процес</h2><p class="pr-dim">Може да е изтрит. <a href="#/processes">← Към началото</a></p></div>`;
  document.body.classList.toggle('pr-print-ready', a === 'checklists' && !!b);
  el.innerHTML = `<div class="pr-page"><aside class="pr-side" id="prSide">${prSide(sideKey)}</aside><main class="pr-main">${main}</main></div>`;
  if (!a) prLoadRecent();
  if (id && b !== 'edit' && prProc(id)) prLoadHistory(id);
}
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/processes/checklists/')) document.body.classList.remove('pr-print-ready'); });
const prNoAccess = () => `<div class="pr-panel"><h2>Нямаш права</h2><p class="pr-dim">Процесите се редактират само от админ и мини админ.</p></div>`;

// ---------- меню ----------
function prSide(active) {
  const q = PR.q.trim().toLowerCase();
  const match = (p) => !q || (p.name + ' ' + p.steps.map((s) => s.title).join(' ')).toLowerCase().includes(q);
  const groups = prByDept().map((g) => {
    const list = g.list.filter(match);
    if (q && !list.length) return '';
    const isOpen = !!q || PR.openDepts.has(g.d.key);
    return `<div class="pr-dept"><div class="pr-dhead" onclick="prToggleDept(${jsq(g.d.key)})"><span class="pr-car">${isOpen ? '▾' : '▸'}</span>
      <span class="pr-ico" style="background:${esc(g.d.color)}26">${esc(g.d.icon || '📁')}</span><span class="pr-dname">${esc(g.d.name)}</span><span class="pr-cnt">${list.length}</span></div>
      ${isOpen ? `<div class="pr-dlist">${list.map((p) => `<a href="#/processes/${p.id}" class="${active === p.id ? 'on' : ''}">${esc(p.name)}</a>`).join('') || '<span class="pr-dim pr-pad">няма процеси</span>'}</div>` : ''}</div>`;
  }).join('');
  return `<a class="pr-solo ${active === 'home' ? 'on' : ''}" href="#/processes">🏠 Начало</a>
    <input class="pr-search" id="prSearch" placeholder="🔎 Търси процес или стъпка…" value="${esc(PR.q)}" oninput="prSearch(this.value)">
    <div id="prSideList">${groups}</div>
    <div class="pr-sep"></div>
    <a class="pr-solo ${active === 'roles' ? 'on' : ''}" href="#/processes/roles">👥 Кой за какво отговаря</a>
    <a class="pr-solo ${active === 'checklists' ? 'on' : ''}" href="#/processes/checklists">☑️ Чеклисти по роля</a>
    <a class="pr-solo ${active === 'gaps' ? 'on' : ''}" href="#/processes/gaps">🚧 Дупки за оправяне <span class="pr-cnt">${prGaps().length}</span></a>
    ${PR.canEdit ? `<a class="pr-solo ${active === 'settings' ? 'on' : ''}" href="#/processes/settings">⚙️ Настройки</a>
    <a class="pr-solo pr-new ${active === 'new' ? 'on' : ''}" href="#/processes/new">＋ Нов процес</a>` : ''}`;
}
function prToggleDept(k) { PR.openDepts.has(k) ? PR.openDepts.delete(k) : PR.openDepts.add(k); prSaveOpen(); prRefreshSide(); }
function prSearch(v) { PR.q = v; prRefreshSide(); }
function prRefreshSide() { // пренарежда само списъка, за да не губи фокуса полето за търсене
  const side = document.getElementById('prSide'); if (!side) return;
  const tmp = document.createElement('div');
  const h = location.hash.replace('#/processes', '').split('/').filter(Boolean);
  tmp.innerHTML = prSide(!h[0] ? 'home' : (parseInt(h[0], 10) || h[0]));
  document.getElementById('prSideList').innerHTML = tmp.querySelector('#prSideList').innerHTML;
}

// ---------- начало ----------
function prHome() {
  const roles = PR.config.roles || [];
  return `<div class="pr-panel pr-home">
    <div class="pr-top"><div class="pr-grow"><h1>Процеси</h1><p class="pr-dim">Как работим — стъпка по стъпка. Всяка стъпка има един ред и човек, който я прави. Детайлите са под „ℹ️ Повече“.</p></div>
      ${PR.canEdit ? '<a class="pr-btn pr-pri" href="#/processes/new">＋ Нов процес</a>' : ''}</div>
    <div class="pr-tiles">
      <div class="pr-tile"><b>☑️ Моят чеклист</b><span class="pr-dim">Всичко, което прави една роля, събрано на една страница — за печат или за екрана.</span>
        <div class="pr-chips">${roles.map((r) => `<a class="pr-chip" href="#/processes/checklists/${encodeURIComponent(r.key)}" style="border-color:${esc(r.color)};color:${esc(r.color)}">${esc(r.name)}</a>`).join('')}</div></div>
      <a class="pr-tile" href="#/processes/roles"><b>👥 Кой за какво отговаря</b><span class="pr-dim">Сглобява се сам от стъпките — карти по роля или матрица.</span></a>
      <div class="pr-tile"><b>📊 Накратко</b><span class="pr-dim">${PR.data.length} процеса · ${PR.data.reduce((a, p) => a + p.steps.length, 0)} стъпки · ${(PR.config.depts || []).length} отдела · ${roles.length} роли</span></div>
    </div>
    <h3 class="pr-h3">Отдели</h3>
    <div class="pr-dgrid">${prByDept().map((g) => `<div class="pr-dcard" style="border-top-color:${esc(g.d.color)}">
      <div class="pr-dcard-h"><span class="pr-ico" style="background:${esc(g.d.color)}26">${esc(g.d.icon || '📁')}</span><b>${esc(g.d.name)}</b><span class="pr-cnt">${g.list.length}</span></div>
      ${g.list.map((p) => `<a class="pr-prow" href="#/processes/${p.id}"><span>${esc(p.name)}</span><span class="pr-dots">${p.steps.map((s) => `<i style="background:${esc(prRole(s.who).color)}"></i>`).join('')}</span></a>`).join('') || '<div class="pr-dim">Още няма процеси.</div>'}
    </div>`).join('')}</div>
    <h3 class="pr-h3">Последни промени</h3><div id="prRecent" class="pr-dim">Зареждам…</div>
  </div>`;
}
async function prLoadRecent() {
  const box = document.getElementById('prRecent'); if (!box) return;
  try {
    const j = await (await fetch('/api/processes/recent')).json();
    box.innerHTML = (j.items || []).length ? `<ul class="pr-recent">${j.items.map((v) => `<li><a href="#/processes/${Number(v.process_id)}">${esc(v.name)}</a> <span class="pr-dim">· v${Number(v.version)} · ${esc(prDate(v.created_at))} · ${esc(v.author_name || '')}${v.note ? ' — ' + esc(v.note) : ''}</span></li>`).join('')}</ul>` : 'Още няма промени.';
  } catch { box.textContent = 'Не се заредиха.'; }
}

// ---------- процес (вариант A) ----------
function prHead(p) {
  const d = prDept(p.dept);
  return `<div class="pr-top"><div class="pr-grow"><div class="pr-crumb"><a href="#/processes">Начало</a> › ${esc(d.icon || '')} ${esc(d.name)}</div><h1>${esc(p.name)}</h1>
      <div class="pr-dim pr-small">v${Number(p.version)} · последна промяна ${esc(prDate(p.updated_at))}${p.updated_by ? ' от ' + esc(p.updated_by) : ''}</div></div>
    <a class="pr-btn" href="#/processes/checklists/${encodeURIComponent('p' + p.id)}">🖨 Чеклист на процеса</a>
    ${PR.canEdit ? `<a class="pr-btn pr-pri" href="#/processes/${p.id}/edit">✏️ Редактирай</a>` : ''}</div>
  <div class="pr-meta">
    <div><small>👤 Собственик на процеса</small>${p.owner ? prPill(p.owner) : '<span class="pr-dim">—</span>'}</div>
    <div><small>⏰ Кога започва</small>${esc(p.when) || '<span class="pr-dim">—</span>'}</div>
    <div><small>✅ Готово е, когато</small>${esc(p.done) || '<span class="pr-dim">—</span>'}</div>
  </div>`;
}
function prView(p) {
  const blocks = p.steps.map((s, i) => {
    const r = prRole(s.who), k = p.id + ':' + i;
    return `<div class="pr-step" id="prSt${i}"><div class="pr-num" style="background:${esc(r.color)};color:${prInk(r.color)}">${i + 1}</div><div class="pr-block" style="border-left-color:${esc(r.color)}">
      <div class="pr-bhead"><div class="pr-btitle">${esc(s.title)}</div>${prPill(s.who)}</div>
      ${s.checks.length ? `<div class="pr-checks">${s.checks.map((t) => `<label><input type="checkbox"> ${esc(t)}</label>`).join('')}</div>` : ''}
      ${prWarnHtml(s.warn)}
      ${s.more || prImgs(s).length ? `<div class="pr-more" onclick="prToggleMore(${jsq(k)})">${PR.open.has(k) ? '▾ Скрий' : 'ℹ️ Повече' + (prImgs(s).length ? ' · 🖼 ' + prImgs(s).length : '')}</div>${PR.open.has(k) ? `<div class="pr-details">${s.more ? prText(s.more) : ''}${prGallery(s)}</div>` : ''}` : ''}
    </div></div>`;
  }).join('');
  return `<div class="pr-panel">${prHead(p)}
    <div class="pr-flow">${p.steps.map((s, i) => `${i ? '<span class="pr-arr">→</span>' : ''}<span class="pr-chip" style="border-color:${esc(prRole(s.who).color)};color:${esc(prRole(s.who).color)}" onclick="prJump(${i})">${i + 1}. ${esc(s.title)}</span>`).join('')}</div>
    ${blocks || '<p class="pr-dim">Процесът още няма стъпки.</p>'}
    <div class="pr-hist" id="prHist"></div></div>`;
}
function prToggleMore(k) { PR.open.has(k) ? PR.open.delete(k) : PR.open.add(k); router(); }
function prJump(i) { const el = document.getElementById('prSt' + i); if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); const b = el.querySelector('.pr-block'); b.classList.add('pr-flash'); setTimeout(() => b.classList.remove('pr-flash'), 1200); }
async function prLoadHistory(id) {
  const box = document.getElementById('prHist'); if (!box) return;
  try {
    const j = await (await fetch('/api/processes/' + id + '/versions')).json();
    const p = prProc(id);
    box.innerHTML = `<b>История на версиите</b><ul>${(j.versions || []).map((v) => `<li>v${Number(v.version)} · ${esc(prDate(v.created_at))} · ${esc(v.author_name || '')}${v.note ? ' — ' + esc(v.note) : ''}
      ${PR.canEdit && p && Number(v.version) !== Number(p.version) ? ` <button class="pr-link" onclick="prRestore(${id}, ${Number(v.version)})">върни тази</button>` : ''}</li>`).join('')}</ul>`;
  } catch { box.textContent = ''; }
}
async function prRestore(id, ver) {
  if (!confirm(`Да върна v${ver}? Текущото състояние остава в историята.`)) return;
  const r = await fetch('/api/processes/' + id + '/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: ver }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return showToast(j.error || 'Грешка', 'error', 5000);
  await prLoad(true); showToast(`Върната v${ver} (запазена като v${j.process.version})`, 'success'); router();
}

// ---------- редакция ----------
function prEditor(isNew, id) {
  if (!PR.E || (isNew ? PR.E.id : PR.E.id !== id)) {
    const src = isNew ? { id: null, name: '', dept: ((PR.config.depts || [])[0] || {}).key || '', owner: '', when: '', done: '', steps: [], version: 0 } : prProc(id);
    PR.E = JSON.parse(JSON.stringify(src));
  }
  const E = PR.E;
  const roleSel = (val, path, rer) => `<select onchange="prSet(${jsq(path)}, this.value${rer ? ', true' : ''})"><option value="" ${val ? '' : 'selected'}>—</option>${(PR.config.roles || []).map((r) => `<option value="${esc(r.key)}" ${r.key === val ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`;
  const add = (i) => `<button class="pr-add" onclick="prAddStep(${i})">＋ Добави стъпка тук</button>`;
  return `<div class="pr-panel pr-edit">
    <div class="pr-top"><div class="pr-grow"><div class="pr-crumb"><a href="#/processes">Начало</a> › ${isNew ? 'Нов процес' : 'Редакция'}</div><h1>${isNew ? '＋ Нов процес' : '✏️ ' + esc(E.name)}</h1></div>
      ${!isNew ? `<button class="pr-btn pr-del" onclick="prDelete(${Number(E.id)})">🗑 Изтрий процеса</button>` : ''}</div>
    <div class="pr-row2"><div><label class="pr-f">Име на процеса</label><input type="text" value="${esc(E.name)}" oninput="prSet('name', this.value)" placeholder="напр. Снимачен ден"></div>
      <div><label class="pr-f">Отдел</label><select onchange="prSet('dept', this.value)">${(PR.config.depts || []).map((d) => `<option value="${esc(d.key)}" ${d.key === E.dept ? 'selected' : ''}>${esc(d.icon || '')} ${esc(d.name)}</option>`).join('')}</select></div></div>
    <div class="pr-row3"><div><label class="pr-f">⏰ Кога започва</label><input type="text" value="${esc(E.when)}" oninput="prSet('when', this.value)"></div>
      <div><label class="pr-f">✅ Готово е, когато</label><input type="text" value="${esc(E.done)}" oninput="prSet('done', this.value)"></div>
      <div><label class="pr-f">👤 Собственик на процеса</label>${roleSel(E.owner, 'owner')}</div></div>
    <div style="height:14px"></div>${add(0)}
    ${E.steps.map((s, i) => { const r = prRole(s.who); return `<div class="pr-step"><div class="pr-num" style="background:${esc(r.color)};color:${prInk(r.color)}">${i + 1}</div><div class="pr-block" style="border-left-color:${esc(r.color)}">
      <div class="pr-row2"><div><label class="pr-f">Стъпка — един ред, започва с глагол</label><input type="text" value="${esc(s.title)}" oninput="prSet(${jsq('steps.' + i + '.title')}, this.value)"></div>
        <div><label class="pr-f">Кой я прави</label>${roleSel(s.who, 'steps.' + i + '.who', true)}</div></div>
      <label class="pr-f">ℹ️ Повече (по желание — показва се само при клик; линковете, вкл. към видео, стават кликаеми; снимка може и с Ctrl+V тук)</label><textarea oninput="prSet(${jsq('steps.' + i + '.more')}, this.value)" onpaste="prPasteImg(event, ${i})">${esc(s.more)}</textarea>
      <div class="pr-imgs">${prImgs(s).map((u, j) => `<div class="pr-imgbox"><img src="${safeUrl(u)}" alt=""><button class="pr-btn pr-sm pr-del" onclick="prDelImg(${i}, ${j})" title="Махни снимката">✕</button></div>`).join('')}
        <label class="pr-btn pr-sm">📷 Добави снимка<input type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden onchange="prUploadImgs(this.files, ${i}); this.value=''"></label></div>
      <label class="pr-f">☐ Чеклист (по желание)</label>
      ${s.checks.map((t, j) => `<div class="pr-citem"><input type="text" value="${esc(t)}" oninput="prSet(${jsq('steps.' + i + '.checks.' + j)}, this.value)"><button class="pr-btn pr-sm pr-del" onclick="prDelCheck(${i}, ${j})">✕</button></div>`).join('')}
      <button class="pr-btn pr-sm" onclick="prAddCheck(${i})">＋ точка</button>
      <label class="pr-f">⛔ Внимание (по желание)</label><input type="text" value="${esc(s.warn)}" oninput="prSet(${jsq('steps.' + i + '.warn')}, this.value)">
      <div class="pr-tools"><button class="pr-btn pr-sm" onclick="prMove(${i}, -1)" ${i ? '' : 'disabled'}>↑</button><button class="pr-btn pr-sm" onclick="prMove(${i}, 1)" ${i < E.steps.length - 1 ? '' : 'disabled'}>↓</button>
        <button class="pr-btn pr-sm pr-del" style="margin-left:auto" onclick="prDelStep(${i})">🗑 Изтрий стъпката</button></div>
    </div></div>${add(i + 1)}`; }).join('')}
    <div class="pr-bar"><span class="pr-dim">Какво промени?</span><input type="text" id="prNote" placeholder="напр. добавих проверка на звука" style="flex:1">
      <a class="pr-btn" href="${isNew ? '#/processes' : '#/processes/' + Number(E.id)}" onclick="PR.E=null">Отказ</a>
      <button class="pr-btn pr-pri" onclick="prSave()">💾 ${isNew ? 'Създай' : 'Запази като v' + (Number(E.version) + 1)}</button></div>
  </div>`;
}
function prSet(path, val, rerender) {
  const parts = String(path).split('.'); let o = PR.E;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = val;
  if (rerender) router();
}
function prAddStep(i) { PR.E.steps.splice(i, 0, { title: '', who: PR.E.owner || '', more: '', checks: [], warn: '', images: [] }); router(); }
// ---------- снимки в „Повече" ----------
const prImgs = (s) => (s && Array.isArray(s.images) ? s.images : []);
function prGallery(s, print) {
  // при печат/сваляне адресът е пълен, за да се вижда и в изтегления файл
  const list = prImgs(s).map((u) => safeUrl(print && u.startsWith('/') ? location.origin + u : u)).filter(Boolean);
  if (!list.length) return '';
  return `<div class="${print ? 'prc-imgs' : 'pr-gallery'}">${list.map((u) => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="" loading="lazy"></a>`).join('')}</div>`;
}
async function prUploadImgs(files, i) {
  const step = PR.E && PR.E.steps[i]; if (!step) return;
  if (!Array.isArray(step.images)) step.images = [];
  for (const file of Array.from(files || [])) {
    if (step.images.length >= 12) { showToast('Максимум 12 снимки на стъпка', 'error'); break; }
    const fd = new FormData(); fd.append('file', file, file.name || 'snimka.png');
    const r = await fetch('/api/processes/images', { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(j.error || 'Снимката не се качи', 'error', 5000); continue; }
    step.images.push(j.url);
  }
  router();
}
function prPasteImg(ev, i) {
  const items = Array.from((ev.clipboardData && ev.clipboardData.items) || []).filter((x) => x.kind === 'file' && /^image\/(png|jpeg|gif|webp)$/.test(x.type));
  if (!items.length) return; // обикновен текст — нищо не пипаме
  ev.preventDefault();
  prUploadImgs(items.map((x) => x.getAsFile()).filter(Boolean), i);
}
function prDelImg(i, j) { PR.E.steps[i].images.splice(j, 1); router(); }
function prDelStep(i) { if (confirm('Да изтрия стъпка ' + (i + 1) + '?')) { PR.E.steps.splice(i, 1); router(); } }
function prMove(i, d) { const s = PR.E.steps.splice(i, 1)[0]; PR.E.steps.splice(i + d, 0, s); router(); }
function prAddCheck(i) { PR.E.steps[i].checks.push(''); router(); }
function prDelCheck(i, j) { PR.E.steps[i].checks.splice(j, 1); router(); }
async function prSave() {
  const E = PR.E;
  if (!String(E.name || '').trim()) return showToast('Процесът трябва да има име', 'error');
  const body = { name: E.name, dept: E.dept, owner: E.owner, when: E.when, done: E.done, steps: E.steps, note: (document.getElementById('prNote') || {}).value || '', baseVersion: E.version };
  const r = await fetch(E.id ? '/api/processes/' + E.id : '/api/processes', { method: E.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return showToast(j.error || 'Грешка при запазване', 'error', 7000);
  PR.E = null; await prLoad(true);
  showToast(E.id ? `Запазено като v${j.process.version}` : 'Процесът е създаден', 'success');
  location.hash = '#/processes/' + j.process.id;
}
async function prDelete(id) {
  const p = prProc(id); if (!p || !confirm(`Да изтрия „${p.name}"? Историята остава в базата.`)) return;
  const r = await fetch('/api/processes/' + id, { method: 'DELETE' });
  if (!r.ok) return showToast('Грешка при изтриване', 'error');
  PR.E = null; await prLoad(true); showToast('Изтрит', 'success'); location.hash = '#/processes';
}

// ---------- кой за какво отговаря ----------
function prSetRolesView(v) { PR.rolesView = v; localStorage.setItem('pr_roles_view', v); router(); }
function prRolesView() {
  const roles = PR.config.roles || [];
  const sw = `<div class="pr-seg"><button class="${PR.rolesView === 'cards' ? 'on' : ''}" onclick="prSetRolesView('cards')">Карти по роля</button><button class="${PR.rolesView === 'matrix' ? 'on' : ''}" onclick="prSetRolesView('matrix')">Матрица</button></div>`;
  const head = `<div class="pr-top"><h1 class="pr-grow">👥 Кой за какво отговаря</h1>${sw}</div>
    <div class="pr-note">Тази страница <b>не се пише на ръка</b> — сглобява се от стъпките в процесите. Смениш ли „кой я прави“ на стъпка, добавиш или изтриеш стъпка — тук е веднага след „Запази“.</div>`;
  if (PR.rolesView === 'matrix') {
    const rows = prByDept().map((g) => `<tr class="pr-mx-dept"><td colspan="${roles.length + 1}">${esc(g.d.icon || '')} ${esc(g.d.name)}</td></tr>` + g.list.map((p) => `<tr><td class="pr-mx-name"><a href="#/processes/${p.id}">${esc(p.name)}</a></td>${roles.map((r) => {
      const steps = p.steps.filter((s) => s.who === r.key), own = p.owner === r.key;
      if (!steps.length && !own) return '<td class="pr-mx-empty">·</td>';
      return `<td class="pr-mx-c" title="${esc(steps.map((s) => s.title).join(' · '))}"><a href="#/processes/${p.id}" style="color:${esc(r.color)}">${own ? '★' : ''}${steps.length || ''}</a></td>`;
    }).join('')}</tr>`).join('')).join('');
    return `<div class="pr-panel">${head}<div class="pr-mx-wrap"><table class="pr-mx"><thead><tr><th class="pr-mx-name">Процес</th>${roles.map((r) => `<th><a href="#/processes/checklists/${encodeURIComponent(r.key)}"><span class="pr-dotb" style="background:${esc(r.color)}"></span>${esc(r.name)}</a></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="pr-dim pr-small">Число = колко стъпки прави ролята в процеса · ★ = собственик на процеса · задръж мишката върху числото за стъпките · кликни роля горе за нейния чеклист.</p></div>`;
  }
  return `<div class="pr-panel">${head}<div class="pr-roles">${roles.map((r) => {
    const own = PR.data.filter((p) => p.owner === r.key);
    const groups = PR.data.map((p) => ({ p, steps: p.steps.map((s, i) => ({ s, i })).filter((x) => x.s.who === r.key) })).filter((g) => g.steps.length);
    const total = groups.reduce((a, g) => a + g.steps.length, 0);
    return `<div class="pr-role" style="border-top-color:${esc(r.color)}"><div class="pr-role-h"><b style="color:${esc(r.color)}">${esc(r.name)}</b><span class="pr-dim pr-small">${total} стъпки · ${groups.length} процеса</span>
        <a class="pr-btn pr-sm" href="#/processes/checklists/${encodeURIComponent(r.key)}">☑️ Чеклист</a></div>
      ${own.length ? `<div class="pr-dim pr-small">★ Собственик на: ${own.map((p) => `<a href="#/processes/${p.id}">${esc(p.name)}</a>`).join(', ')}</div>` : ''}
      ${groups.map((g) => `<div class="pr-role-g"><a href="#/processes/${g.p.id}"><b>${esc(prDept(g.p.dept).icon || '')} ${esc(g.p.name)}</b></a><ul>${g.steps.map((x) => `<li><span class="pr-dim">${x.i + 1}.</span> ${esc(x.s.title)}</li>`).join('')}</ul></div>`).join('') || '<div class="pr-dim">Няма стъпки.</div>'}
    </div>`;
  }).join('')}</div></div>`;
}

// ---------- чеклисти по роля (за печат / сваляне) ----------
// key = ключ на роля, или „p<id>“ за чеклист на един процес.
// Чеклистът на ролята може да е целият (по подразбиране) или само избрани процеси —
// напр. видеографът си взима само „Снимачен ден". Изборът е в PR.clOff (изключените) и не се пази.
function prChecklistModel(key) {
  if (/^p\d+$/.test(key || '')) {
    const p = prProc(parseInt(key.slice(1), 10)); if (!p) return null;
    const groups = [{ p, steps: p.steps.map((s, i) => ({ s, i })) }];
    return { title: p.name, sub: 'Чеклист на процеса · всички стъпки', color: prDept(p.dept).color, groups, all: groups, own: [], showWho: true, single: true };
  }
  const r = (PR.config.roles || []).find((x) => x.key === key); if (!r) return null;
  const all = prByDept().flatMap((g) => g.list).map((p) => ({ p, steps: p.steps.map((s, i) => ({ s, i })).filter((x) => x.s.who === r.key || x.s.who === 'all') })).filter((g) => g.steps.length);
  const off = PR.clOff[key] || new Set();
  const groups = all.filter((g) => !off.has(g.p.id));
  const part = groups.length < all.length;
  return {
    title: r.name + (part && groups.length === 1 ? ' — ' + groups[0].p.name : ''),
    sub: part ? `Част от чеклиста: ${groups.length} от ${all.length} процеса` : 'Всичко, което прави тази роля, от всички процеси',
    color: r.color, groups, all, own: part ? [] : PR.data.filter((p) => p.owner === r.key), showWho: false,
  };
}
function prClToggle(key, id) { const off = PR.clOff[key] || (PR.clOff[key] = new Set()); off.has(id) ? off.delete(id) : off.add(id); router(); }
function prClOnly(key, id) { const m = prChecklistModel(key); PR.clOff[key] = new Set(m.all.map((g) => g.p.id).filter((x) => x !== id)); router(); }
function prClAll(key, on) { const m = prChecklistModel(key); PR.clOff[key] = on ? new Set() : new Set(m.all.map((g) => g.p.id)); router(); }
function prClPicker(key, m) {
  if (m.single) return '';
  const off = PR.clOff[key] || new Set();
  return `<div class="pr-pick"><div class="pr-pick-h"><b>Какво да влезе</b><span class="pr-dim pr-small">по подразбиране — целият; „само“ = чеклист само за това (напр. за снимачен ден)</span>
      <button class="pr-btn pr-sm" onclick="prClAll(${jsq(key)}, true)">Целият</button><button class="pr-btn pr-sm" onclick="prClAll(${jsq(key)}, false)">Нищо</button></div>
    <div class="pr-pick-list">${m.all.map((g) => { const on = !off.has(g.p.id); return `<div class="pr-pick-item ${on ? 'on' : ''}"><label><input type="checkbox" ${on ? 'checked' : ''} onchange="prClToggle(${jsq(key)}, ${g.p.id})"> ${esc(prDept(g.p.dept).icon || '')} ${esc(g.p.name)} <span class="pr-dim pr-small">· ${g.steps.length}</span></label><button class="pr-link" onclick="prClOnly(${jsq(key)}, ${g.p.id})">само</button></div>`; }).join('')}</div></div>`;
}
function prChecklistHtml(m, withMore) {
  return `<div class="prc-head" style="border-color:${esc(m.color)}"><div><div class="prc-kicker">Чеклист · The Pact</div><h1>${esc(m.title)}</h1><div class="prc-sub">${esc(m.sub)} · сглобен на ${esc(prDate(new Date()))}</div></div></div>
  ${m.own.length ? `<p class="prc-own">★ Собственик на: ${m.own.map((p) => esc(p.name)).join(', ')}</p>` : ''}
  ${m.groups.map((g) => `<section class="prc-sec"><h2>${esc(prDept(g.p.dept).icon || '')} ${esc(g.p.name)}</h2>
    ${g.p.when ? `<div class="prc-when">⏰ ${esc(g.p.when)}${g.p.done ? ' · ✅ ' + esc(g.p.done) : ''}</div>` : ''}
    ${g.steps.map((x) => `<div class="prc-step"><span class="prc-box"></span><div><b>${x.i + 1}. ${esc(x.s.title)}</b>${m.showWho || x.s.who === 'all' ? ` <span class="prc-who">(${esc(prRole(x.s.who).name)})</span>` : ''}
      ${x.s.checks.length ? `<div class="prc-sub2">${x.s.checks.map((t) => `<div class="prc-step prc-small"><span class="prc-box"></span><div>${esc(t)}</div></div>`).join('')}</div>` : ''}
      ${x.s.warn && !prIsGap(x.s.warn) ? `<div class="prc-warn">⛔ ${esc(x.s.warn)}</div>` : ''}
      ${withMore && x.s.more ? `<div class="prc-more">${prText(x.s.more)}</div>` : ''}${withMore ? prGallery(x.s, true) : ''}</div></div>`).join('')}
  </section>`).join('') || '<p>Няма стъпки за тази роля.</p>'}`;
}
const PRC_CSS = `.prc{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111;background:#fff;max-width:820px;margin:0 auto;padding:28px 34px;line-height:1.45}
.prc h1{font-size:26px;margin:2px 0}.prc-head{border-left:8px solid;padding-left:14px;margin-bottom:16px}.prc-kicker{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#666}
.prc-sub{color:#555;font-size:13px}.prc-own{font-size:13px;color:#333;margin:0 0 10px}.prc-sec{margin:18px 0 6px;break-inside:avoid-page}.prc h2{font-size:17px;margin:0 0 4px;border-bottom:1px solid #ccc;padding-bottom:3px}
.prc-when{font-size:12px;color:#555;margin-bottom:6px}.prc-step{display:flex;gap:10px;align-items:flex-start;margin:7px 0;break-inside:avoid}.prc-box{width:15px;height:15px;border:1.6px solid #333;border-radius:3px;flex:none;margin-top:2px}
.prc-small{margin:4px 0;font-size:13.5px}.prc-small .prc-box{width:12px;height:12px}.prc-sub2{margin:4px 0 0 2px}.prc-who{color:#666;font-weight:400;font-size:12.5px}.prc-warn{color:#b3261e;font-size:13px;margin-top:3px}
.prc-more{white-space:pre-wrap;font-size:12.5px;color:#444;background:#f4f4f4;border-radius:6px;padding:6px 9px;margin-top:4px}.prc a{color:#1f5fbf}
.prc-imgs{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.prc-imgs img{max-height:150px;max-width:260px;border-radius:5px;border:1px solid #ddd;display:block}`;
function prChecklists(key) {
  const roles = PR.config.roles || [];
  const picker = `<div class="pr-chips">${roles.map((r) => `<a class="pr-chip ${r.key === key ? 'on' : ''}" href="#/processes/checklists/${encodeURIComponent(r.key)}" style="border-color:${esc(r.color)};${r.key === key ? `background:${esc(r.color)};color:${prInk(r.color)}` : `color:${esc(r.color)}`}">${esc(r.name)}</a>`).join('')}</div>`;
  const m = key ? prChecklistModel(key) : null;
  if (!m) return `<div class="pr-panel"><div class="pr-top"><h1 class="pr-grow">☑️ Чеклисти по роля</h1></div>
    <p class="pr-dim">Избери роля — ще получиш всички нейни стъпки от всички процеси на една страница, с квадратчета за отмятане. Може да се принтира, да се запази като PDF или да се изтегли. Сглобява се сам, затова винаги е актуален.</p>${picker}</div>`;
  return `<div class="pr-panel"><div class="pr-top pr-noprint"><h1 class="pr-grow">☑️ Чеклист</h1>
      <label class="pr-dim"><input type="checkbox" ${PR.clMore ? 'checked' : ''} onchange="PR.clMore=this.checked;router()"> с подробностите („Повече“)</label>
      <button class="pr-btn" onclick="prDownloadChecklist(${jsq(key)})">⬇ Изтегли</button><button class="pr-btn pr-pri" onclick="window.print()">🖨 Принтирай / PDF</button></div>
    <div class="pr-noprint">${picker}${prClPicker(key, m)}</div>
    <div id="prPrintArea" class="prc pr-paper">${prChecklistHtml(m, PR.clMore)}</div></div>
    <style>${PRC_CSS}</style>`;
}
function prDownloadChecklist(key) {
  const m = prChecklistModel(key); if (!m) return;
  const html = `<!DOCTYPE html><html lang="bg"><head><meta charset="UTF-8"><title>Чеклист — ${esc(m.title)}</title><style>${PRC_CSS}body{margin:0;background:#fff}@media print{.prc{padding:0}}</style></head><body><div class="prc">${prChecklistHtml(m, PR.clMore)}</div></body></html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = 'Чеклист - ' + m.title.replace(/[\\/:*?"<>|]/g, '') + '.html';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- настройки: роли, отдели, ред ----------
function prSettings() {
  if (!PR.cfgDraft) PR.cfgDraft = JSON.parse(JSON.stringify(PR.config));
  if (!PR.orderDraft) PR.orderDraft = PR.data.map((p) => p.id);
  const C = PR.cfgDraft;
  const used = (key, kind) => kind === 'r' ? PR.data.reduce((a, p) => a + (p.owner === key ? 1 : 0) + p.steps.filter((s) => s.who === key).length, 0) : PR.data.filter((p) => p.dept === key).length;
  const row = (x, i, kind, arr) => `<div class="pr-cfg-row">
      <input type="color" value="${esc(x.color)}" oninput="prCfg(${jsq(kind)}, ${i}, 'color', this.value)">
      ${kind === 'd' ? `<input type="text" class="pr-cfg-ico" value="${esc(x.icon || '')}" oninput="prCfg('d', ${i}, 'icon', this.value)" title="Икона (емоджи)">` : ''}
      <input type="text" value="${esc(x.name)}" oninput="prCfg(${jsq(kind)}, ${i}, 'name', this.value)">
      <span class="pr-dim pr-small">${used(x.key, kind)} ${kind === 'r' ? 'стъпки' : 'процеса'}</span>
      <button class="pr-btn pr-sm" onclick="prCfgMove(${jsq(kind)}, ${i}, -1)" ${i ? '' : 'disabled'}>↑</button>
      <button class="pr-btn pr-sm" onclick="prCfgMove(${jsq(kind)}, ${i}, 1)" ${i < arr.length - 1 ? '' : 'disabled'}>↓</button>
      <button class="pr-btn pr-sm pr-del" onclick="prCfgDel(${jsq(kind)}, ${i})" ${used(x.key, kind) ? 'disabled title="Още се ползва — първо го смени в процесите"' : ''}>✕</button></div>`;
  const order = prByDept().map((g) => `<div class="pr-ord-g"><b>${esc(g.d.icon || '')} ${esc(g.d.name)}</b>${PR.orderDraft.map((id) => prProc(id)).filter((p) => p && p.dept === g.d.key).map((p, i, list) => `<div class="pr-cfg-row"><span class="pr-grow">${esc(p.name)}</span>
      <button class="pr-btn pr-sm" onclick="prOrdMove(${p.id}, -1)" ${i ? '' : 'disabled'}>↑</button><button class="pr-btn pr-sm" onclick="prOrdMove(${p.id}, 1)" ${i < list.length - 1 ? '' : 'disabled'}>↓</button></div>`).join('')}</div>`).join('');
  return `<div class="pr-panel"><div class="pr-top"><h1 class="pr-grow">⚙️ Настройки на процесите</h1></div>
    <div class="pr-cfg">
      <div class="pr-cfg-col"><h3 class="pr-h3">Роли — кой прави стъпката</h3><p class="pr-dim pr-small">Цвят, име и ред. Роля, която още се ползва, не може да се махне.</p>
        ${C.roles.map((r, i) => row(r, i, 'r', C.roles)).join('')}<button class="pr-btn pr-sm" onclick="prCfgAdd('r')">＋ Роля</button></div>
      <div class="pr-cfg-col"><h3 class="pr-h3">Отдели — групите в менюто</h3><p class="pr-dim pr-small">Цвят, икона (емоджи), име и ред.</p>
        ${C.depts.map((d, i) => row(d, i, 'd', C.depts)).join('')}<button class="pr-btn pr-sm" onclick="prCfgAdd('d')">＋ Отдел</button>
        <div style="margin-top:14px"><button class="pr-btn pr-pri" onclick="prCfgSave()">💾 Запази ролите и отделите</button> <button class="pr-btn" onclick="PR.cfgDraft=null;router()">Отказ</button></div></div>
      <div class="pr-cfg-col"><h3 class="pr-h3">Ред на процесите в менюто</h3>${order}
        <div style="margin-top:14px"><button class="pr-btn pr-pri" onclick="prOrdSave()">💾 Запази реда</button></div></div>
    </div></div>`;
}
function prCfgArr(kind) { return kind === 'r' ? PR.cfgDraft.roles : PR.cfgDraft.depts; }
function prCfg(kind, i, f, v) { prCfgArr(kind)[i][f] = v; }
function prCfgMove(kind, i, d) { const a = prCfgArr(kind); const x = a.splice(i, 1)[0]; a.splice(i + d, 0, x); router(); }
function prCfgDel(kind, i) { prCfgArr(kind).splice(i, 1); router(); }
function prCfgAdd(kind) {
  const key = (kind === 'r' ? 'r' : 'd') + Date.now().toString(36).slice(-6);
  prCfgArr(kind).push(kind === 'r' ? { key, name: 'Нова роля', color: '#8b949e' } : { key, name: 'Нов отдел', icon: '📁', color: '#8b949e' });
  router();
}
async function prCfgSave() {
  const r = await fetch('/api/processes/config/all', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(PR.cfgDraft) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return showToast(j.error || 'Грешка', 'error', 7000);
  PR.cfgDraft = null; await prLoad(true); showToast('Ролите и отделите са запазени', 'success'); router();
}
function prOrdMove(id, d) {
  const p = prProc(id); const same = PR.orderDraft.filter((x) => (prProc(x) || {}).dept === p.dept);
  const j = same.indexOf(id) + d; if (j < 0 || j >= same.length) return;
  const a = PR.orderDraft.indexOf(id), b = PR.orderDraft.indexOf(same[j]);
  [PR.orderDraft[a], PR.orderDraft[b]] = [PR.orderDraft[b], PR.orderDraft[a]]; router();
}
async function prOrdSave() {
  const r = await fetch('/api/processes/order/all', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: PR.orderDraft }) });
  if (!r.ok) return showToast('Грешка', 'error');
  PR.orderDraft = null; await prLoad(true); showToast('Редът е запазен', 'success'); router();
}

// ---------- дупки: „ДУПКА: …" (с или без 🕳/🚧 отпред) в „Внимание" = място, по което още трябва да се работи ----------
// Не е отделно поле — пише се в „Внимание". Махнеш ли го от стъпката, изчезва и от списъка.
// Не се печата в чеклистите на екипа (там е шум).
const GAP_RE = /^\s*(?:🕳️?|🚧)?\s*ДУПКА:\s*/u;
const prIsGap = (w) => GAP_RE.test(w || '');
const prGapText = (w) => String(w || '').replace(GAP_RE, '');
function prWarnHtml(w) {
  if (!w) return '';
  return prIsGap(w) ? `<div class="pr-gap">🚧 ДУПКА: ${esc(prGapText(w))}</div>` : `<div class="pr-warn">⛔ ${esc(w)}</div>`;
}
function prGaps() {
  return (PR.data || []).flatMap((p) => p.steps.map((s, i) => ({ p, s, i })).filter((x) => prIsGap(x.s.warn)));
}
function prGapsView() {
  const list = prGaps();
  const groups = prByDept().map((g) => ({ d: g.d, items: list.filter((x) => g.list.includes(x.p)) })).filter((g) => g.items.length);
  return `<div class="pr-panel"><div class="pr-top"><h1 class="pr-grow">🚧 Дупки за оправяне</h1><span class="pr-dim">${list.length} общо</span></div>
    <div class="pr-note">Места в процесите, по които още трябва да се работи. Събират се сами от стъпките: в „⛔ Внимание“ на стъпката започва с „ДУПКА:“. Оправиш ли дупката — махни реда от стъпката и тя изчезва оттук. В чеклистите на екипа не се печатат.</div>
    ${groups.map((g) => `<h3 class="pr-h3">${esc(g.d.icon || '')} ${esc(g.d.name)}</h3>${g.items.map((x) => `<a class="pr-gaprow" href="#/processes/${x.p.id}"><span class="pr-gapwhere">${esc(x.p.name)} · стъпка ${x.i + 1}<b>${esc(x.s.title)}</b></span><span class="pr-gaptxt">${esc(prGapText(x.s.warn))}</span>${prPill(x.s.who)}</a>`).join('')}`).join('') || '<p class="pr-dim">Няма отбелязани дупки. 🎉</p>'}
  </div>`;
}
