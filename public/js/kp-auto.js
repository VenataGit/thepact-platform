// ==================== КП АВТОМАТИЗАЦИЯ ====================
async function renderKpAuto(el) {
  setBreadcrumb([{ label: 'Инструменти' }, { label: 'КП-Автоматизация' }]);
  el.className = 'full-width';
  el.innerHTML = '<div class="home-content-box home-content-box--wide"><div class="kp-auto-wrap"><div style="text-align:center;padding:40px;color:var(--text-dim)">Зареждане...</div></div></div>';
  await loadKpAuto(el);
}

async function loadKpAuto(el) {
  try {
    const res = await fetch('/api/kp/clients');
    const clients = await res.json();
    if (!res.ok || !Array.isArray(clients)) {
      el.innerHTML = '<div class="home-content-box home-content-box--wide"><div class="kp-auto-wrap"><div style="text-align:center;padding:40px;color:var(--red)">Грешка: ' + esc((clients && clients.error) || 'Неуспешно зареждане') + '</div></div></div>';
      return;
    }

    const needsKp = clients.filter(function(c) { return !c.has_kp_card; });
    var warningHtml = '';
    if (needsKp.length > 0) {
      warningHtml = '<div class="kp-warning">' +
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
      var missingKp = !c.has_kp_card;
      var rowBg = missingKp ? 'background:rgba(220,120,0,0.08);' : '';
      var nameCell = missingKp
        ? '<td class="kp-td"><strong>' + esc(c.name) + '</strong> <span style="color:#e8a030" title="Няма карта в Измисляне">⚠️</span></td>'
        : '<td class="kp-td"><strong>' + esc(c.name) + '</strong></td>';
      var cardLinkBtn = (!missingKp && c.kp_card_id)
        ? '<a class="btn btn-sm btn-ghost" href="#/card/' + c.kp_card_id + '">👁 КП карта</a>'
        : '';
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

    el.innerHTML = '<div class="home-content-box home-content-box--wide"><div class="kp-auto-wrap">' +
      '<div class="kp-auto-header">' +
        '<h2 class="kp-auto-title">📋 КП-Автоматизация</h2>' +
        '<button class="btn btn-primary" onclick="showKpClientForm()">+ Нов клиент</button>' +
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
  var firstDateVal = isEdit ? (editData.first_publish_date || '').split('T')[0] : '';
  var lastDateVal  = isEdit ? (editData.last_video_date  || '').split('T')[0] : '';
  var nextDateVal  = isEdit ? (editData.next_kp_date     || '').split('T')[0] : '';
  wrap.style.display = 'block';
  wrap.innerHTML = '<div class="kp-form-box">' +
    '<h4 style="margin:0 0 16px">' + (isEdit ? '\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0430\u043d\u0435' : '\u041d\u043e\u0432 \u043a\u043b\u0438\u0435\u043d\u0442') + '</h4>' +
    '<div class="kp-form-grid">' +
      '<div><label class="kp-label">\u041a\u043b\u0438\u0435\u043d\u0442</label><input class="input" type="text" id="kpName" value="' + (isEdit ? esc(editData.name) : '') + '" placeholder="\u0418\u043c\u0435 \u043d\u0430 \u043a\u043b\u0438\u0435\u043d\u0442"></div>' +
      '<div><label class="kp-label">\u0412\u0438\u0434\u0435\u0430 \u0432 \u041a\u041f</label><input class="input" type="number" id="kpVideos" value="' + (isEdit ? (editData.videos_per_month || 10) : 10) + '" min="1" max="50" onchange="kpAutoInterval()"></div>' +
      '<div><label class="kp-label">\u0418\u043d\u0442\u0435\u0440\u0432\u0430\u043b (\u0434\u043d\u0438) <span style="opacity:.5;font-weight:400">\u0430\u0432\u0442\u043e</span></label><span class="input" id="kpInterval" data-value="' + (isEdit ? (editData.publish_interval_days || '') : '') + '" style="display:block;padding:8px 12px;min-height:38px;color:var(--text-dim)">' + (isEdit ? (editData.publish_interval_days || '—') : '—') + '</span></div>' +
      '<div><label class="kp-label">\u0422\u0435\u043a\u0443\u0449 \u041a\u041f \u2116</label><input class="input" type="number" id="kpKpNum" value="' + (isEdit ? (editData.current_kp_number || 1) : 1) + '" min="1"></div>' +
      '<div><label class="kp-label">\u0414\u0430\u0442\u0430 \u043f\u044a\u0440\u0432\u043e \u0432\u0438\u0434\u0435\u043e</label><button class="bc-date-btn ' + (firstDateVal ? '' : 'bc-date-btn--placeholder') + '" id="kpFirstDate" data-value="' + firstDateVal + '" onclick="event.stopPropagation();showDatePickerPopup(this,this.dataset.value,function(d){var b=document.getElementById(\'kpFirstDate\');if(b){b.dataset.value=d||\'\';b.textContent=d?formatDate(d):\'\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026\';b.className=d?\'bc-date-btn\':\'bc-date-btn bc-date-btn--placeholder\';}kpRecalcDates();})" style="width:100%;text-align:left">' + (firstDateVal ? formatDate(firstDateVal) : '\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026') + '</button></div>' +
      '<div><label class="kp-label">\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u043e \u0432\u0438\u0434\u0435\u043e <span style="opacity:.5">(\u0430\u0432\u0442\u043e)</span></label><span class="input" id="kpLastDate" data-value="' + lastDateVal + '" style="display:block;padding:8px 12px;min-height:38px;color:var(--text-dim)">' + (lastDateVal ? formatDate(lastDateVal) : '\u2014') + '</span></div>' +
      '<div><label class="kp-label">\u0421\u043b\u0435\u0434\u0432\u0430\u0449 \u041a\u041f \u043f\u044a\u0440\u0432\u043e \u0432\u0438\u0434\u0435\u043e <span style="opacity:.5">(\u0430\u0432\u0442\u043e)</span></label><span class="input" id="kpNextDate" data-value="' + nextDateVal + '" style="display:block;padding:8px 12px;min-height:38px;color:var(--text-dim)">' + (nextDateVal ? formatDate(nextDateVal) : '\u2014') + '</span></div>' +
    '</div>' +
    '<div style="margin-top:12px"><label class="kp-label">Бележки</label><textarea class="input" id="kpNotes" rows="2" style="width:100%;resize:vertical">' + (isEdit ? esc(editData.notes || '') : '') + '</textarea></div>' +
    '<div style="margin-top:16px;display:flex;gap:8px">' +
      '<button class="btn btn-primary" onclick="saveKpClient(' + (isEdit ? editData.id : 'null') + ')">' + (isEdit ? 'Запази' : 'Добави') + '</button>' +
      '<button class="btn" onclick="document.getElementById(\'kpClientFormWrap\').style.display=\'none\'">Отказ</button>' +
    '</div>' +
  '</div>';
}

async function kpRecalcDates() {
  var firstEl = document.getElementById('kpFirstDate');
  var firstDate = firstEl && firstEl.dataset.value;
  var videos = parseInt((document.getElementById('kpVideos') || {}).value) || 10;
  if (!firstDate) return;
  try {
    var res = await fetch('/api/kp/preview-dates?firstDate=' + firstDate + '&videoCount=' + videos);
    var data = await res.json();
    if (!res.ok) return;
    var intEl = document.getElementById('kpInterval');
    if (intEl) { intEl.dataset.value = data.interval; intEl.textContent = data.interval + 'д'; }
    var lastEl = document.getElementById('kpLastDate');
    if (lastEl) { lastEl.dataset.value = data.lastVideoDate; lastEl.textContent = formatDate(data.lastVideoDate); }
    var nextEl = document.getElementById('kpNextDate');
    if (nextEl) { nextEl.dataset.value = data.nextKpFirstDate; nextEl.textContent = formatDate(data.nextKpFirstDate); }
  } catch(e) { /* ignore */ }
}

function kpAutoInterval() {
  kpRecalcDates();
}

async function editKpClientForm(id) {
  try {
    var clients = await (await fetch('/api/kp/clients')).json();
    var client = clients.find(function(c) { return c.id === id; });
    if (client) showKpClientForm(client);
  } catch (err) { showToast('Грешка: ' + err.message, 'error'); }
}

async function saveKpClient(id) {
  var name = document.getElementById('kpName').value.trim();
  if (!name) return showToast('Въведи име на клиент', 'warn');
  var data = {
    name: name,
    videos_per_month: parseInt(document.getElementById('kpVideos').value) || 10,
    current_kp_number: parseInt(document.getElementById('kpKpNum').value) || 1,
    first_publish_date: (document.getElementById('kpFirstDate') && document.getElementById('kpFirstDate').dataset.value) || null,
    notes: document.getElementById('kpNotes').value || null
  };
  try {
    var url = id ? '/api/kp/clients/' + id : '/api/kp/clients';
    var method = id ? 'PUT' : 'POST';
    var res = await fetch(url, { method: method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
    var json = await res.json();
    if (!res.ok) return showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + (json.error || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430'), 'error');
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
  showConfirmModal('\u0421\u044a\u0437\u0434\u0430\u0439 \u043d\u043e\u0432 \u043a\u043e\u043d\u0442\u0435\u043d\u0442 \u043f\u043b\u0430\u043d \u0437\u0430 ' + clientName + ' \u0432 \u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430\u0442\u0430?', async function() {
    try {
      var res = await fetch('/api/kp/create-card/' + clientId, { method: 'POST', headers: {'Content-Type':'application/json'} });
      var data = await res.json();
      if (data.ok) {
        showToast('\u2705 \u0421\u044a\u0437\u0434\u0430\u0434\u0435\u043d\u043e: ' + data.title, 'success');
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
