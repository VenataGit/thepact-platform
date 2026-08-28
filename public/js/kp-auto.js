// ==================== КП АВТОМАТИЗАЦИЯ ====================
var _kpBc = null; // { enabled, boardTitle?, columnTitle?, error? } — дестинацията на КП картите

// Падащото меню при „Нов клиент" се пълни от общия списък с познати имена
// (_clientNames в utils.js): регистърът + живите заглавия в Basecamp. Целта е да не
// се роди втори вариант на едно и също име („Св. Влас" срещу „Свети Влас"), защото
// после КП картите на клиента не се намират.
var _kpEditName = '';     // името, което се редактира — то не се брои за дубликат

// Стандартът на The Pact (Венци, 28.08.2026): 10 видеа през 3 дни. Календарният
// месец е само ориентир — датите се броят от първото видео нататък през 3 дни, а
// следващият КП тръгва 3 дни след последното видео на текущия. Всеки друг клиент
// е „Custom“: сам задаваш брой видеа и през колко дни.
var KP_STD_VIDEOS = 10;
var KP_STD_INTERVAL = 3;

// Режимът не се пази в базата — вади се от самите стойности, за да няма трета
// колона, която да се разминава с тях.
function kpModeOf(c) {
  return (parseInt(c.videos_per_month, 10) === KP_STD_VIDEOS &&
          parseInt(c.publish_interval_days, 10) === KP_STD_INTERVAL) ? 'standard' : 'custom';
}

async function renderKpAuto(el) {
  setBreadcrumb(null);
  el.className = 'full-width';
  el.innerHTML = '<div class="home-content-box home-content-box--wide"><div class="kp-auto-wrap"><div style="text-align:center;padding:40px;color:var(--text-dim)">Зареждане...</div></div></div>';
  await loadKpAuto(el);
}

