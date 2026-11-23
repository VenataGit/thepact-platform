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

async function renderKpAuto(el, sub) {
  setBreadcrumb(null);
  el.className = 'full-width';
  if (sub === 'settings') return renderKpSettings(el);
  if (sub === 'info') return renderKpInfo(el);
  el.innerHTML = '<div class="home-content-box home-content-box--wide kp-full"><div class="kp-auto-wrap"><div style="text-align:center;padding:40px;color:var(--text-dim)">Зареждане...</div></div></div>';
  await loadKpAuto(el);
}

// Състоянието на списъка (Венци, 23.11.2026): подредба по колона, филтър по
// отговорник, брой активни/на пауза. Данните се теглят веднъж, а сортирането и
// филтърът само пре-рисуват таблицата.
var _kpClients = [];
var _kpPeople = [];
var _kpSort = { key: 'name', dir: 1 };
var _kpPersonFilter = ''; // '' = всички, 'none' = без отговорник, иначе person_id
var KP_COLS = 9;

function kpDateKey(v) { return v ? String(v).split('T')[0] : ''; }

var KP_SORTS = {
  name:     function (c) { return String(c.name || '').toLowerCase(); },
  person:   function (c) { return String(c.responsible_name || '').toLowerCase(); },
  videos:   function (c) { return c.videos_per_month || 10; },
  interval: function (c) { return c.publish_interval_days || 3; },
  last:     function (c) { return kpDateKey(c.last_video_date); },
  kpnum:    function (c) { return c.current_kp_number || 1; },
  next:     function (c) { return kpDateKey(c.next_kp_date || c.first_publish_date); },
  create:   function (c) { return kpDateKey(c.auto_create_date); }
};

function kpSortBy(key) {
  if (_kpSort.key === key) _kpSort.dir = -_kpSort.dir;
  else _kpSort = { key: key, dir: 1 };
  renderKpTable();
}

function kpSetPersonFilter(v) {
  _kpPersonFilter = v || '';
  renderKpTable();
}

function kpSorted(list) {
  var get = KP_SORTS[_kpSort.key] || KP_SORTS.name;
  return list.slice().sort(function (a, b) {
    var x = get(a), y = get(b);
    // Празните стойности (няма дата / няма отговорник) винаги най-отдолу.
    if (x === '' && y !== '') return 1;
    if (y === '' && x !== '') return -1;
    var r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'bg');
    if (r === 0) r = String(a.name || '').localeCompare(String(b.name || ''), 'bg');
    return r * _kpSort.dir;
  });
}

function kpRowHtml(c) {
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
  var missingKp = c.has_kp_card === false && !c.paused; // null = Basecamp недостъпен → не е сигнал
  var rowBg = c.paused ? 'opacity:.55;' : (missingKp ? 'background:rgba(220,120,0,0.08);' : '');
  var colName = (_kpBc && _kpBc.columnTitle) || 'Измисляне';
  var nameCell = missingKp
    ? '<td class="kp-td"><strong>' + esc(c.name) + '</strong> <span style="color:#e8a030" title="Няма карта в ' + esc(colName) + '">⚠️</span></td>'
    : '<td class="kp-td"><strong>' + esc(c.name) + '</strong></td>';
  var personCell = c.responsible_name
    ? '<td class="kp-td">' + esc(c.responsible_name) + '</td>'
    : '<td class="kp-td" style="color:var(--text-dim)">Няма назначен</td>';
  var cardLinkBtn = '';
  if (c.has_kp_card && c.kp_card_url) {
    cardLinkBtn = '<a class="btn btn-sm btn-ghost" href="' + esc(c.kp_card_url) + '" target="_blank" rel="noopener" title="Отваря картата в Basecamp">👁 КП карта</a>';
  } else if (c.has_kp_card && c.kp_card_id) {
    cardLinkBtn = '<a class="btn btn-sm btn-ghost" href="#/card/' + c.kp_card_id + '">👁 КП карта</a>';
  }
  var pauseBtn = c.paused
    ? '<button class="btn btn-sm" onclick="toggleKpPause(' + c.id + ',false)" title="Връща клиента в автоматизацията">▶ Продължи</button>'
    : '<button class="btn btn-sm" onclick="toggleKpPause(' + c.id + ',true)" title="Пауза — данните остават, но не се пускат нови КП">⏸ Пауза</button>';
  var actionBtn = c.paused ? '' : missingKp
    ? '<button class="btn btn-sm kp-launch-btn" onclick="createKpCardNow(' + c.id + ',' + jsq(c.name) + ')">🚀 Пусни КП</button>'
    : '<button class="btn btn-sm" onclick="createKpCardNow(' + c.id + ',' + jsq(c.name) + ')">📋 Нов КП</button>';
  return '<tr class="kp-row" id="kpRow' + c.id + '" style="' + rowBg + '">' +
    nameCell + personCell +
    '<td class="kp-td">' + (c.videos_per_month || 10) + '</td>' +
    '<td class="kp-td">' + (c.publish_interval_days || 3) + 'д</td>' +
    // Една и съща дата за „следващия КП" навсякъде: next_kp_date е тази, от която
    // бутонът и графикът пускат картата (first_publish_date е само стар дубликат).
    '<td class="kp-td">' + (c.last_video_date ? formatDate(c.last_video_date) : '—') + '</td>' +
    '<td class="kp-td"><strong>КП-' + (c.current_kp_number || 1) + '</strong></td>' +
    '<td class="kp-td">' + ((c.next_kp_date || c.first_publish_date) ? formatDate(c.next_kp_date || c.first_publish_date) : '—') + '</td>' +
    '<td class="kp-td">' + autoCreateDate + '</td>' +
    '<td class="kp-td" style="display:flex;gap:4px">' +
      '<button class="btn btn-sm" onclick="editKpClientForm(' + c.id + ')">✏️</button>' +
      '<button class="btn btn-sm" onclick="toggleKpHistory(' + c.id + ')" title="Кои КП са пуснати и с какви дати, кой какво е редактирал">📜</button>' +
      '<button class="btn btn-sm btn-danger" onclick="deleteKpClientNow(' + c.id + ',' + jsq(c.name) + ')">🗑️</button>' +
      pauseBtn +
      cardLinkBtn +
      actionBtn +
    '</td>' +
  '</tr>' +
  '<tr id="kpHist' + c.id + '" style="display:none"><td class="kp-td" colspan="' + KP_COLS + '"></td></tr>';
}

