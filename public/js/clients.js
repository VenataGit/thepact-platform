// ==================== CLIENTS ====================
// Per-client overview. Grid of client cards -> click -> detail with each content
// plan (КП) and its videos grouped by department/stage. Data: /api/clients, sourced
// live from the Video Production Basecamp boards (re-sliced by client title prefix).

var _clientsData = null;   // { generatedAt, clients: [summary] }
var _clientDetail = null;  // full client object

// ---- list view ----
async function renderClientsList(el) {
  setBreadcrumb(null);
  el.className = 'full-width';
  el.innerHTML =
    '<div class="cl-wrap">' +
      '<div class="cl-head">' +
        '<span class="cl-head__title">Клиенти</span>' +
        '<button class="cl-refresh" onclick="clientsReload()" title="Обнови">↻</button>' +
      '</div>' +
      '<div class="cl-grid" id="clGrid"><div class="cl-loading">Зареждам клиентите от Basecamp…</div></div>' +
    '</div>';
  await clientsLoad();
}

function clientsReload() {
  var g = document.getElementById('clGrid');
  if (g) g.innerHTML = '<div class="cl-loading">Обновявам…</div>';
  clientsLoad();
}

async function clientsLoad() {
  var grid = document.getElementById('clGrid');
  try {
    var res = await fetch('/api/clients');
    if (res.status === 401) { if (grid) grid.innerHTML = clientsAuthMsg(); return; }
    if (!res.ok) throw new Error('load');
    _clientsData = await res.json();
  } catch (e) {
    if (grid) grid.innerHTML = '<div class="cl-err">Грешка при зареждане от Basecamp.</div>';
    return;
  }
  clientsRenderGrid();
}

function clientsRenderGrid() {
  var grid = document.getElementById('clGrid');
  if (!grid || !_clientsData) return;
  var list = _clientsData.clients || [];
  if (!list.length) { grid.innerHTML = '<div class="cl-empty">Няма намерени клиенти с КП карти в Basecamp.</div>'; return; }
  grid.innerHTML = list.map(clientCardHtml).join('');
}

function clientsSignalInfo(c) {
  if (c.signal === 'overdue') {
    if (c.planAlert) return { icon: '⚠', text: 'КП-' + c.planAlert.kp + ' просрочен' };
    return { icon: '⚠', text: c.overdueVideos + (c.overdueVideos === 1 ? ' просрочено видео' : ' просрочени видеа') };
  }
  if (c.signal === 'warning') return { icon: '•', text: c.soonVideos + ' с близък срок' };
  return { icon: '✓', text: 'в график' };
}

function clientCardHtml(c) {
  var sig = clientsSignalInfo(c);
  return '<a class="cl-card cl-card--' + c.signal + '" href="#/clients/' + encodeURIComponent(c.name) + '">' +
    '<div class="cl-card__top">' +
      '<div class="cl-avatar" style="background:' + _avColor(c.name) + '">' + esc(c.initials) + '</div>' +
      '<div class="cl-card__id">' +
        '<div class="cl-name">' + esc(c.name) + '</div>' +
        '<div class="cl-sub">' + (c.currentKp ? 'КП-' + c.currentKp : '—') + ' · ' + c.activeVideos + ' активни</div>' +
      '</div>' +
    '</div>' +
    '<div class="cl-sig cl-sig--' + c.signal + '"><span class="cl-sig__ic">' + sig.icon + '</span>' + esc(sig.text) + '</div>' +
  '</a>';
}

// ---- detail view ----
async function renderClientDetail(el, name) {
  setBreadcrumb([{ label: 'Клиенти', href: '#/clients' }, { label: name }]);
  el.className = '';
  el.innerHTML = '<div class="cl-detail" id="clDetail"><div class="cl-loading">Зареждам…</div></div>';
  await clientsLoadDetail(name);
}

async function clientsLoadDetail(name) {
  var host = document.getElementById('clDetail');
  try {
    var res = await fetch('/api/clients/' + encodeURIComponent(name));
    if (res.status === 401) { if (host) host.innerHTML = clientsAuthMsg(); return; }
    if (res.status === 404) { if (host) host.innerHTML = '<div class="cl-err">Клиентът не е намерен.</div>'; return; }
    if (!res.ok) throw new Error('load');
    _clientDetail = await res.json();
  } catch (e) {
    if (host) host.innerHTML = '<div class="cl-err">Грешка при зареждане.</div>';
    return;
  }
  clientsRenderDetail();
}

function clientsBasecampLink(c) {
  for (var i = 0; i < c.plans.length; i++) {
    var p = c.plans[i];
    if (p.planCard && p.planCard.url) return p.planCard.url;
    if (p.videos && p.videos[0] && p.videos[0].url) return p.videos[0].url;
  }
  return null;
}

function clientsRenderDetail() {
  var host = document.getElementById('clDetail');
  if (!host || !_clientDetail) return;
  var c = _clientDetail;
  var link = clientsBasecampLink(c);
  var html =
    '<div class="cl-detail__hdr">' +
      '<div class="cl-avatar cl-avatar--lg" style="background:' + _avColor(c.name) + '">' + esc(c.initials) + '</div>' +
      '<div class="cl-detail__id">' +
        '<div class="cl-detail__name">' + esc(c.name) + '</div>' +
        '<div class="cl-detail__sub">' + c.plans.length + ' контент ' + (c.plans.length === 1 ? 'план' : 'плана') +
          ' · ' + c.activeVideos + ' видеа активни' +
          (c.overdueVideos ? ' · <span class="cl-x-over">' + c.overdueVideos + ' просрочени</span>' : '') +
        '</div>' +
      '</div>' +
      (link ? '<a class="cl-bc-link" href="' + link + '" target="_blank" rel="noopener">Basecamp ↗</a>' : '') +
    '</div>';
  if (!c.plans.length) html += '<div class="cl-empty">Няма КП карти за този клиент.</div>';
  html += c.plans.map(clientPlanHtml).join('');
  host.innerHTML = html;
}