async function loadKpAuto(el) {
  try {
    const res = await fetch('/api/kp/clients');
    const data = await res.json();
    const clients = data && data.clients;
    if (!res.ok || !Array.isArray(clients)) {
      el.innerHTML = '<div class="home-content-box home-content-box--wide"><div class="kp-auto-wrap"><div style="text-align:center;padding:40px;color:var(--red)">Грешка: ' + esc((data && data.error) || 'Неуспешно зареждане') + '</div></div></div>';
      return;
    }
    _kpBc = data.bc || null;

    var warningHtml = '';
    if (_kpBc && _kpBc.enabled && _kpBc.error) {
      warningHtml += '<div class="kp-warning">' +
        '<span>⚠️</span>' +
        '<span>Basecamp не отговори (' + esc(_kpBc.error) + ') — колоната „има ли КП карта" не може да се провери сега.</span>' +
      '</div>';
    }
    const needsKp = clients.filter(function(c) { return c.has_kp_card === false; });
    if (needsKp.length > 0) {
      warningHtml += '<div class="kp-warning">' +
        '<span>\u26a0\ufe0f</span>' +
        '<span>' + (needsKp.length === 1 ? esc(needsKp[0].name) + ' \u043d\u044f\u043c\u0430 \u0437\u0430\u0434\u0430\u0434\u0435\u043d\u0430 \u0434\u0430\u0442\u0430 \u2014 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u0442\u0435 \u0434\u0430\u0442\u0430 \u0437\u0430 \u043f\u0443\u0431\u043b\u0438\u043a\u0443\u0432\u0430\u043d\u0435 \u0437\u0430 \u0434\u0430 \u0441\u0435 \u0441\u044a\u0437\u0434\u0430\u0434\u0435 \u041a\u041f' : needsKp.length + ' \u043a\u043b\u0438\u0435\u043d\u0442\u0430 \u043d\u044f\u043c\u0430\u0442 \u0437\u0430\u0434\u0430\u0434\u0435\u043d\u0430 \u0434\u0430\u0442\u0430') + '</span>' +
      '</div>';
    }

    var rowsHtml = '';
    clients.forEach(function(c) {
      var autoCreateDate = '—';
      if (c.auto_create_date) {
        try {
          var acd = new Date(c.auto_create_date.toString().split('T')[0] + 'T12:00:00');
          if (!isNaN(acd.getTime())) {
            var today = new Date(); today.setHours(0,0,0,0);
            var autoStr = formatDate(c.auto_create_date);
            autoCreateDate = acd <= today
              ? '<span style="color:var(--red)">' + autoStr + ' ⚠</span>'
              : autoStr;
          }
        } catch(e) { /* invalid date, keep '—' */ }
      }
      var missingKp = c.has_kp_card === false; // null = Basecamp недостъпен → не е сигнал
      var rowBg = missingKp ? 'background:rgba(220,120,0,0.08);' : '';
      var colName = (_kpBc && _kpBc.columnTitle) || 'Измисляне';
      var nameCell = missingKp
        ? '<td class="kp-td"><strong>' + esc(c.name) + '</strong> <span style="color:#e8a030" title="Няма карта в ' + esc(colName) + '">⚠️</span></td>'
        : '<td class="kp-td"><strong>' + esc(c.name) + '</strong></td>';
      var cardLinkBtn = '';
      if (c.has_kp_card && c.kp_card_url) {
        cardLinkBtn = '<a class="btn btn-sm btn-ghost" href="' + esc(c.kp_card_url) + '" target="_blank" rel="noopener" title="Отваря картата в Basecamp">👁 КП карта</a>';
      } else if (c.has_kp_card && c.kp_card_id) {
        cardLinkBtn = '<a class="btn btn-sm btn-ghost" href="#/card/' + c.kp_card_id + '">👁 КП карта</a>';
      }
      var actionBtn = missingKp
        ? '<button class="btn btn-sm kp-launch-btn" onclick="createKpCardNow(' + c.id + ',\'' + esc(c.name) + '\')">🚀 Пусни КП</button>'
        : '<button class="btn btn-sm" onclick="createKpCardNow(' + c.id + ',\'' + esc(c.name) + '\')">📋 Нов КП</button>';
      rowsHtml += '<tr style="' + rowBg + '">' +
        nameCell +
        '<td class="kp-td">' + (c.videos_per_month || 10) + '</td>' +
        '<td class="kp-td">' + (c.publish_interval_days || 3) + 'д</td>' +
        '<td class="kp-td">КП-' + (c.current_kp_number || 1) + '</td>' +
        '<td class="kp-td">' + (c.first_publish_date ? formatDate(c.first_publish_date) : '—') + '</td>' +
        '<td class="kp-td">' + (c.last_video_date ? formatDate(c.last_video_date) : '—') + '</td>' +
        '<td class="kp-td">' + (c.next_kp_date ? formatDate(c.next_kp_date) : '—') + '</td>' +
        '<td class="kp-td">' + autoCreateDate + '</td>' +
        '<td class="kp-td" style="display:flex;gap:4px">' +
          '<button class="btn btn-sm" onclick="editKpClientForm(' + c.id + ')">✏️</button>' +
          '<button class="btn btn-sm btn-danger" onclick="deleteKpClientNow(' + c.id + ',\'' + esc(c.name) + '\')">🗑️</button>' +
          cardLinkBtn +
          actionBtn +
        '</td>' +
      '</tr>';
    });

    var tableHtml = clients.length === 0
      ? '<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма клиенти. Добавете първия.</div>'
      : '<div class="kp-table-wrap"><table class="kp-table">' +
          '<thead><tr>' +
            '<th class="kp-th">Клиент</th><th class="kp-th">Видеа</th><th class="kp-th">Интервал</th>' +
            '<th class="kp-th">Текущ КП</th><th class="kp-th">Първо видео</th><th class="kp-th">Последно видео</th>' +
            '<th class="kp-th">Следващ КП</th><th class="kp-th">Създаване на</th><th class="kp-th">Действия</th>' +
          '</tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table></div>';

    // Къде отиват КП картите (от Админ → КП-Автоматизация)
    var destHtml = '';
    if (_kpBc && _kpBc.enabled && _kpBc.boardTitle) {
      destHtml = '<span style="font-size:12px;color:var(--text-dim);font-weight:400">→ Basecamp: ' + esc(_kpBc.boardTitle) + ' / ' + esc(_kpBc.columnTitle || '') + '</span>';
    }
    var adminLink = (currentUser && currentUser.role === 'admin')
      ? '<a class="btn btn-sm btn-ghost" href="#/admin/kp" title="Настройки на КП-автоматизацията">⚙</a>' : '';

    el.innerHTML = '<div class="home-content-box home-content-box--wide"><div class="kp-auto-wrap">' +
      '<div class="kp-auto-header">' +
        '<h2 class="kp-auto-title">📋 КП-Автоматизация ' + destHtml + '</h2>' +
        '<div style="display:flex;gap:6px;align-items:center">' + adminLink +
        '<button class="btn btn-primary" onclick="showKpClientForm()">+ Нов клиент</button></div>' +
      '</div>' +
      warningHtml +
      '<div id="kpClientFormWrap" style="display:none"></div>' +
      tableHtml +
    '</div></div>';
  } catch (err) {
    el.innerHTML = '<div class="home-content-box home-content-box--wide"><div style="text-align:center;padding:40px;color:var(--red)">Грешка: ' + esc(err.message) + '</div></div>';
  }
}

