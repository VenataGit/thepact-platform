// ==================== НАСТРОЙКИ → ЕКИП И РОЛИ ====================
// Само за пълен админ. Три блока:
//   1. Екипът от Basecamp (Video Production) — обновява се сам всеки ден; тук се
//      задава позицията на всеки човек.
//   2. Позиции — коя позиция отговаря за контент плановете (тези хора се тагват
//      автоматично в коментара под всяка нова КП карта).
//   3. Профили в платформата — кой може да влиза; оттук се трият тестови акаунти.

var _tm = null; // { people, positions, users, syncedAt, syncTime, myUserId }

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

  // ---------- 3. Профили в платформата ----------
  var users = _tm.users || [];
  html += '<div class="sg-section">' +
    '<div class="sg-section__hdr">🔑 Профили в платформата</div>' +
    '<div class="sg-section__desc">Кой може да влиза в thepact.pro. Различно от екипа горе — човек от Basecamp няма профил, докато не влезе поне веднъж. ' +
      'Изтриването е окончателно и работи само за профили без създадено съдържание (иначе остава деактивиране).</div>' +
    '<div class="tm-table-wrap"><table class="tm-table">' +
      '<thead><tr><th>Име</th><th>Имейл</th><th>Роля</th><th>Статус</th><th>Последно влизане</th><th></th></tr></thead><tbody>';
  users.forEach(function (u) {
    var isMe = String(u.id) === String(_tm.myUserId);
    var del = (isMe || u.role === 'admin')
      ? '<span class="ga-dim" title="' + (isMe ? 'Собственият ти профил' : 'Първо смени ролята') + '">—</span>'
      : '<button class="ga-btn ga-btn--del" onclick="tmDeleteUser(' + u.id + ', \'' + esc(u.name || u.email).replace(/'/g, "\\'") + '\')">🗑</button>';
    html += '<tr' + (u.is_active ? '' : ' class="tm-row--off"') + '>' +
      '<td><span class="tm-name">' + esc(u.name || '') + (isMe ? ' <span class="ga-dim">(ти)</span>' : '') + '</span></td>' +
      '<td class="tm-mail">' + esc(u.email || '') + '</td>' +
      '<td class="tm-mail">' + esc(u.role || '') + (u.has_basecamp ? ' <span class="ga-dim">· Basecamp</span>' : '') + '</td>' +
      '<td>' + (u.is_active ? '<span style="color:var(--green)">активен</span>' : '<span class="ga-dim">деактивиран</span>') + '</td>' +
      '<td class="tm-mail">' + (u.last_login_at ? esc(tmDateTime(u.last_login_at)) : '—') + '</td>' +
      '<td>' + del + '</td>' +
    '</tr>';
  });
  html += '</tbody></table></div></div>';

  host.innerHTML = html;
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

function tmDeleteUser(userId, name) {
  showConfirmModal('Да изтрия ли окончателно профила на „' + name + '"? Това не може да се върне.', function () {
    _gaCall('/api/users/' + userId, 'DELETE')
      .then(function () { showToast('Профилът е изтрит.', 'success'); tmLoad(); })
      .catch(function (e) { showToast(e.message, 'error', 8000); });
  }, true);
}
