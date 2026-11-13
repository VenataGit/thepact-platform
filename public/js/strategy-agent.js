// ==================== КОНТЕНТ СТРАТЕГИЯ АГЕНТ (#/strategy) ====================
// Клиентските проекти от Basecamp (новите се засичат сами) → човек пуска агента →
// стратегия като документ в Video Production → Клиентски карти → папката на клиента.
//   #/strategy            — всички проекти (новите и чакащите отгоре)
//   #/strategy/p/49469953 — един проект: пускане + история
//   #/strategy/run/12     — едно пускане: стъпките и готовата стратегия
//   #/strategy/admin      — админ меню: скриване/триене на проекти, които не са клиенти
// Стиловете са на Content агента (content-agent.css, класовете ca-*).
var _cs = { poll: null, showDone: true, showHidden: false };
var CS_STATUS = { queued: 'чака', running: 'работи…', done: 'готово', error: 'грешка' };

function csRoute(el, parts) {
  if (_cs.poll) { clearTimeout(_cs.poll); _cs.poll = null; }
  if (parts[1] === 'admin') return renderStrategyAdmin(el);
  if (parts[1] === 'run') return renderStrategyRun(el, parseInt(parts[2], 10));
  if (parts[1] === 'p' && parts[2]) return renderStrategyProject(el, String(parts[2]).replace(/\D/g, ''));
  return renderStrategyList(el);
}

function csShell(el, title, sub, back) {
  setBreadcrumb([{ label: 'Стратегия', href: '#/strategy' }]);
  el.className = 'flush-top full-width';
  el.innerHTML = '<div class="ca-wrap">' +
    (back ? '<a class="ca-back" href="' + back + '">← назад</a>' : '') +
    '<div class="ca-head"><h1 class="ca-head__t">' + title + '</h1>' + (sub ? '<div class="ca-head__s">' + sub + '</div>' : '') + '</div>' +
    '<div id="caBody"><div class="ca-dim">Зареждам…</div></div></div>';
}