function showKpClientForm(editData) {
  var wrap = document.getElementById('kpClientFormWrap');
  if (!wrap) return;
  var isEdit = !!editData;
  var defVids = parseInt(_platformConfig.kp_default_videos) || 10; // Админ → КП → Видеа по подразбиране
  var firstDateVal = isEdit ? (editData.first_publish_date || '').split('T')[0] : '';
  var lastDateVal  = isEdit ? (editData.last_video_date  || '').split('T')[0] : '';
  var nextDateVal  = isEdit ? (editData.next_kp_date     || '').split('T')[0] : '';
  // Нов клиент тръгва на стандарта; ако админът е сменил „Видеа по подразбиране“,
  // формата се отваря направо в Custom с неговата бройка.
  var mode = isEdit ? kpModeOf(editData) : (defVids === KP_STD_VIDEOS ? 'standard' : 'custom');
  var vidsVal = isEdit ? (editData.videos_per_month || defVids) : defVids;
  var intervalVal = isEdit ? (editData.publish_interval_days || KP_STD_INTERVAL) : KP_STD_INTERVAL;
  wrap.style.display = 'block';
  wrap.innerHTML = '<div class="kp-form-box">' +
    '<h4 style="margin:0 0 16px">' + (isEdit ? '\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0430\u043d\u0435' : '\u041d\u043e\u0432 \u043a\u043b\u0438\u0435\u043d\u0442') + '</h4>' +
    '<div class="kp-form-grid">' +
      '<div><label class="kp-label">\u041a\u043b\u0438\u0435\u043d\u0442</label>' +
        '<input class="input" type="text" id="kpName" list="clientNamesList" autocomplete="off" oninput="kpNameCheck()" value="' + (isEdit ? esc(editData.name) : '') + '" placeholder="\u0418\u043c\u0435 \u043d\u0430 \u043a\u043b\u0438\u0435\u043d\u0442">' +
        '<div id="kpNameHint" style="margin-top:4px;font-size:11px;line-height:1.4;color:var(--text-dim)">\u0417\u0430\u0440\u0435\u0436\u0434\u0430\u043c \u0441\u044a\u0449\u0435\u0441\u0442\u0432\u0443\u0432\u0430\u0449\u0438\u0442\u0435 \u043a\u043b\u0438\u0435\u043d\u0442\u0438\u2026</div></div>' +
      '<div><label class="kp-label">График</label>' +
        '<select class="input" id="kpMode" onchange="kpModeChanged()" style="width:100%">' +
          '<option value="standard"' + (mode === 'standard' ? ' selected' : '') + '>' + KP_STD_VIDEOS + ' видеа през ' + KP_STD_INTERVAL + ' дни (стандарт)</option>' +
          '<option value="custom"' + (mode === 'custom' ? ' selected' : '') + '>Custom — сам задавам</option>' +
        '</select></div>' +
      '<div><label class="kp-label">Видеа в КП</label><input class="input" type="number" id="kpVideos" value="' + vidsVal + '" min="1" max="50" onchange="kpRecalcDates()"' + (mode === 'standard' ? ' disabled' : '') + '></div>' +
      '<div><label class="kp-label">Интервал (дни)</label><input class="input" type="number" id="kpInterval" value="' + intervalVal + '" min="1" max="60" onchange="kpRecalcDates()"' + (mode === 'standard' ? ' disabled' : '') + '></div>' +
      '<div><label class="kp-label">\u0422\u0435\u043a\u0443\u0449 \u041a\u041f \u2116</label><input class="input" type="number" id="kpKpNum" value="' + (isEdit ? (editData.current_kp_number || 1) : 1) + '" min="1"></div>' +
      '<div><label class="kp-label">\u0414\u0430\u0442\u0430 \u043f\u044a\u0440\u0432\u043e \u0432\u0438\u0434\u0435\u043e</label><button class="bc-date-btn ' + (firstDateVal ? '' : 'bc-date-btn--placeholder') + '" id="kpFirstDate" data-value="' + firstDateVal + '" onclick="event.stopPropagation();showDatePickerPopup(this,this.dataset.value,function(d){var b=document.getElementById(\'kpFirstDate\');if(b){b.dataset.value=d||\'\';b.textContent=d?formatDate(d):\'\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026\';b.className=d?\'bc-date-btn\':\'bc-date-btn bc-date-btn--placeholder\';}kpRecalcDates();})" style="width:100%;text-align:left">' + (firstDateVal ? formatDate(firstDateVal) : '\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026') + '</button></div>' +
      '<div><label class="kp-label">\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u043e \u0432\u0438\u0434\u0435\u043e <span style="opacity:.5">(\u0430\u0432\u0442\u043e)</span></label><span class="input" id="kpLastDate" data-value="' + lastDateVal + '" style="display:block;padding:8px 12px;min-height:38px;color:var(--text-dim)">' + (lastDateVal ? formatDate(lastDateVal) : '\u2014') + '</span></div>' +
      '<div><label class="kp-label">\u0421\u043b\u0435\u0434\u0432\u0430\u0449 \u041a\u041f \u043f\u044a\u0440\u0432\u043e \u0432\u0438\u0434\u0435\u043e <span style="opacity:.5">(\u0430\u0432\u0442\u043e)</span></label><span class="input" id="kpNextDate" data-value="' + nextDateVal + '" style="display:block;padding:8px 12px;min-height:38px;color:var(--text-dim)">' + (nextDateVal ? formatDate(nextDateVal) : '\u2014') + '</span></div>' +
    '</div>' +
    '<div id="kpScheduleHint" style="margin-top:10px;font-size:12px;line-height:1.5;color:var(--text-dim)"></div>' +
    '<div style="margin-top:12px"><label class="kp-label">Бележки</label><textarea class="input" id="kpNotes" rows="2" style="width:100%;resize:vertical">' + (isEdit ? esc(editData.notes || '') : '') + '</textarea></div>' +
    '<div style="margin-top:16px;display:flex;gap:8px">' +
      '<button class="btn btn-primary" onclick="saveKpClient(' + (isEdit ? editData.id : 'null') + ')">' + (isEdit ? 'Запази' : 'Добави') + '</button>' +
      '<button class="btn" onclick="document.getElementById(\'kpClientFormWrap\').style.display=\'none\'">Отказ</button>' +
    '</div>' +
  '</div>';
  _kpEditName = isEdit ? (editData.name || '') : '';
  ensureClientNames().then(kpNameCheck);
  kpRecalcDates(); // редът с графика да е попълнен още при отваряне
}

