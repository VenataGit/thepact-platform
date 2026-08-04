// ==================== НАСТРОЙКИ → ЕКИП И РОЛИ ====================
// Само за пълен админ. Четири блока:
//   1. Екипът от Basecamp (Video Production) — обновява се сам всеки ден; тук се
//      задава позицията на всеки човек.
//   2. Позиции — коя позиция отговаря за контент плановете (тези хора се тагват
//      автоматично в коментара под всяка нова КП карта).
//   3. Одобрени имейли — whitelist: човек с такъв имейл влиза, без да е в екипа
//      в Basecamp.
//   4. Профили в платформата — кой може да влиза; оттук се трият тестови акаунти.

var _tm = null; // { people, positions, users, approved, syncedAt, syncTime, myUserId }

function sgSectionTeam(host) {
  host.innerHTML = '<div class="sg-section"><div class="ga-loading">Зареждане…</div></div>';
  tmLoad();
}

async function tmLoad() {
  var host = document.getElementById('sgBody');
  if (!host) return;
  try {
    var res = await fetch('/api/team/overview');
    var j = await res.json();
    if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
    _tm = j;
    tmRender();
  } catch (e) {
    host.innerHTML = '<div class="sg-section"><div style="color:var(--red);font-size:13px">Грешка при зареждане: ' + esc(e.message) + '</div></div>';
  }
}