function kpTh(key, label, title) {
  var on = _kpSort.key === key;
  return '<th class="kp-th kp-th--sort' + (on ? ' kp-th--on' : '') + '" onclick="kpSortBy(\'' + key + '\')"' +
    (title ? ' title="' + esc(title) + '"' : '') + '>' + label + (on ? (_kpSort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>';
}

function renderKpTable() {
  var wrap = document.getElementById('kpTableWrap');
  if (!wrap) return;
  kpHideForm(); // формата за редакция може да е вътре в таблицата — прибираме я преди пре-рисуване

  var f = _kpPersonFilter;
  var list = _kpClients.filter(function (c) {
    if (!f) return true;
    if (f === 'none') return !c.responsible_person_id;
    return String(c.responsible_person_id || '') === f;
  });
  var active = kpSorted(list.filter(function (c) { return !c.paused; }));
  var paused = kpSorted(list.filter(function (c) { return c.paused; }));

  var countsEl = document.getElementById('kpCounts');
  if (countsEl) {
    var totalA = _kpClients.filter(function (c) { return !c.paused; }).length;
    var totalP = _kpClients.length - totalA;
    countsEl.innerHTML = '<strong>' + totalA + '</strong> активни · <strong>' + totalP + '</strong> на пауза' +
      (f ? ' <span style="opacity:.7">(филтър: ' + active.length + ' + ' + paused.length + ')</span>' : '');
  }

  if (!_kpClients.length) {
    wrap.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма клиенти. Добавете първия.</div>';
    return;
  }
  var rows = '<tr><td class="kp-td kp-paused-sep" colspan="' + KP_COLS + '">▶ Активни — ' + active.length + '</td></tr>' +
    active.map(kpRowHtml).join('');
  if (paused.length) {
    rows += '<tr><td class="kp-td kp-paused-sep" colspan="' + KP_COLS + '">⏸ На пауза — ' + paused.length + ' (ботът не им пуска КП, данните им стоят)</td></tr>' +
      paused.map(kpRowHtml).join('');
  }
  if (!active.length && !paused.length) {
    rows = '<tr><td class="kp-td" colspan="' + KP_COLS + '" style="text-align:center;color:var(--text-dim);padding:24px">Няма клиенти за този филтър.</td></tr>';
  }
  wrap.innerHTML = '<table class="kp-table">' +
    '<thead><tr>' +
      kpTh('name', 'Клиент') + kpTh('person', 'Отговорник', 'Контент криейтърът, който отговаря за клиента') +
      kpTh('videos', 'Видеа') + kpTh('interval', 'Интервал') +
      kpTh('last', 'Последно видео (пуснат КП)', 'Последното видео от последния пуснат КП') +
      kpTh('kpnum', 'Следващ КП', 'Номерът на КП-а, който ще се пусне следващ') +
      kpTh('next', 'Първо видео (следв. КП)', 'Първото видео на следващия КП — от тази дата тръгва планът') +
      kpTh('create', 'Създаване на', 'Кога ботът ще пусне картата на следващия КП') +
      '<th class="kp-th">Действия</th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
  '</table>';
}

function kpPersonFilterHtml() {
  var opts = '<option value="">Всички отговорници</option><option value="none"' + (_kpPersonFilter === 'none' ? ' selected' : '') + '>Без назначен</option>';
  _kpPeople.forEach(function (p) {
    var v = String(p.person_id);
    opts += '<option value="' + esc(v) + '"' + (_kpPersonFilter === v ? ' selected' : '') + '>' + esc(p.name) + '</option>';
  });
  return '<select class="input" style="width:auto;min-width:200px" onchange="kpSetPersonFilter(this.value)">' + opts + '</select>';
}

async function loadKpAuto(el) {
  try {
    var both = await Promise.all([
      fetch('/api/kp/clients'),
      fetch('/api/kp/people').then(function (r) { return r.ok ? r.json() : { people: [] }; }).catch(function () { return { people: [] }; })
    ]);
    const res = both[0];
    const data = await res.json();
    const clients = data && data.clients;
    if (!res.ok || !Array.isArray(clients)) {
      el.innerHTML = '<div class="home-content-box home-content-box--wide kp-full"><div class="kp-auto-wrap"><div style="text-align:center;padding:40px;color:var(--red)">Грешка: ' + esc((data && data.error) || 'Неуспешно зареждане') + '</div></div></div>';
      return;
    }
    _kpBc = data.bc || null;
    _kpClients = clients;
    _kpPeople = (both[1] && both[1].people) || [];

    var warningHtml = '';
    if (_kpBc && _kpBc.enabled && _kpBc.error) {
      warningHtml += '<div class="kp-warning">' +
        '<span>⚠️</span>' +
        '<span>Basecamp не отговори (' + esc(_kpBc.error) + ') — колоната „има ли КП карта" не може да се провери сега.</span>' +
      '</div>';
    }
    const needsKp = clients.filter(function(c) { return c.has_kp_card === false && !c.paused; });
    if (needsKp.length > 0) {
      warningHtml += '<div class="kp-warning">' +
        '<span>⚠️</span>' +
        '<span>' + (needsKp.length === 1 ? esc(needsKp[0].name) + ' няма зададена дата — настройте дата за публикуване за да се създаде КП' : needsKp.length + ' клиента нямат зададена дата') + '</span>' +
      '</div>';
    }

    // Къде отиват КП картите (от Админ → КП-Автоматизация)
    var destHtml = '';
    if (_kpBc && _kpBc.enabled && _kpBc.boardTitle) {
      destHtml = '<span style="font-size:12px;color:var(--text-dim);font-weight:400">→ Basecamp: ' + esc(_kpBc.boardTitle) + ' / ' + esc(_kpBc.columnTitle || '') + '</span>';
    }
    var adminLink = (currentUser && currentUser.role === 'admin')
      ? '<a class="btn btn-sm btn-ghost" href="#/admin/kp" title="Настройки на КП-автоматизацията">⚙</a>' : '';

    el.innerHTML = '<div class="home-content-box home-content-box--wide kp-full"><div class="kp-auto-wrap">' +
      '<div class="kp-auto-header">' +
        '<h2 class="kp-auto-title">📋 КП-Автоматизация ' + destHtml + '</h2>' +
        '<div style="display:flex;gap:6px;align-items:center">' + adminLink +
        '<a class="btn btn-sm" href="#/kp-auto/info" title="Как работи всичко в КП-Автоматизацията + предложения">ℹ Как работи</a>' +
        '<a class="btn btn-sm" href="#/kp-auto/settings" title="Настройки: свързване на клиент с Basecamp проект">⚙ Настройки</a>' +
        '<button class="btn btn-primary" onclick="showKpClientForm()">+ Нов клиент</button></div>' +
      '</div>' +
      warningHtml +
      '<div id="kpFormHome"><div id="kpClientFormWrap" style="display:none"></div></div>' +
      '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0 0 10px">' +
        '<span id="kpCounts" style="font-size:13px"></span>' +
        '<span style="flex:1"></span>' +
        kpPersonFilterHtml() +
      '</div>' +
      '<div class="kp-table-wrap" id="kpTableWrap"></div>' +
    '</div></div>';
    renderKpTable();
  } catch (err) {
    el.innerHTML = '<div class="home-content-box home-content-box--wide kp-full"><div style="text-align:center;padding:40px;color:var(--red)">Грешка: ' + esc(err.message) + '</div></div>';
  }
}

// Формата е една: при „+ Нов клиент" стои горе, при ✏️ се мести точно под реда
// на клиента (Венци, 23.11.2026). Затваряне = прибиране обратно горе.
function kpHideForm() {
  var wrap = document.getElementById('kpClientFormWrap');
  var home = document.getElementById('kpFormHome');
  if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; }
  if (wrap && home && wrap.parentNode !== home) home.appendChild(wrap);
  var fr = document.getElementById('kpFormRow');
  if (fr) fr.parentNode.removeChild(fr);
}

function kpPlaceFormUnder(id) {
  kpHideForm();
  var wrap = document.getElementById('kpClientFormWrap');
  var row = document.getElementById('kpRow' + id);
  if (!wrap || !row) return;
  var tr = document.createElement('tr');
  tr.id = 'kpFormRow';
  var td = document.createElement('td');
  td.colSpan = KP_COLS;
  td.style.whiteSpace = 'normal';
  td.style.padding = '8px 0 4px';
  tr.appendChild(td);
  row.parentNode.insertBefore(tr, row.nextSibling);
  td.appendChild(wrap);
}

function kpPersonSelectHtml(selected) {
  var sel = selected ? String(selected) : '';
  var opts = '<option value="">— Няма назначен —</option>';
  var cc = _kpPeople.filter(function (p) { return p.kp_responsible; });
  var others = _kpPeople.filter(function (p) { return !p.kp_responsible; });
  function o(p) { var v = String(p.person_id); return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }
  if (cc.length) opts += '<optgroup label="Контент криейтъри">' + cc.map(o).join('') + '</optgroup>';
  if (others.length) opts += '<optgroup label="Останалите от екипа">' + others.map(o).join('') + '</optgroup>';
  return '<select class="input" id="kpPerson" style="width:100%">' + opts + '</select>';
}

function showKpClientForm(editData) {
  if (!editData) kpHideForm(); // „+ Нов клиент" — формата стои горе
  var wrap = document.getElementById('kpClientFormWrap');
  if (!wrap) return;
  var isEdit = !!editData;
  var defVids = parseInt(_platformConfig.kp_default_videos) || 10; // Админ → КП → Видеа по подразбиране
  // Формата задава СЛЕДВАЩИЯ КП: номер + първото му видео (= next_kp_date, от нея
  // се пуска картата). Последното видео и „КП след него“ са само преглед.
  var firstDateVal = isEdit ? (editData.next_kp_date || editData.first_publish_date || '').split('T')[0] : '';
  var lastDateVal  = '';
  var nextDateVal  = '';
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
      '<div><label class="kp-label">Отговорник (контент криейтър)</label>' + kpPersonSelectHtml(isEdit ? editData.responsible_person_id : '') + '</div>' +
      '<div><label class="kp-label">График</label>' +
        '<select class="input" id="kpMode" onchange="kpModeChanged()" style="width:100%">' +
          '<option value="standard"' + (mode === 'standard' ? ' selected' : '') + '>' + KP_STD_VIDEOS + ' видеа през ' + KP_STD_INTERVAL + ' дни (стандарт)</option>' +
          '<option value="custom"' + (mode === 'custom' ? ' selected' : '') + '>Custom — сам задавам</option>' +
        '</select></div>' +
      '<div><label class="kp-label">Видеа в КП</label><input class="input" type="number" id="kpVideos" value="' + vidsVal + '" min="1" max="50" onchange="kpRecalcDates()"' + (mode === 'standard' ? ' disabled' : '') + '></div>' +
      '<div><label class="kp-label">Интервал (дни)</label><input class="input" type="number" id="kpInterval" value="' + intervalVal + '" min="1" max="60" onchange="kpRecalcDates()"' + (mode === 'standard' ? ' disabled' : '') + '></div>' +
      '<div><label class="kp-label">Следващ КП № <span style="opacity:.5">(който ще се пусне)</span></label><input class="input" type="number" id="kpKpNum" value="' + (isEdit ? (editData.current_kp_number || 1) : 1) + '" min="1" onchange="kpRecalcDates()"></div>' +
      '<div><label class="kp-label">Първо видео на този КП</label><button class="bc-date-btn ' + (firstDateVal ? '' : 'bc-date-btn--placeholder') + '" id="kpFirstDate" data-value="' + firstDateVal + '" onclick="event.stopPropagation();showDatePickerPopup(this,this.dataset.value,function(d){var b=document.getElementById(\'kpFirstDate\');if(b){b.dataset.value=d||\'\';b.textContent=d?formatDate(d):\'\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026\';b.className=d?\'bc-date-btn\':\'bc-date-btn bc-date-btn--placeholder\';}kpRecalcDates();})" style="width:100%;text-align:left">' + (firstDateVal ? formatDate(firstDateVal) : '\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026') + '</button></div>' +
      '<div><label class="kp-label">Последно видео на този КП <span style="opacity:.5">(\u0430\u0432\u0442\u043e)</span></label><span class="input" id="kpLastDate" data-value="' + lastDateVal + '" style="display:block;padding:8px 12px;min-height:38px;color:var(--text-dim)">' + (lastDateVal ? formatDate(lastDateVal) : '\u2014') + '</span></div>' +
      '<div><label class="kp-label">КП след него тръгва на <span style="opacity:.5">(\u0430\u0432\u0442\u043e)</span></label><span class="input" id="kpNextDate" data-value="' + nextDateVal + '" style="display:block;padding:8px 12px;min-height:38px;color:var(--text-dim)">' + (nextDateVal ? formatDate(nextDateVal) : '\u2014') + '</span></div>' +
    '</div>' +
    '<div id="kpScheduleHint" style="margin-top:10px;font-size:12px;line-height:1.5;color:var(--text-dim)"></div>' +
    '<div style="margin-top:12px"><label class="kp-label">Бележки</label><textarea class="input" id="kpNotes" rows="2" style="width:100%;resize:vertical">' + (isEdit ? esc(editData.notes || '') : '') + '</textarea></div>' +
    '<div style="margin-top:12px"><label class="kp-label">Бележка при пускане на КП <span style="opacity:.6">— излиза като коментар под всяка нова КП карта, с таг на отговорника</span></label>' +
      '<textarea class="input" id="kpLaunchNote" rows="3" style="width:100%;resize:vertical" placeholder="Напр. какво да се има предвид при този клиент, линкове, изисквания…">' + (isEdit ? esc(editData.kp_launch_note || '') : '') + '</textarea></div>' +
    '<div style="margin-top:16px;display:flex;gap:8px">' +
      '<button class="btn btn-primary" onclick="saveKpClient(' + (isEdit ? editData.id : 'null') + ')">' + (isEdit ? 'Запази' : 'Добави') + '</button>' +
      '<button class="btn" onclick="kpHideForm()">Отказ</button>' +
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
      var numEl = document.getElementById('kpKpNum');
      var n = parseInt(numEl && numEl.value) || 1;
      hintEl.textContent = 'КП-' + n + ' ще излезе с ' + videos + ' видеа през ' + data.interval + ' дни: ' +
        (data.datesBg || []).join(', ') + '. След него КП-' + (n + 1) + ' тръгва на ' +
        formatDate(data.nextKpFirstDate) + ' — цикъл ' + data.cycleDays + ' дни.';
    }
  } catch(e) { /* ignore */ }
}