// ---------- познатите имена на клиенти ----------

// Точно съвпадение, но без името, което точно сега се редактира.
function kpExactMatch(name) {
  var n = String(name || '').trim().toLowerCase();
  if (!n || n === String(_kpEditName || '').trim().toLowerCase()) return null;
  return findClientName(n);
}

function kpNameCheck() {
  var hint = document.getElementById('kpNameHint');
  var input = document.getElementById('kpName');
  if (!hint || !input) return;
  if (!_clientNames) { hint.textContent = 'Зареждам съществуващите клиенти…'; return; }

  var val = input.value.trim();
  var exact = kpExactMatch(val);
  if (exact) {
    hint.style.color = exact.inRegistry ? '#d05a5a' : '#46a374';
    hint.innerHTML = exact.inRegistry
      ? '⛔ Вече има клиент <strong>' + esc(exact.name) + '</strong> — редактирай него, вместо да добавяш втори.'
      : '✓ Точно това име стои в заглавията в Basecamp (' + exact.cards + ' карти) — добави го така.';
    return;
  }

  // Различие само в пунктуация/разредка = същото име, написано небрежно.
  var loose = val ? findClientNameLoose(val) : null;
  if (loose && loose.name.toLowerCase() !== String(_kpEditName || '').trim().toLowerCase()) {
    hint.style.color = '#d05a5a';
    hint.innerHTML = '⛔ Това е същото име като <strong>' + esc(loose.name) + '</strong>, само изписано различно. Използвай точно него.';
    return;
  }

  var similar = val ? (_clientNames || []).filter(function (x) { return clientNamesLookAlike(val, x.name); }) : [];
  if (similar.length) {
    hint.style.color = '#e8a030';
    hint.innerHTML = '⚠️ Има вече подобно име: ' +
      similar.slice(0, 3).map(function (x) { return '<strong>' + esc(x.name) + '</strong>'; }).join(', ') +
      '. Ако е същият клиент, използвай съществуващото изписване — иначе КП картите му не се намират.';
    return;
  }

  var known = (_clientNames || []).length;
  var missing = (_clientNames || []).filter(function (x) { return !x.inRegistry; });
  hint.style.color = 'var(--text-dim)';
  hint.innerHTML = known
    ? 'Пиши или отвори падащото меню — ' + known + ' познати клиента (от списъка и от заглавията в Basecamp).' +
      (missing.length ? ' Още не са в списъка: <strong>' + missing.slice(0, 5).map(function (x) { return esc(x.name); }).join(', ') + '</strong>' + (missing.length > 5 ? ' и др.' : '') + '.' : '')
    : 'Още няма познати клиенти.';
}