function tmDateTime(v) {
  if (!v) return 'още не е зареждан';
  return new Date(v).toLocaleString('bg-BG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function tmPositionOpts(selected) {
  var opts = '<option value="">— без позиция —</option>';
  (_tm.positions || []).forEach(function (p) {
    opts += '<option value="' + p.id + '"' + (String(selected) === String(p.id) ? ' selected' : '') + '>' +
      esc(p.name) + (p.kp_responsible ? ' ★' : '') + '</option>';
  });
  return opts;
}

function tmRender() {
  var host = document.getElementById('sgBody');
  if (!host || !_tm) return;
  var people = _tm.people || [];
  var active = people.filter(function (p) { return p.active; });
  var html = '';

  // ---------- 1. Екип от Basecamp ----------
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">👥 Екип от Basecamp</div>' +
    '<div class="sg-section__desc">Всички с достъп до проекта <strong>Video Production</strong> — това е екипът на The Pact. ' +
      'Списъкът се обновява автоматично всеки ден, така че нов човек в Basecamp се появява тук сам. ' +
      'Клиентите и ботовете не влизат. ★ = позицията отговаря за контент плановете.</div>' +
    '<div class="ga-team">' +
      '<span>Активни: <strong>' + active.length + ' души</strong> · <span class="ga-dim">обновен ' + esc(tmDateTime(_tm.syncedAt)) + '</span></span>' +
      '<span style="display:flex;align-items:center;gap:6px">' +
        '<span class="ga-dim">дневен sync в</span>' +
        '<input type="time" class="ga-input" style="flex:0 0 108px;min-width:108px" id="tmSyncTime" value="' + esc(_tm.syncTime || '07:30') + '" onchange="tmSaveSyncTime(this.value)">' +
        '<button class="ga-btn" onclick="tmRefresh(this)">🔄 Обнови сега</button>' +
      '</span>' +
    '</div>';

  if (!people.length) {
    html += '<div class="ga-empty" style="color:var(--yellow);margin-top:12px">Няма заредени хора — натисни „Обнови сега". Ако пак е празно, ботът ThePactAlerts няма достъп до Video Production.</div>';
  } else {
    html += '<div class="tm-table-wrap"><table class="tm-table">' +
      '<thead><tr><th>Човек</th><th>Имейл</th><th>Позиция</th><th>Профил</th></tr></thead><tbody>';
    people.forEach(function (p) {
      var av = p.avatar_url
        ? '<img class="tm-avatar" src="' + esc(p.avatar_url) + '" alt="">'
        : '<span class="tm-avatar tm-avatar--ph">' + esc((p.name || '?').charAt(0)) + '</span>';
      var badge = p.kp_responsible ? ' <span class="tm-badge" title="Тагва се в новите КП карти">КП</span>' : '';
      var prof = p.platform_user_id
        ? (p.platform_active === false
            ? '<span class="ga-dim">деактивиран</span>'
            : '<span style="color:var(--green)">✓</span> <span class="ga-dim">' + esc(p.platform_role || '') + '</span>')
        : '<span class="ga-dim">няма</span>';
      html += '<tr' + (p.active ? '' : ' class="tm-row--off"') + '>' +
        '<td>' + av + '<span class="tm-name">' + esc(p.name || '') + badge +
          (p.title ? '<span class="tm-title">' + esc(p.title) + '</span>' : '') +
          (p.active ? '' : '<span class="tm-title">вече не е в проекта</span>') + '</span></td>' +
        '<td class="tm-mail">' + esc(p.email || '—') + '</td>' +
        '<td><select class="ga-select" onchange="tmSetPosition(' + p.person_id + ', this.value)">' + tmPositionOpts(p.position_id) + '</select></td>' +
        '<td>' + prof + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';

  // ---------- 2. Позиции ----------
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">🏷️ Позиции</div>' +
    '<div class="sg-section__desc">Чекнатата позиция значи „тези хора правят контент плановете" — всички с нея се тагват автоматично в коментара под всяка нова КП карта.</div>';
  if (!(_tm.positions || []).length) {
    html += '<div class="ga-empty">Няма създадени позиции.</div>';
  } else {
    html += '<div class="tm-table-wrap"><table class="tm-table">' +
      '<thead><tr><th>Позиция</th><th>Описание</th><th>Хора</th><th>Прави КП</th><th></th></tr></thead><tbody>';
    _tm.positions.forEach(function (p) {
      html += '<tr>' +
        '<td><span class="tm-name">' + esc(p.name) + '</span></td>' +
        '<td class="tm-mail">' + esc(p.description || '—') + '</td>' +
        '<td>' + (p.people_count || 0) + '</td>' +
        '<td><input type="checkbox" style="accent-color:var(--accent);width:16px;height:16px"' +
          (p.kp_responsible ? ' checked' : '') + ' onchange="tmTogglePositionKp(' + p.id + ', this.checked)"></td>' +
        '<td><button class="ga-btn ga-btn--del" onclick="tmDeletePosition(' + p.id + ', \'' + esc(p.name).replace(/'/g, "\\'") + '\')">✕</button></td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '<div class="ga-row">' +
      '<input type="text" class="ga-input" id="tmNewPosName" placeholder="Име на нова позиция…" style="max-width:220px">' +
      '<input type="text" class="ga-input" id="tmNewPosDesc" placeholder="Описание (по избор)…">' +
      '<button class="btn btn-sm" onclick="tmNewPosition()">Добави</button>' +
    '</div>' +
  '</div>';

  // ---------- 3. Одобрени имейли ----------
  // Whitelist: човек с този имейл влиза, без да е нужно първо да го добавят
  // във Video Production в Basecamp.
  var approved = _tm.approved || [];
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">✅ Одобрени имейли</div>' +
    '<div class="sg-section__desc">Нов човек, който още не е в проекта <strong>Video Production</strong> (или е заведен като клиент/гост в Basecamp), иначе получава „Нямаш достъп". ' +
      'Добави тук имейла, <strong>с който е регистриран Basecamp акаунтът му</strong> — оттам нататък влиза нормално през „Влез с Basecamp" и профилът му се създава сам при първото влизане. ' +
      'Само пълен админ вижда и променя този списък.</div>';
  if (!approved.length) {
    html += '<div class="ga-empty">Няма одобрени имейли — достъпът се решава само от Basecamp.</div>';
  } else {
    html += '<div class="tm-table-wrap"><table class="tm-table">' +
      '<thead><tr><th>Имейл</th><th>Бележка</th><th>Добавен от</th><th>Влизал ли е</th><th></th></tr></thead><tbody>';
    approved.forEach(function (a) {
      var used = a.platform_user_id
        ? '<span style="color:var(--green)">✓</span> <span class="ga-dim">' + esc(a.platform_name || '') + '</span>'
        : (a.last_login_at ? '<span class="ga-dim">' + esc(tmDateTime(a.last_login_at)) + '</span>' : '<span class="ga-dim">още не</span>');
      html += '<tr>' +
        '<td class="tm-mail">' + esc(a.email) + '</td>' +
        '<td class="tm-mail">' + esc(a.note || '—') + '</td>' +
        '<td class="tm-mail">' + esc(a.added_by_name || '—') + ' <span class="ga-dim">· ' + esc(tmDateTime(a.created_at)) + '</span></td>' +
        '<td>' + used + '</td>' +
        '<td><button class="ga-btn ga-btn--del" onclick="tmDeleteApproved(' + a.id + ', \'' + esc(a.email).replace(/'/g, "\\'") + '\')">✕</button></td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '<div class="ga-row">' +
      '<input type="email" class="ga-input" id="tmNewApprovedEmail" placeholder="имейл от Basecamp…" style="max-width:260px">' +
      '<input type="text" class="ga-input" id="tmNewApprovedNote" placeholder="Кой е човекът (по избор)…">' +
      '<button class="btn btn-sm" onclick="tmAddApproved()">Одобри</button>' +
    '</div>' +
  '</div>';

  // ---------- 4. Профили в платформата ----------
  // Ролята и активността се сменят тук (преди бяха само в стария „Разширени" панел).
  var users = _tm.users || [];
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">🔑 Профили в платформата</div>' +
    '<div class="sg-section__desc">Кой може да влиза в thepact.pro и с какви права. Различно от екипа горе — човек от Basecamp няма профил, докато не влезе поне веднъж. ' +
      '<strong>Админ</strong> вижда и променя всички настройки, <strong>мини админ</strong> — всичко без правата на другите админи. ' +
      'Изтриването е окончателно и работи само за профили без създадено съдържание (иначе остава деактивиране).</div>' +
    '<div class="tm-table-wrap"><table class="tm-table">' +
      '<thead><tr><th>Име</th><th>Имейл</th><th>Роля</th><th>Статус</th><th>Последно влизане</th><th></th></tr></thead><tbody>';
  users.forEach(function (u) {
    var isMe = String(u.id) === String(_tm.myUserId);
    var del = (isMe || u.role === 'admin')
      ? '<span class="ga-dim" title="' + (isMe ? 'Собственият ти профил' : 'Първо смени ролята') + '">—</span>'
      : '<button class="ga-btn ga-btn--del" onclick="tmDeleteUser(' + u.id + ', \'' + esc(u.name || u.email).replace(/'/g, "\\'") + '\')">🗑</button>';
    // Собствената роля не се пипа оттук — иначе човек може да се самозаключи.
    var roleCell = isMe
      ? '<span class="tm-mail">' + esc(u.role || '') + '</span>'
      : '<select class="ga-select" onchange="tmSetRole(' + u.id + ', this.value)">' + tmRoleOpts(u.role) + '</select>';
    var statusCell = isMe
      ? '<span style="color:var(--green)">активен</span>'
      : '<button class="ga-btn" onclick="tmToggleActive(' + u.id + ', ' + (u.is_active ? 'false' : 'true') + ')">' +
          (u.is_active ? '<span style="color:var(--green)">активен</span>' : '<span class="ga-dim">деактивиран</span>') + '</button>';
    html += '<tr' + (u.is_active ? '' : ' class="tm-row--off"') + '>' +
      '<td><span class="tm-name">' + esc(u.name || '') + (isMe ? ' <span class="ga-dim">(ти)</span>' : '') + '</span></td>' +
      '<td class="tm-mail">' + esc(u.email || '') + '</td>' +
      '<td>' + roleCell + (u.has_basecamp ? ' <span class="ga-dim">· Basecamp</span>' : '') + '</td>' +
      '<td>' + statusCell + '</td>' +
      '<td class="tm-mail">' + (u.last_login_at ? esc(tmDateTime(u.last_login_at)) : '—') + '</td>' +
      '<td>' + del + '</td>' +
    '</tr>';
  });
  html += '</tbody></table></div>' +
    '<div class="ga-row">' +
      '<button class="btn btn-sm" onclick="tmNewUser()">+ Нов профил</button>' +
      '<span class="ga-dim">за човек без Basecamp — влиза с имейл и парола</span>' +
    '</div>' +
  '</div>';

  host.innerHTML = html;
}

var TM_ROLES = [
  { v: 'member', label: 'Член' },
  { v: 'moderator', label: 'Модератор' },
  { v: 'mini_admin', label: 'Мини админ' },
  { v: 'admin', label: 'Админ' },
];

function tmRoleOpts(selected) {
  return TM_ROLES.map(function (r) {
    return '<option value="' + r.v + '"' + (r.v === selected ? ' selected' : '') + '>' + r.label + '</option>';
  }).join('');
}

// ---------- действия ----------

function tmRefresh(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳…'; }
  _gaCall('/api/team/refresh', 'POST')
    .then(function (r) {
      var extra = (r.added && r.added.length ? ' · нови: ' + r.added.join(', ') : '') +
        (r.deactivated && r.deactivated.length ? ' · извън екипа: ' + r.deactivated.join(', ') : '');
      showToast('Екипът е обновен: ' + r.count + ' души' + extra, 'success', 7000);
      tmLoad();
    })
    .catch(function (e) { showToast('Грешка: ' + e.message, 'error', 7000); })
    .finally(function () { if (btn) { btn.disabled = false; btn.textContent = '🔄 Обнови сега'; } });
}

function tmSaveSyncTime(v) {
  _gaCall('/api/team/config', 'PUT', { syncTime: v })
    .then(function () { showToast('Дневният sync е в ' + v + ' ✓', 'success', 2000); })
    .catch(function (e) { showToast(e.message, 'error'); tmLoad(); });
}

function tmSetPosition(personId, positionId) {
  _gaCall('/api/team/people/' + personId, 'PUT', { position_id: positionId || null })
    .then(function () { showToast('Позицията е запазена ✓', 'success', 1500); tmLoad(); })
    .catch(function (e) { showToast(e.message, 'error'); tmLoad(); });
}

function tmTogglePositionKp(posId, on) {
  _gaCall('/api/positions/' + posId, 'PUT', { kp_responsible: on })
    .then(function () {
      showToast(on ? 'Тази позиция вече се тагва в новите КП карти.' : 'Позицията вече не се тагва в КП картите.', 'success');
      tmLoad();
    })
    .catch(function (e) { showToast(e.message, 'error'); tmLoad(); });
}

function tmNewPosition() {
  var nameEl = document.getElementById('tmNewPosName');
  var descEl = document.getElementById('tmNewPosDesc');
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) { if (nameEl) nameEl.focus(); return; }
  _gaCall('/api/positions', 'POST', { name: name, description: descEl ? descEl.value.trim() : '' })
    .then(function () { showToast('Позицията е създадена ✓', 'success'); tmLoad(); })
    .catch(function (e) { showToast(e.message, 'error'); });
}

function tmDeletePosition(posId, name) {
  showConfirmModal('Да изтрия ли позицията „' + name + '"? Хората с нея остават без позиция.', function () {
    _gaCall('/api/positions/' + posId, 'DELETE')
      .then(function () { showToast('Позицията е изтрита.', 'success'); tmLoad(); })
      .catch(function (e) { showToast(e.message, 'error'); });
  }, true);
}

function tmAddApproved() {
  var mailEl = document.getElementById('tmNewApprovedEmail');
  var noteEl = document.getElementById('tmNewApprovedNote');
  var email = mailEl ? mailEl.value.trim() : '';
  if (!email) { if (mailEl) mailEl.focus(); return; }
  _gaCall('/api/team/approved', 'POST', { email: email, note: noteEl ? noteEl.value.trim() : '' })
    .then(function () {
      showToast('Готово — ' + email + ' вече може да влезе с „Влез с Basecamp".', 'success', 5000);
      tmLoad();
    })
    .catch(function (e) { showToast(e.message, 'error', 6000); });
}

function tmDeleteApproved(id, email) {
  showConfirmModal('Да махна ли „' + email + '" от одобрените? Ако човекът не е в екипа в Basecamp, следващия път няма да може да влезе. Създаденият профил остава.', function () {
    _gaCall('/api/team/approved/' + id, 'DELETE')
      .then(function () { showToast('Имейлът е махнат от одобрените.', 'success'); tmLoad(); })
      .catch(function (e) { showToast(e.message, 'error'); });
  }, true);
}

function tmSetRole(userId, role) {
  _gaCall('/api/users/' + userId + '/role', 'PUT', { role: role })
    .then(function () { showToast('Ролята е запазена ✓', 'success', 2000); tmLoad(); })
    .catch(function (e) { showToast(e.message, 'error', 6000); tmLoad(); });
}

function tmToggleActive(userId, active) {
  _gaCall('/api/users/' + userId + '/active', 'PUT', { is_active: active })
    .then(function () { showToast(active ? 'Профилът е активиран.' : 'Профилът е деактивиран.', 'success'); tmLoad(); })
    .catch(function (e) { showToast(e.message, 'error', 6000); tmLoad(); });
}

// Ръчно създаване на профил (за хора без Basecamp) — беше в стария панел.
function tmNewUser() {
  var ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box">' +
    '<p class="confirm-modal-msg">Нов профил</p>' +
    '<input class="confirm-modal-input" id="tmNuName" placeholder="Име…">' +
    '<input class="confirm-modal-input" type="email" id="tmNuEmail" placeholder="Имейл…">' +
    '<input class="confirm-modal-input" type="password" id="tmNuPass" placeholder="Парола…">' +
    '<div class="confirm-modal-actions">' +
      '<button class="btn btn-primary" id="tmNuOk">Създай</button>' +
      '<button class="btn btn-ghost" id="tmNuCancel">Откажи</button>' +
    '</div></div>';
  document.body.appendChild(ov);
  setTimeout(function () { ov.querySelector('#tmNuName').focus(); }, 50);
  ov.querySelector('#tmNuOk').onclick = function () {
    var name = ov.querySelector('#tmNuName').value.trim();
    var email = ov.querySelector('#tmNuEmail').value.trim();
    var password = ov.querySelector('#tmNuPass').value;
    if (!name) { ov.querySelector('#tmNuName').focus(); return; }
    if (!email) { ov.querySelector('#tmNuEmail').focus(); return; }
    if (!password) { ov.querySelector('#tmNuPass').focus(); return; }
    ov.remove();
    _gaCall('/api/users', 'POST', { name: name, email: email, password: password })
      .then(function () { showToast('Профилът е създаден ✓', 'success'); tmLoad(); })
      .catch(function (e) { showToast('Грешка: ' + e.message, 'error', 6000); });
  };
  ov.querySelector('#tmNuCancel').onclick = function () { ov.remove(); };
  ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
  ov.querySelector('#tmNuName').onkeydown = function (e) { if (e.key === 'Escape') ov.remove(); };
}

function tmDeleteUser(userId, name) {
  showConfirmModal('Да изтрия ли окончателно профила на „' + name + '"? Това не може да се върне.', function () {
    _gaCall('/api/users/' + userId, 'DELETE')
      .then(function () { showToast('Профилът е изтрит.', 'success'); tmLoad(); })
      .catch(function (e) { showToast(e.message, 'error', 8000); });
  }, true);
}