function clFmt(d) { if (!d) return ''; var s = d.split('T')[0].split('-'); return s[2] + '.' + s[1]; }
function clientStageShort(role) {
  return role === 'pre' ? 'Pre' : role === 'production' ? 'Production' : role === 'post' ? 'Post' : role === 'account' ? 'Акаунт' : '—';
}
function clStageLbl(role) {
  return role === 'production' ? 'за снимане' : role === 'post' ? 'за монтаж' : role === 'account' ? 'за качване' : 'активни';
}

function clientStageTiles(p) {
  var pc = p.planCard, preVal, preLbl, preCls;
  if (!pc) { preVal = '—'; preLbl = 'няма план'; preCls = 'cl-stage--none'; }
  else if (pc.finalized) { preVal = '✓'; preLbl = 'финализиран'; preCls = 'cl-stage--ok'; }
  else if (pc.planOverdue) { preVal = '!'; preLbl = 'просрочен'; preCls = 'cl-stage--over'; }
  else { preVal = '…'; preLbl = 'в процес'; preCls = 'cl-stage--warn'; }
  var tiles = [['Pre-Prod', preVal, preLbl, preCls]];
  [['production', 'Production'], ['post', 'Post-Prod'], ['account', 'Акаунт']].forEach(function (s) {
    var st = p.stages[s[0]] || { count: 0, active: 0, overdue: 0 };
    var cls = st.overdue > 0 ? 'cl-stage--over' : (st.active > 0 ? 'cl-stage--act' : 'cl-stage--ok');
    var lbl = st.overdue > 0 ? st.overdue + ' просрочени' : (st.active > 0 ? clStageLbl(s[0]) : 'готово');
    var val = (st.active > 0 || st.overdue > 0) ? String(st.active || st.count) : '0';
    tiles.push([s[1], val, lbl, cls]);
  });
  return tiles.map(function (t) {
    return '<div class="cl-stage ' + t[3] + '">' +
      '<div class="cl-stage__name">' + t[0] + '</div>' +
      '<div class="cl-stage__num">' + t[1] + '</div>' +
      '<div class="cl-stage__lbl">' + esc(t[2]) + '</div>' +
    '</div>';
  }).join('');
}

function clientsVidStatus(v) {
  if (v.onHold) return { cls: 'cl-dot--hold', text: 'на пауза' };
  if (v.overdue) return { cls: 'cl-dot--over', text: 'просрочено' + (v.dueOn ? ' · ' + clFmt(v.dueOn) : '') };
  if (!v.dueOn) return { cls: 'cl-dot--none', text: 'без дата' };
  var d = workingDaysUntil(v.dueOn);
  if (d === 0) return { cls: 'cl-dot--today', text: 'днес' };
  if (d !== null && d <= 4) return { cls: 'cl-dot--soon', text: clFmt(v.dueOn) };
  return { cls: 'cl-dot--ok', text: clFmt(v.dueOn) };
}

function clientVideoRow(v) {
  var st = clientsVidStatus(v);
  var m = (v.title || '').match(/Видео\s+\d+\s*[-–—]\s*(.+)$/i);
  var label = v.videoNumber ? ('Видео ' + v.videoNumber + ' — ' + (m ? m[1] : '')) : (v.title || '');
  return '<a class="cl-vid" href="' + (v.url || '#') + '" target="_blank" rel="noopener">' +
    '<span class="cl-dot ' + st.cls + '"></span>' +
    '<span class="cl-vid__t">' + esc(label) + '</span>' +
    '<span class="cl-vid__stage">' + esc(clientStageShort(v.boardRole)) + (v.column ? ' / ' + esc(v.column) : '') + '</span>' +
    '<span class="cl-vid__st ' + st.cls + '">' + esc(st.text) + '</span>' +
  '</a>';
}

function clientPlanHtml(p) {
  var pc = p.planCard, status;
  if (!pc) status = '<span class="cl-pill cl-pill--muted">няма карта в Pre-Production</span>';
  else if (pc.planOverdue) status = '<span class="cl-pill cl-pill--danger">⚠ просрочен · нефинализиран</span><span class="cl-pill__meta">' + esc(pc.column || '') + (pc.dueOn ? ' · срок ' + clFmt(pc.dueOn) : '') + '</span>';
  else if (!pc.finalized) status = '<span class="cl-pill cl-pill--warn">в процес · нефинализиран</span><span class="cl-pill__meta">' + esc(pc.column || '') + (pc.dueOn ? ' · срок ' + clFmt(pc.dueOn) : '') + '</span>';
  else status = '<span class="cl-pill cl-pill--ok">✓ финализиран</span>';

  var vids = (p.videos || []).filter(function (v) { return !v.isDoneColumn && !v.completed; });
  var doneN = (p.videos || []).length - vids.length;
  var list = vids.length ? vids.map(clientVideoRow).join('') : '<div class="cl-vid-empty">няма активни видеа</div>';
  return '<div class="cl-plan">' +
    '<div class="cl-plan__hdr"><span class="cl-plan__kp">КП-' + p.kp + '</span>' + status + '</div>' +
    '<div class="cl-stages">' + clientStageTiles(p) + '</div>' +
    '<div class="cl-vids">' + list + (doneN ? '<div class="cl-done-note">+ ' + doneN + ' готови</div>' : '') + '</div>' +
  '</div>';
}

function clientsAuthMsg() {
  return '<div class="cl-err">Трябва да влезеш през Basecamp, за да видиш клиентите.</div>';
}