// Смяна на режима: „Стандарт“ заключва полетата на 10/3, „Custom“ ги отпуска.
function kpModeChanged() {
  var modeEl = document.getElementById('kpMode');
  var vEl = document.getElementById('kpVideos');
  var iEl = document.getElementById('kpInterval');
  if (!modeEl || !vEl || !iEl) return;
  var std = modeEl.value === 'standard';
  if (std) { vEl.value = KP_STD_VIDEOS; iEl.value = KP_STD_INTERVAL; }
  vEl.disabled = std;
  iEl.disabled = std;
  kpRecalcDates();
}

// Интервалът вече е ВХОД, а не резултат — оттук се смятат само последното видео,
// първото видео на следващия КП и обяснителният ред под формата.
async function kpRecalcDates() {
  var firstEl = document.getElementById('kpFirstDate');
  var firstDate = firstEl && firstEl.dataset.value;
  var videos = parseInt((document.getElementById('kpVideos') || {}).value) || KP_STD_VIDEOS;
  var interval = parseInt((document.getElementById('kpInterval') || {}).value) || KP_STD_INTERVAL;
  var hintEl = document.getElementById('kpScheduleHint');
  if (!firstDate) {
    if (hintEl) hintEl.textContent = 'Избери дата за първото видео, за да се сметне графикът.';
    return;
  }
  try {
    var res = await fetch('/api/kp/preview-dates?firstDate=' + firstDate + '&videoCount=' + videos + '&interval=' + interval);
    var data = await res.json();
    if (!res.ok) return;
    var lastEl = document.getElementById('kpLastDate');
    if (lastEl) { lastEl.dataset.value = data.lastVideoDate; lastEl.textContent = formatDate(data.lastVideoDate); }
    var nextEl = document.getElementById('kpNextDate');
    if (nextEl) { nextEl.dataset.value = data.nextKpFirstDate; nextEl.textContent = formatDate(data.nextKpFirstDate); }
    if (hintEl) {
      hintEl.textContent = videos + ' видеа през ' + data.interval + ' дни: ' +
        (data.datesBg || []).join(', ') + '. Следващият КП тръгва на ' +
        formatDate(data.nextKpFirstDate) + ' — цикъл ' + data.cycleDays + ' дни.';
    }
  } catch(e) { /* ignore */ }
}

async function editKpClientForm(id) {
  try {
    var data = await (await fetch('/api/kp/clients')).json();
    var client = (data.clients || []).find(function(c) { return c.id === id; });
    if (client) showKpClientForm(client);
  } catch (err) { showToast('Грешка: ' + err.message, 'error'); }
}