async function editKpClientForm(id) {
  var client = _kpClients.find(function(c) { return c.id === id; });
  if (!client) return;
  kpPlaceFormUnder(id);
  showKpClientForm(client);
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
  var data = {
    name: name,
    videos_per_month: parseInt(document.getElementById('kpVideos').value) || parseInt(_platformConfig.kp_default_videos) || KP_STD_VIDEOS,
    publish_interval_days: parseInt(document.getElementById('kpInterval').value) || KP_STD_INTERVAL,
    current_kp_number: parseInt(document.getElementById('kpKpNum').value) || 1,
    first_publish_date: (document.getElementById('kpFirstDate') && document.getElementById('kpFirstDate').dataset.value) || null,
    notes: document.getElementById('kpNotes').value || null,
    responsible_person_id: (document.getElementById('kpPerson') || {}).value || null,
    kp_launch_note: (document.getElementById('kpLaunchNote') || {}).value || null
  };
  // Въведената дата Е първото видео на следващия КП (сървърът я пише и в next_kp_date).
  // Последното видео остава на вече пуснатия КП — не го пипаме от формата.
  try {
    var url = id ? '/api/kp/clients/' + id : '/api/kp/clients';
    var method = id ? 'PUT' : 'POST';
    var res = await fetch(url, { method: method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
    var json = await res.json();
    if (!res.ok) return showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + (json.error || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430'), 'error');
    _clientNames = null; _clientNamesPromise = null; // \u0441\u043f\u0438\u0441\u044a\u043a\u044a\u0442 \u0441 \u0438\u043c\u0435\u043d\u0430 \u0432\u0435\u0447\u0435 \u0435 \u0441\u0442\u0430\u0440
    kpHideForm();
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

async function toggleKpPause(clientId, paused) {
  try {
    var res = await fetch('/api/kp/clients/' + clientId + '/pause', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ paused: paused })
    });
    var data = await res.json();
    if (!res.ok) return showToast('Грешка: ' + (data.error || 'Неизвестна'), 'error');
    showToast(paused ? '⏸ Клиентът е на пауза' : '▶ Клиентът продължава', 'success');
    var el = document.getElementById('pageContent');
    if (el) await loadKpAuto(el);
  } catch (err) { showToast('Грешка: ' + err.message, 'error'); }
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

// ==================== КП-АВТОМАТИЗАЦИЯ → НАСТРОЙКИ ====================
// Свързване на клиент с Basecamp проект (Венци, 21.11.2026): всичко, което се прави
// „за клиента", трябва със 100% сигурност да отиде в НЕГОВИЯ проект. Авто-съвпадението
// по име е само предложение — истината е потвърдената тук връзка.
var _kpLinks = null;

async function renderKpSettings(el) {
  el.innerHTML = '<div class="home-content-box home-content-box--wide"><div class="kp-auto-wrap"><div style="text-align:center;padding:40px;color:var(--text-dim)">Зареждане...</div></div></div>';
  try {
    var res = await fetch('/api/kp/project-links');
    var data = await res.json();
    if (!res.ok) throw new Error((data && data.error) || 'Неуспешно зареждане');
    _kpLinks = data;
  } catch (err) {
    el.innerHTML = '<div class="home-content-box home-content-box--wide"><div style="text-align:center;padding:40px;color:var(--red)">Грешка: ' + esc(err.message) + '</div></div>';
    return;
  }
  var isAdmin = currentUser && currentUser.role === 'admin';
  var clients = _kpLinks.clients || [];
  var projects = _kpLinks.projects || [];
  var bcUrl = function (pid) { return 'https://3.basecamp.com/' + esc(_kpLinks.account || '') + '/projects/' + esc(pid); };

  var done = clients.filter(function (c) { return c.confirmed && c.project_id && !c.project_missing; }).length;
  var rows = clients.map(function (c) {
    var status, cur;
    if (c.project_id && c.project_missing) {
      status = '<span style="color:var(--red)">⚠ Проектът вече не се вижда в Basecamp</span>';
    } else if (c.project_id && c.confirmed) {
      status = '<span style="color:#46a374">✓ Потвърдено</span>';
    } else if (c.project_id) {
      status = '<span style="color:#e8a030">Авто (по име) — непотвърдено</span>';
    } else if (c.suggestion) {
      status = '<span style="color:#e8a030">Предложение: ' + esc(c.suggestion.name) + '</span>';
    } else {
      status = '<span style="color:var(--text-dim)">Не е свързан</span>';
    }
    cur = c.project_id || (c.suggestion && c.suggestion.project_id) || '';
    var opts = '<option value="">— не е свързан —</option>' + projects.map(function (p) {
      return '<option value="' + esc(p.project_id) + '"' + (p.project_id === cur ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('');
    var openLink = c.project_id && !c.project_missing
      ? ' <a class="btn btn-sm btn-ghost" href="' + bcUrl(c.project_id) + '" target="_blank" rel="noopener" title="Отваря проекта в Basecamp">↗</a>' : '';
    var control = isAdmin
      ? '<select class="input" id="kpLinkSel' + c.id + '" style="min-width:240px">' + opts + '</select> ' +
        '<button class="btn btn-sm btn-primary" onclick="saveKpProjectLink(' + c.id + ')">' + (c.confirmed ? 'Запази' : '✓ Потвърди') + '</button>' + openLink
      : (c.project_name ? esc(c.project_name) + openLink : '—');
    return '<tr' + (c.paused ? ' style="opacity:.55"' : '') + '>' +
      '<td class="kp-td"><strong>' + esc(c.name) + '</strong>' + (c.paused ? ' <span style="color:var(--text-dim)">⏸</span>' : '') + '</td>' +
      '<td class="kp-td">' + control + '</td>' +
      '<td class="kp-td">' + status + '</td>' +
    '</tr>';
  }).join('');

  el.innerHTML = '<div class="home-content-box home-content-box--wide"><div class="kp-auto-wrap">' +
    '<div class="kp-auto-header">' +
      '<h2 class="kp-auto-title">⚙ КП-Автоматизация — Настройки</h2>' +
      '<a class="btn btn-sm" href="#/kp-auto">← Към клиентите</a>' +
    '</div>' +
    '<h3 style="margin:0 0 6px;font-size:15px">Свързване на клиент с Basecamp проект</h3>' +
    '<p style="margin:0 0 12px;color:var(--text-dim);font-size:13px">Всичко, което ботовете правят „за клиента", отива в потвърдения тук проект. ' +
      'Предложенията по име са само ориентир — провери и натисни „Потвърди". Един проект може да е свързан само с един клиент. ' +
      '<strong>' + done + ' от ' + clients.length + '</strong> клиента са потвърдени.' +
      (isAdmin ? '' : ' Промени може да прави само админ.') + '</p>' +
    (clients.length === 0
      ? '<div style="text-align:center;padding:40px;color:var(--text-dim)">Няма клиенти.</div>'
      : '<div class="kp-table-wrap"><table class="kp-table"><thead><tr>' +
          '<th class="kp-th">Клиент</th><th class="kp-th">Basecamp проект</th><th class="kp-th">Статус</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>') +
  '</div></div>';
}

async function saveKpProjectLink(clientId) {
  var sel = document.getElementById('kpLinkSel' + clientId);
  if (!sel) return;
  try {
    var res = await fetch('/api/kp/clients/' + clientId + '/bc-project', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: sel.value || null }),
    });
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(json.error || 'Грешка при запис');
    if (typeof showToast === 'function') showToast(sel.value ? 'Свързано и потвърдено' : 'Връзката е премахната', 'success');
    renderKpSettings(document.getElementById('pageContent') || sel.closest('.full-width'));
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message, 'error'); else alert(err.message);
  }
}


// История на клиента: пуснатите КП-та с датите им + ръчните редакции/паузи.
var KP_HIST_LABELS = {
  create_client: '➕ Добавен', update_client: '✏️ Редакция', create_kp_card: '📋 Пуснат КП (ръчно)',
  auto_create_kp_card: '🤖 Пуснат КП (график)', pause_client: '⏸ Пауза', resume_client: '▶ Продължи'
};

function kpHistDetails(action, details) {
  if (action === 'update_client' || action === 'create_client') {
    try {
      var d = JSON.parse(details || '{}');
      var parts = [];
      if (d.current_kp_number) parts.push('следващ КП-' + d.current_kp_number);
      if (d.first_publish_date) parts.push('първо видео ' + formatDate(d.first_publish_date));
      if (d.videos_per_month) parts.push(d.videos_per_month + ' видеа');
      if (d.publish_interval_days) parts.push('през ' + d.publish_interval_days + ' дни');
      return parts.join(' · ');
    } catch (e) { return details || ''; }
  }
  if (action === 'pause_client' || action === 'resume_client') return '';
  return String(details || '').replace(/\s*\(https?:[^)]*\)/g, '');
}

async function toggleKpHistory(id) {
  var row = document.getElementById('kpHist' + id);
  if (!row) return;
  if (row.style.display !== 'none') { row.style.display = 'none'; return; }
  var cell = row.firstElementChild;
  row.style.display = '';
  cell.innerHTML = '<span style="color:var(--text-dim)">Зареждам историята…</span>';
  try {
    var res = await fetch('/api/kp/clients/' + id + '/history');
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Грешка');
    var items = data.history || [];
    cell.innerHTML = items.length
      ? '<div style="font-size:12px;line-height:1.7">' + items.map(function (h) {
          var when = new Date(h.created_at);
          var whenStr = when.toLocaleDateString('bg-BG') + ' ' + when.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
          var det = kpHistDetails(h.action, h.details);
          return '<div><span style="color:var(--text-dim)">' + esc(whenStr) + '</span> · <strong>' +
            esc(KP_HIST_LABELS[h.action] || h.action) + '</strong> · ' + esc(h.user_name || '') +
            (det ? ' — ' + esc(det) : '') + '</div>';
        }).join('') + '</div>'
      : '<span style="color:var(--text-dim)">Няма записи.</span>';
  } catch (err) {
    cell.innerHTML = '<span style="color:var(--red)">Грешка: ' + esc(err.message) + '</span>';
  }
}


// ---------- ℹ Как работи (Венци, 23.11.2026) ----------
// Цялата карта на КП-Автоматизацията на една страница: какво прави всяко нещо,
// кога се случва и какво трябва да направи човек. Отдолу — предложения какво
// липсва и как може да се подобри. Статичен текст: при промяна в логиката се
// обновява заедно с кода.
function renderKpInfo(el) {
  function sec(title, body) {
    return '<section class="kp-info-sec"><h3>' + title + '</h3>' + body + '</section>';
  }
  el.innerHTML = '<div class="home-content-box home-content-box--wide kp-full"><div class="kp-auto-wrap kp-info">' +
    '<div class="kp-auto-header">' +
      '<h2 class="kp-auto-title">ℹ КП-Автоматизация — как работи</h2>' +
      '<a class="btn btn-sm" href="#/kp-auto">← Към списъка</a>' +
    '</div>' +

    sec('1. Накратко',
      '<p>За всеки клиент платформата помни <strong>кой е следващият контент план (КП)</strong> и <strong>кога е първото му видео</strong>. ' +
      'Навреме пуска карта „{Клиент} КП-N“ в Basecamp (Pre-Production → Измисляне) с готовите дати за публикуване. Екипът я попълва с идеи. ' +
      'После планът се разбива на отделни задачи за всяко видео, архивира се, а накрая излиза картата с резултатите.</p>') +

    sec('2. Пътят на един КП',
      '<ol>' +
        '<li><strong>Клиент в списъка.</strong> Име (точно както е в Basecamp), брой видеа, интервал, следващ КП № и първото му видео. Отговорник = контент криейтърът на клиента.</li>' +
        '<li><strong>Създаване на картата.</strong> Ботът минава всеки работен ден в 08:00 (по подразбиране). Пуска картата, когато дойде датата в колоната „Създаване на“. Може и по-рано, ако предишният КП на клиента вече е минал напред („В продукция“ или приключен). Бутонът „📋 Нов КП“ прави същото ръчно, веднага.</li>' +
        '<li><strong>Съдържание на картата.</strong> Шаблонът от Админ → КП-Автоматизация: датите за публикуване (по една на видео) и празни секции „Видео N - ХХХ“. Получава и стъпка „Pre-Production - Готов сценарий“ със срок X работни дни преди първото видео (с празниците).</li>' +
        '<li><strong>Придвижване на клиента.</strong> Веднага след пускането номерът става N+1. Първото видео на следващия КП = последното видео + интервала. „Последно видео (пуснат КП)“ = последното видео на току-що пуснатия план.</li>' +
        '<li><strong>Отговорник и бележка.</strong> Ако клиентът има отговорник, той става Assigned To на картата. Ако има „Бележка при пускане на КП“, тя излиза като коментар под картата с таг на отговорника.</li>' +
        '<li><strong>Коментар и Content агент</strong> (ако са включени в Настройки). Коментар под картата тагва отговорните контент криейтъри с какво трябва да се направи. Content агентът може сам да проучи клиента и да даде идеи и скриптове.</li>' +
        '<li><strong>Попълване на плана.</strong> Екипът пише идеите в секциите „Видео N - Заглавие“. Срокът е стъпката „Готов сценарий“.</li>' +
        '<li><strong>Разбиване на задачи</strong> („Създай задачи по КП“). Всяка секция става отделна карта в „Разпределение“ с дата за публикуване = Due On и стъпки назад от нея (снимане, монтаж, качване). Текстът на плана отива в архива: Basecamp Docs „Контент планове - Архив“ + Z:\\Контент планове - Архив.</li>' +
        '<li><strong>Резултати</strong> (ако са включени). 3 дни след последното видео по плана излиза известие/карта „{Клиент} КП-N - Резултати“.</li>' +
      '</ol>') +

    sec('3. Колоните в списъка',
      '<ul>' +
        '<li><strong>Отговорник</strong> — контент криейтърът на клиента. Служи за подредба и филтър.</li>' +
        '<li><strong>Видеа / Интервал</strong> — колко видеа има в КП и през колко дни излизат. Стандартът е 10 през 3 дни.</li>' +
        '<li><strong>Последно видео (пуснат КП)</strong> — последната дата от вече пуснатия план.</li>' +
        '<li><strong>Следващ КП</strong> — номерът, с който ще излезе следващата карта.</li>' +
        '<li><strong>Първо видео (следв. КП)</strong> — от тази дата тръгват датите в следващата карта.</li>' +
        '<li><strong>Създаване на</strong> — кога ботът ще пусне картата. В червено ⚠ = датата е минала (ще излезе при следващото минаване).</li>' +
        '<li><strong>⚠️ до името</strong> — клиентът няма активна КП карта в колоната. „🚀 Пусни КП“ я създава.</li>' +
        '<li><strong>📜</strong> — историята: кога и с какви дати е пуснат всеки КП, кой какво е редактирал, паузи.</li>' +
        '<li><strong>⏸ Пауза</strong> — ботът не пуска нищо, но датите и номерът се пазят. При „▶ Продължи“ първо провери датите.</li>' +
      '</ul>') +

    sec('4. Как да оправя дати на клиент',
      '<ol>' +
        '<li>✏️ на клиента (формата се отваря точно под реда му).</li>' +
        '<li>„Следващ КП №“ = номерът на плана, който <em>още не е пуснат</em>. „Първо видео на този КП“ = неговата първа дата.</li>' +
        '<li>Под формата се вижда целият график: „КП-N ще излезе с … След него КП-N+1 тръгва на …“. Ако изглежда правилно — Запази.</li>' +
        '<li>Ако картата трябва да излезе веднага — „📋 Нов КП“. Иначе ботът я пуска сам на датата в „Създаване на“.</li>' +
      '</ol>' +
      '<p style="color:var(--text-dim)">Внимание: „📋 Нов КП“ винаги пуска нова карта и мести клиента напред с един КП. Натиснат два пъти, пуска два плана.</p>') +

    sec('5. Кой какво прави',
      '<ul>' +
        '<li><strong>Акаунт / Венци</strong> — добавя клиента, задава дати и отговорник, слага на пауза при спиране и проверява датите при връщане.</li>' +
        '<li><strong>Контент криейтър (отговорник)</strong> — попълва плана до срока „Готов сценарий“ и после го разбива на задачи.</li>' +
        '<li><strong>Ботът ThePactAlerts</strong> — пуска картите по график, пише коментара, следи за резултатите.</li>' +
        '<li><strong>Админ → КП-Автоматизация</strong> — час на бота, колко работни дни по-рано излиза картата, срок за готов план, шаблони, дъска/колона.</li>' +
      '</ul>') +

    sec('6. Предложения — какво липсва и как да се оптимизира',
      '<ol>' +
        '<li><strong>Защита от двойно пускане.</strong> „📋 Нов КП“ да пита „Сигурен ли си — клиентът вече има отворен КП-N“, когато има активна карта или е пуснат КП в последните 7 дни. Днес Sirvis получи КП-2 и КП-3 за 5 минути.</li>' +
        '<li><strong>Проверка при „▶ Продължи“.</strong> Когато клиент се върне от пауза с дата в миналото, да се отвори направо формата с предложена нова дата, вместо ботът да пусне веднага план със стари дати.</li>' +
        '<li><strong>Автоматичният коментар</strong> (Настройки, сега изключен) тагва всички контент криейтъри. Може да тагва само отговорника, както вече прави „Бележка при пускане на КП“.</li>' +
        '<li><strong>„Отмени последното пускане“.</strong> Бутон в 📜, който връща номера и датите отпреди последния КП (само в платформата, картата в Basecamp се трие ръчно). Така грешка не изисква ръчно смятане.</li>' +
        '<li><strong>Предупреждение при разминаване.</strong> Ако датите в реалната КП карта (ръчно сменени в Basecamp) се различават от тези, които платформата помни, да се показва ⚠ в реда.</li>' +
        '<li><strong>Обобщение по отговорник.</strong> Колко клиента и колко видеа на месец има всеки контент криейтър — за баланс на натоварването.</li>' +
        '<li><strong>Резултатите и коментарът са изключени</strong> в Настройки. Ако са нужни, да се включат. Ако не, да се махнат от потока, за да не объркват.</li>' +
      '</ol>' +
      '<p style="color:var(--text-dim)">Нито едно от предложенията не е приложено. Кажи кои искаш.</p>') +
  '</div></div>';
}