async function csApi(method, url, body) {
  var res = await fetch('/api/strategy-agent' + url, {
    method: method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  var data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(data.error || ('Грешка ' + res.status));
  return data;
}

function csPlan(plan) {
  if (!plan) return '';
  var a = [];
  if (plan.videos) a.push(plan.videos + ' видеа');
  if (plan.statics) a.push(plan.statics + ' статични');
  if (plan.performance) a.push('реклами');
  if (plan.consulting) a.push('консултация');
  return a.join(' · ');
}

// ---------- списък ----------

async function renderStrategyList(el) {
  csShell(el, '🧭 Контент стратегия',
    'Новите клиентски проекти в Basecamp се добавят тук сами като <strong>чакащи стратегия</strong>. Отвори клиента и пусни агента — ' +
    'той чете всичко от проекта и картата на клиента и качва стратегията в <strong>Video Production → Клиентски карти → папката на клиента</strong>.');
  try {
    var d = await csApi('GET', '/projects');
    var list = d.projects.filter(function (p) { return _cs.showHidden || !p.hidden; });
    var groups = [
      ['🆕 Нови клиенти — чакат стратегия', list.filter(function (p) { return p.is_new && p.status !== 'done'; })],
      ['Без стратегия', list.filter(function (p) { return !p.is_new && p.status !== 'done'; })],
      ['✅ Със стратегия', list.filter(function (p) { return p.status === 'done'; })],
    ];
    var hiddenN = d.projects.filter(function (p) { return p.hidden; }).length;
    var html = '<div class="ca-toolbar"><input class="ca-input ca-search" id="caSearch" placeholder="Търси клиент…" oninput="csFilter()">' +
      '<span class="ca-spacer"></span>' +
      (caIsAdmin() && hiddenN ? '<label class="ca-check ca-check--inline"><input type="checkbox"' + (_cs.showHidden ? ' checked' : '') + ' onchange="_cs.showHidden=this.checked;router()"> Покажи скритите (' + hiddenN + ')</label>' : '') +
      '<button class="btn btn-ghost btn-sm" onclick="csDetect()">↻ Провери за нови проекти</button>' +
      (caIsAdmin() ? '<a class="btn btn-ghost btn-sm" href="#/strategy/admin">⚙ Админ</a>' : '') + '</div>';
    if (!d.projects.length) html += '<div class="ca-panel ca-dim">Още няма засечени проекти — първото засичане е до минута след старта на сървъра. Натисни „Провери за нови проекти".</div>';
    groups.forEach(function (g) {
      if (!g[1].length) return;
      html += '<h2 class="ca-panel__t" style="margin:18px 0 8px">' + esc(g[0]) + ' · ' + g[1].length + '</h2><div class="ca-grid">';
      g[1].forEach(function (p) {
        var lr = p.last_run;
        html += '<a class="ca-client' + (p.hidden ? ' ca-client--off' : '') + '" href="#/strategy/p/' + esc(p.project_id) + '" data-name="' + esc((p.client + ' ' + p.name).toLowerCase()) + '">' +
          '<div class="ca-client__n">' + esc(p.client) +
            (caIsAdmin() ? '<button class="ca-x ca-client__hide" onclick="csHide(event,\'' + esc(p.project_id) + '\',' + (p.hidden ? 'false' : 'true') + ')">' + (p.hidden ? 'покажи' : 'скрий') + '</button>' : '') + '</div>' +
          '<div class="ca-client__m"><span>' + esc(csPlan(p.plan) || p.name) + '</span></div>' +
          '<div class="ca-client__s">' + (lr ? '<span class="ca-st ca-st--' + esc(lr.status) + '">' + esc(CS_STATUS[lr.status] || lr.status) + '</span> ' + esc(caDate(lr.created_at)) : 'засечен ' + esc(caDate(p.detected_at))) + '</div>' +
        '</a>';
      });
      html += '</div>';
    });
    caBody(html);
  } catch (e) { caBody('<div class="ca-err">' + esc(e.message) + '</div>'); }
}

function csFilter() {
  var q = (document.getElementById('caSearch').value || '').toLowerCase().trim();
  document.querySelectorAll('.ca-client').forEach(function (a) { a.style.display = !q || a.getAttribute('data-name').indexOf(q) >= 0 ? '' : 'none'; });
}

async function csDetect() {
  try {
    var r = await csApi('POST', '/detect');
    showToast(r.added ? 'Добавени: ' + r.added : 'Няма нови проекти', 'success');
    router();
  } catch (e) { showToast(e.message, 'error'); }
}

async function csHide(ev, pid, hidden) {
  ev.preventDefault(); ev.stopPropagation();
  try { await csApi('PATCH', '/projects/' + pid, { hidden: hidden }); router(); } catch (e) { showToast(e.message, 'error'); }
}

// ---------- админ меню ----------
// Всички засечени проекти. „Изтрий" = не е клиент (вътрешен проект и т.н.) — не излиза
// никъде, дори в скритите, и засичането не го връща. „Възстанови" го връща.

async function renderStrategyAdmin(el) {
  csShell(el, '⚙ Контент стратегия — админ',
    'Проектите, които агентът е засякъл в Basecamp. Изтрий тези, които не са клиенти (вътрешни проекти и т.н.) — няма да излизат никъде и няма да се появят пак. ' +
    'Пусканията им остават и проектът може да се възстанови от „Изтрити".', '#/strategy');
  if (!caIsAdmin()) { caBody('<div class="ca-err">Само за админ.</div>'); return; }
  try {
    var d = await csApi('GET', '/admin/projects');
    var live = d.projects.filter(function (p) { return !p.removed; });
    var gone = d.projects.filter(function (p) { return p.removed; });
    var row = function (p) {
      return '<tr data-name="' + esc((p.client + ' ' + p.name).toLowerCase()) + '"><td><strong>' + esc(p.client) + '</strong></td>' +
        '<td class="ca-cap">' + esc(p.name) + (p.bc_active ? '' : ' <span class="ca-dim">(архивиран в Basecamp)</span>') + '</td>' +
        '<td>' + (p.status === 'done' ? '✅ има стратегия' : 'без стратегия') + (p.runs ? ' · ' + p.runs + ' пускания' : '') + '</td>' +
        '<td class="ca-nowrap">' + (p.removed
          ? '<span class="ca-dim">изтрит' + (p.removed_by ? ' от ' + esc(p.removed_by) : '') + ' ' + esc(caDate(p.removed_at)) + '</span> ' +
            '<button class="btn btn-ghost btn-sm" onclick="csRestore(\'' + esc(p.project_id) + '\')">Възстанови</button>'
          : '<button class="btn btn-ghost btn-sm" onclick="csHide(event,\'' + esc(p.project_id) + '\',' + (p.hidden ? 'false' : 'true') + ')">' + (p.hidden ? 'Покажи' : 'Скрий') + '</button> ' +
            '<button class="btn btn-ghost btn-sm" style="color:var(--card-red,#c66)" onclick="csRemove(\'' + esc(p.project_id) + '\',' + jsq(p.client) + ')">🗑 Изтрий</button>') + '</td></tr>';
    };
    var table = function (rows) {
      return '<table class="ca-table"><thead><tr><th>Клиент</th><th>Проект в Basecamp</th><th>Стратегия</th><th></th></tr></thead><tbody>' + rows.map(row).join('') + '</tbody></table>';
    };
    caBody('<div class="ca-toolbar"><input class="ca-input ca-search" id="csAdmSearch" placeholder="Търси проект…" oninput="csAdmFilter()"><span class="ca-spacer"></span>' +
      '<button class="btn btn-ghost btn-sm" onclick="csDetect()">↻ Провери за нови проекти</button></div>' +
      '<div class="ca-panel"><div class="ca-panel__t">Проекти · ' + live.length + '</div>' + (live.length ? table(live) : '<div class="ca-dim">Няма.</div>') + '</div>' +
      (gone.length ? '<div class="ca-panel"><div class="ca-panel__t">🗑 Изтрити · ' + gone.length + '</div>' + table(gone) + '</div>' : ''));
  } catch (e) { caBody('<div class="ca-err">' + esc(e.message) + '</div>'); }
}

function csAdmFilter() {
  var q = (document.getElementById('csAdmSearch').value || '').toLowerCase().trim();
  document.querySelectorAll('.ca-table tbody tr').forEach(function (tr) { tr.style.display = !q || tr.getAttribute('data-name').indexOf(q) >= 0 ? '' : 'none'; });
}

async function csRemove(pid, name) {
  if (!confirm('Да изтрия ли „' + name + '" от Контент стратегия? Няма да излиза никъде (и в скритите), а засичането няма да го върне. Може да се възстанови от „Изтрити".')) return;
  try { await csApi('DELETE', '/projects/' + pid); showToast('Изтрит', 'success'); router(); } catch (e) { showToast(e.message, 'error'); }
}

async function csRestore(pid) {
  try { await csApi('POST', '/projects/' + pid + '/restore'); showToast('Възстановен', 'success'); router(); } catch (e) { showToast(e.message, 'error'); }
}

// ---------- един проект ----------

async function renderStrategyProject(el, pid) {
  csShell(el, '🧭 Контент стратегия', '', '#/strategy');
  try {
    var p = await csApi('GET', '/projects/' + pid);
    var t = document.querySelector('.ca-head__t');
    if (t) t.textContent = '🧭 ' + p.client;
    var busy = p.runs.some(function (r) { return r.status === 'queued' || r.status === 'running'; });
    var html = '<div class="ca-cols"><div class="ca-panel">' +
      '<div class="ca-runmeta">Basecamp проект: <a href="https://3.basecamp.com/5750544/projects/' + esc(p.project_id) + '" target="_blank" rel="noopener">' + esc(p.name) + '</a>' +
        (csPlan(p.plan) ? ' · пакет: ' + esc(csPlan(p.plan)) : '') +
        (p.doc_url ? ' · <a href="' + esc(p.doc_url) + '" target="_blank" rel="noopener">📄 стратегията в Клиентски карти</a>' : '') + '</div>';
    if (!p.runs.length) html += '<div class="ca-dim">Още няма пускания.</div>';
    else {
      html += '<table class="ca-table"><thead><tr><th>#</th><th>Кога</th><th>Кой</th><th>Бележки</th><th>Статус</th></tr></thead><tbody>';
      p.runs.forEach(function (r) {
        html += '<tr class="ca-click" onclick="location.hash=\'#/strategy/run/' + r.id + '\'"><td>' + r.id + '</td><td>' + esc(caDate(r.created_at)) + '</td><td>' + esc(r.requested_by || '') + '</td>' +
          '<td class="ca-cap">' + esc(String(r.notes || r.error || '').slice(0, 120)) + '</td>' +
          '<td><span class="ca-st ca-st--' + esc(r.status) + '">' + esc(CS_STATUS[r.status] || r.status) + '</span></td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div><div class="ca-side"><div class="ca-panel ca-form"><div class="ca-panel__t">Пусни агента</div>' +
      '<label>Име на клиента (папката в „Клиентски карти")<input class="ca-input" id="csName" value="' + esc(p.client) + '" placeholder="' + esc(p.client) + '"></label>' +
      '<label>Бележки за агента (по избор)<textarea class="ca-input ca-textarea" id="csNotes" rows="5" placeholder="Напр. какво се разбрахме на първия разговор, какво иска клиентът, какво да избягваме…"></textarea></label>' +
      '<button class="btn btn-primary" id="csRunBtn"' + (busy ? ' disabled' : '') + ' onclick="csRun(\'' + esc(p.project_id) + '\')">' + (busy ? 'Агентът работи…' : (p.status === 'done' ? 'Направи нова стратегия' : 'Направи стратегия')) + '</button>' +
      '<div class="ca-hint">Чете съобщенията, документите, файловете, задачите и чата в проекта + картата на клиента. Обикновено 10-25 мин. ' +
        'При ново пускане документът в Basecamp се презаписва (Basecamp пази старите версии).</div>' +
      '</div></div></div>';
    caBody(html);
  } catch (e) { caBody('<div class="ca-err">' + esc(e.message) + '</div>'); }
}

async function csRun(pid) {
  var btn = document.getElementById('csRunBtn');
  if (btn) btn.disabled = true;
  try {
    var name = (document.getElementById('csName').value || '').trim();
    await csApi('PATCH', '/projects/' + pid, { client_name: name });
    var r = await csApi('POST', '/projects/' + pid + '/run', { notes: document.getElementById('csNotes').value || '' });
    location.hash = '#/strategy/run/' + r.id;
  } catch (e) { showToast(e.message, 'error'); if (btn) btn.disabled = false; }
}

// ---------- едно пускане ----------

function csList(arr, fn) {
  arr = (arr || []).filter(function (x) { return x != null && x !== ''; });
  return arr.length ? '<ul>' + arr.map(function (x) { return '<li>' + (fn ? fn(x) : esc(x)) + '</li>'; }).join('') + '</ul>' : '';
}
function csSec(title, body) { return body ? '<div class="ca-panel"><div class="ca-panel__t">' + esc(title) + '</div>' + body + '</div>' : ''; }

function csStrategyHtml(res) {
  var st = res.strategy || {};
  var mix = st.content_mix || {};
  var tone = st.tone || {};
  return csSec('Накратко', st.summary ? '<div>' + esc(st.summary) + '</div>' : '') +
    csSec('Цели', csList(st.goals, function (g) { return '<strong>' + esc(g.goal) + '</strong>' + (g.how_we_measure ? ' — ' + esc(g.how_we_measure) : ''); })) +
    csSec('Аудитория', csList(st.audience, function (a) {
      return '<strong>' + esc(a.segment) + '</strong>' + (a.pains && a.pains.length ? '<br>Болки: ' + esc(a.pains.join('; ')) : '') +
        (a.desires && a.desires.length ? '<br>Иска: ' + esc(a.desires.join('; ')) : '') + (a.where ? '<br>Къде/кога: ' + esc(a.where) : '');
    })) +
    csSec('Позициониране', st.positioning ? '<div>' + esc(st.positioning) + '</div>' : '') +
    csSec('Стълбове на съдържанието', csList(st.pillars, function (x) {
      return '<strong>' + esc(x.name) + '</strong>' + (x.share_pct ? ' (' + esc(x.share_pct) + '%)' : '') + ' — ' + esc(x.why || '') +
        (x.topics && x.topics.length ? '<br>Теми: ' + esc(x.topics.join('; ')) : '') + (x.formats && x.formats.length ? '<br>Формати: ' + esc(x.formats.join(', ')) : '');
    })) +
    csSec('Обем и микс на месец', (mix.videos_per_month || (mix.split && mix.split.length)) ?
      '<div>' + esc([mix.videos_per_month ? mix.videos_per_month + ' видеа' : '', mix.static_per_month ? mix.static_per_month + ' статични поста' : '', mix.ads ? 'реклами: ' + mix.ads : ''].filter(Boolean).join(' · ')) + '</div>' +
      csList(mix.split, function (x) { return '<strong>' + esc(x.type) + '</strong> × ' + esc(x.count) + ' — ' + esc(x.purpose || ''); }) : '') +
    csSec('Платформи', csList(st.platforms, function (x) { return '<strong>' + esc(x.platform) + '</strong> — ' + esc(x.role || '') + (x.frequency ? ' (' + esc(x.frequency) + ')' : ''); })) +
    csSec('Тон', (tone.voice ? '<div>' + esc(tone.voice) + '</div>' : '') + (tone.do && tone.do.length ? '<div><strong>Да:</strong></div>' + csList(tone.do) : '') + (tone.dont && tone.dont.length ? '<div><strong>Не:</strong></div>' + csList(tone.dont) : '')) +
    csSec('Формати', csList(st.formats, function (x) { return '<strong>' + esc(x.name) + '</strong> — ' + esc(x.description || '') + (x.example ? '<br><em>Пример: ' + esc(x.example) + '</em>' : ''); })) +
    csSec('Първият месец', csList(st.first_month)) +
    csSec('Как мерим успеха', csList(st.kpis, function (x) { return '<strong>' + esc(x.metric) + '</strong>' + (x.target_or_note ? ' — ' + esc(x.target_or_note) : ''); })) +
    csSec('Какво работи в нишата', csList(res.market && res.market.patterns, function (x) { return '<strong>' + esc(x.name) + '</strong> — ' + esc(x.how_for_client || x.why_it_works || ''); })) +
    csSec('Конкуренти', csList(res.market && res.market.competitors, function (x) { return '<strong>' + esc(x.name) + '</strong> — ' + esc(x.what_they_do || '') + (x.gap_for_us ? '<br>Нашият шанс: ' + esc(x.gap_for_us) : ''); })) +
    csSec('Рискове', csList(st.risks)) +
    csSec('Допускания (да потвърди клиентът)', csList(st.assumptions)) +
    csSec('Въпроси за срещата', csList(st.questions_for_meeting)) +
    csSec('Липсва ни информация за', csList(res.facts && res.facts.gaps));
}

async function renderStrategyRun(el, rid) {
  csShell(el, '🧭 Стратегия — пускане #' + rid, '', '#/strategy');
  try {
    var r = await csApi('GET', '/runs/' + rid);
    var back = document.querySelector('.ca-back');
    if (back) back.setAttribute('href', '#/strategy/p/' + r.project_id);
    var t = document.querySelector('.ca-head__t');
    if (t) t.textContent = '🧭 ' + r.client + ' — пускане #' + rid;
    var res = r.result || {};
    var html = '<div class="ca-panel"><div class="ca-runmeta"><span class="ca-st ca-st--' + esc(r.status) + '">' + esc(CS_STATUS[r.status] || r.status) + '</span> ' +
      (r.requested_by ? esc(r.requested_by) + ' · ' : '') + esc(caDate(r.created_at)) +
      (r.usage && r.usage.calls ? ' · ' + r.usage.calls + ' AI заявки' : '') +
      (res.doc && res.doc.url ? ' · <a href="' + esc(res.doc.url) + '" target="_blank" rel="noopener">📄 ' + esc(res.doc.title || 'документът') + '</a>' : '') +
      (res.folder && res.folder.url ? ' · <a href="' + esc(res.folder.url) + '" target="_blank" rel="noopener">папката на клиента</a>' : '') + '</div>' +
      (r.notes ? '<div class="ca-req">' + esc(r.notes).replace(/\n/g, '<br>') + '</div>' : '') +
      (r.error ? '<div class="ca-err">' + esc(r.error) + '</div>' : '') + '</div>';
    html += '<div class="ca-cols"><div>';
    if (res.strategy) html += csStrategyHtml(res);
    else if (r.status === 'queued' || r.status === 'running') html += '<div class="ca-panel ca-dim">Агентите работят… страницата се опреснява сама.</div>';
    html += '</div><div class="ca-side"><div class="ca-panel"><div class="ca-panel__t">Стъпки на агентите</div>' + caStepsHtml(r.steps || []) + '</div></div></div>';
    caBody(html);
    if (r.status === 'queued' || r.status === 'running') {
      _cs.poll = setTimeout(function () { if (location.hash === '#/strategy/run/' + rid) renderStrategyRun(el, rid); }, 15000);
    }
  } catch (e) { caBody('<div class="ca-err">' + esc(e.message) + '</div>'); }
}