async function saveKpClient(id) {
  var name = document.getElementById('kpName').value.trim();
  if (!name) return showToast('Въведи име на клиент', 'warn');
  // Един клиент — едно име. Точен дубликат в списъка спираме; за подобно име само
  // предупреждаваме в самата форма (kpNameCheck), защото може да е различен клиент.
  var dup = kpExactMatch(name) || findClientNameLoose(name);
  if (dup && dup.inRegistry && dup.name.toLowerCase() !== String(_kpEditName || '').trim().toLowerCase()) {
    return showToast('Вече има клиент „' + dup.name + '" — редактирай него.', 'warn');
  }
  var lastEl = document.getElementById('kpLastDate');
  var nextEl = document.getElementById('kpNextDate');
  var data = {
    name: name,
    videos_per_month: parseInt(document.getElementById('kpVideos').value) || parseInt(_platformConfig.kp_default_videos) || KP_STD_VIDEOS,
    publish_interval_days: parseInt(document.getElementById('kpInterval').value) || KP_STD_INTERVAL,
    current_kp_number: parseInt(document.getElementById('kpKpNum').value) || 1,
    first_publish_date: (document.getElementById('kpFirstDate') && document.getElementById('kpFirstDate').dataset.value) || null,
    notes: document.getElementById('kpNotes').value || null
  };
  // PUT не преизчислява датите — подаваме това, което формата вече показва.
  if (id) {
    if (lastEl && lastEl.dataset.value) data.last_video_date = lastEl.dataset.value;
    if (nextEl && nextEl.dataset.value) data.next_kp_date = nextEl.dataset.value;
  }
  try {
    var url = id ? '/api/kp/clients/' + id : '/api/kp/clients';
    var method = id ? 'PUT' : 'POST';
    var res = await fetch(url, { method: method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
    var json = await res.json();
    if (!res.ok) return showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + (json.error || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430'), 'error');
    _clientNames = null; _clientNamesPromise = null; // \u0441\u043f\u0438\u0441\u044a\u043a\u044a\u0442 \u0441 \u0438\u043c\u0435\u043d\u0430 \u0432\u0435\u0447\u0435 \u0435 \u0441\u0442\u0430\u0440
    document.getElementById('kpClientFormWrap').style.display = 'none';
    // Auto-create KP card for new client with date set (only once, before reload)
    if (!id && data.first_publish_date && json.id) {
      var cardRes = await fetch('/api/kp/create-card/' + json.id, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ firstPublishDate: data.first_publish_date })
      });
      var cardData = await cardRes.json();
      if (cardData.ok) showToast('✅ Клиентът е добавен и КП картата е създадена: ' + cardData.title, 'success');
      else showToast('⚠️ Клиентът е добавен, но КП картата не се създаде: ' + (cardData.error || 'Грешка'), 'warn');
    } else if (!id) {
      showToast('✅ Клиентът е добавен', 'success');
    } else {
      showToast('✅ Запазено', 'success');
    }
    var el = document.getElementById('pageContent');
    if (el) await loadKpAuto(el);
  } catch (err) { showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + err.message, 'error'); }
}

function createKpCardNow(clientId, clientName) {
  var destTxt = (_kpBc && _kpBc.enabled)
    ? '\u0432 Basecamp (' + ((_kpBc.boardTitle ? _kpBc.boardTitle + ' \u2192 ' + (_kpBc.columnTitle || '') : 'Pre-Production')) + ')'
    : '\u0432 \u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430\u0442\u0430';
  showConfirmModal('\u0421\u044a\u0437\u0434\u0430\u0439 \u043d\u043e\u0432 \u043a\u043e\u043d\u0442\u0435\u043d\u0442 \u043f\u043b\u0430\u043d \u0437\u0430 ' + clientName + ' ' + destTxt + '?', async function() {
    try {
      var res = await fetch('/api/kp/create-card/' + clientId, { method: 'POST', headers: {'Content-Type':'application/json'} });
      var data = await res.json();
      if (data.ok) {
        showToast('\u2705 \u0421\u044a\u0437\u0434\u0430\u0434\u0435\u043d\u043e' + (data.basecamp ? ' \u0432 Basecamp' : '') + ': ' + data.title, 'success', 6000);
        var el = document.getElementById('pageContent');
        if (el) await loadKpAuto(el);
      } else {
        showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + (data.error || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430'), 'error');
      }
    } catch (err) { showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + err.message, 'error'); }
  });
}

function deleteKpClientNow(clientId, clientName) {
  showConfirmModal('\u0418\u0437\u0442\u0440\u0438\u0439 \u043a\u043b\u0438\u0435\u043d\u0442 "' + clientName + '"?\u0422\u043e\u0432\u0430 \u0449\u0435 \u0441\u043a\u0440\u0438\u0435 \u0437\u0430\u043f\u0438\u0441\u0430 \u043e\u0442 \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0437\u0430\u0446\u0438\u044f\u0442\u0430.', async function() {
    try {
      var res = await fetch('/api/kp/clients/' + clientId, { method: 'DELETE' });
      var data = await res.json();
      if (data.ok) { var el = document.getElementById('pageContent'); if (el) await loadKpAuto(el); }
      else showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + (data.error || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430'), 'error');
    } catch (err) { showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + err.message, 'error'); }
  }, true);
}

// ==================== BOOKMARKS ====================
