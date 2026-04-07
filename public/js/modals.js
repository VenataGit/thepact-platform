// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type, duration) {
  var t = type || 'info';
  var d = duration || 4000;
  var container = document.getElementById('toastContainer');
  if (!container) return;
  var icons = { success: '\u2705', error: '\u274C', warning: '\u26A0\uFE0F', warn: '\u26A0\uFE0F', info: '\u2139\uFE0F' };
  var toast = document.createElement('div');
  toast.className = 'toast toast--' + (t === 'warn' ? 'warning' : t);
  toast.innerHTML =
    '<span class="toast__icon">' + (icons[t] || icons.info) + '</span>' +
    '<div class="toast__content"><div class="toast__message">' + message + '</div></div>' +
    '<button class="toast__close" onclick="this.parentElement.remove()">&times;</button>';
  container.appendChild(toast);
  setTimeout(function() { toast.classList.add('removing'); setTimeout(function() { toast.remove(); }, 300); }, d);
}

// ==================== CONFIRM/PROMPT MODALS ====================
function showConfirmModal(msg, onConfirm, danger, okLabel) {
  var ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box">' +
    '<p class="confirm-modal-msg">' + esc(msg) + '</p>' +
    '<div class="confirm-modal-actions">' +
    '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" id="cmOkBtn">' + esc(okLabel || (danger ? '\u0418\u0437\u0442\u0440\u0438\u0439' : '\u041f\u043e\u0442\u0432\u044a\u0440\u0434\u0438')) + '</button>' +
    '<button class="btn btn-ghost" id="cmCancelBtn">\u041e\u0442\u043a\u0430\u0437</button>' +
    '</div></div>';
  document.body.appendChild(ov);
  function close() { ov.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  ov.querySelector('#cmOkBtn').onclick = function() { close(); onConfirm(); };
  ov.querySelector('#cmCancelBtn').onclick = close;
  ov.onclick = function(e) { if (e.target === ov) close(); };
  document.addEventListener('keydown', onKey);
}
function showPromptModal(title, placeholder, defaultVal, onConfirm, inputType) {
  var ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box">' +
    '<p class="confirm-modal-msg">' + esc(title) + '</p>' +
    '<input class="confirm-modal-input" type="' + (inputType || 'text') + '" id="pmInput" value="' + esc(defaultVal || '') + '" placeholder="' + esc(placeholder || '') + '">' +
    '<div class="confirm-modal-actions">' +
    '<button class="btn btn-primary" id="pmOkBtn">OK</button>' +
    '<button class="btn btn-ghost" id="pmCancelBtn">\u041e\u0442\u043a\u0430\u0437</button>' +
    '</div></div>';
  document.body.appendChild(ov);
  var inp = ov.querySelector('#pmInput');
  setTimeout(function() { inp.focus(); inp.select(); }, 50);
  function submit() { var v = inp.value.trim(); if (!v) { inp.focus(); return; } ov.remove(); onConfirm(v); }
  inp.onkeydown = function(e) { if (e.key === 'Enter') submit(); if (e.key === 'Escape') ov.remove(); };
  ov.querySelector('#pmOkBtn').onclick = submit;
  ov.querySelector('#pmCancelBtn').onclick = function() { ov.remove(); };
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
}

// ==================== CUSTOM DATE PICKER ====================
var _dpCurrentPicker = null;
function showDatePickerPopup(anchorEl, currentValue, onSelect) {
  if (_dpCurrentPicker) { _dpCurrentPicker.remove(); _dpCurrentPicker = null; }
  var today = new Date(); today.setHours(0,0,0,0);
  var selDate = currentValue ? new Date(currentValue.split('T')[0] + 'T12:00:00') : null;
  var viewYear = selDate ? selDate.getFullYear() : today.getFullYear();
  var viewMonth = selDate ? selDate.getMonth() : today.getMonth();
  var MN = ['\u042f\u043d\u0443\u0430\u0440\u0438','\u0424\u0435\u0432\u0440\u0443\u0430\u0440\u0438','\u041c\u0430\u0440\u0442','\u0410\u043f\u0440\u0438\u043b','\u041c\u0430\u0439','\u042e\u043d\u0438','\u042e\u043b\u0438','\u0410\u0432\u0433\u0443\u0441\u0442','\u0421\u0435\u043f\u0442\u0435\u043c\u0432\u0440\u0438','\u041e\u043a\u0442\u043e\u043c\u0432\u0440\u0438','\u041d\u043e\u0435\u043c\u0432\u0440\u0438','\u0414\u0435\u043a\u0435\u043c\u0432\u0440\u0438'];
  var popup = document.createElement('div');
  popup.className = 'date-picker-popup';
  _dpCurrentPicker = popup;
  function renderCal() {
    var first = new Date(viewYear, viewMonth, 1);
    var last = new Date(viewYear, viewMonth + 1, 0);
    var startDow = (first.getDay() + 6) % 7;
    var todayTs = today.getTime();
    var selTs = selDate ? new Date(selDate.getFullYear(), selDate.getMonth(), selDate.getDate()).getTime() : -1;
    var html = '';
    for (var i = 0; i < startDow; i++) html += '<div class="dp-day dp-day--empty"></div>';
    for (var d = 1; d <= last.getDate(); d++) {
      var ts = new Date(viewYear, viewMonth, d).getTime();
      var ds = viewYear + '-' + String(viewMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
      var cls = 'dp-day' + (ts===todayTs?' dp-day--today':'') + (ts===selTs?' dp-day--selected':'');
      html += '<div class="' + cls + '" data-date="' + ds + '">' + d + '</div>';
    }
    popup.innerHTML =
      '<div class="dp-header">' +
        '<button class="dp-nav" data-delta="-1">\u2039</button>' +
        '<span class="dp-month-year">' + MN[viewMonth] + ' ' + viewYear + '</span>' +
        '<button class="dp-nav" data-delta="1">\u203a</button>' +
      '</div>' +
      '<div class="dp-weekdays"><span>\u041f\u043d</span><span>\u0412\u0442</span><span>\u0421\u0440</span><span>\u0427\u0442</span><span>\u041f\u0442</span><span>\u0421\u0431</span><span>\u041d\u0434</span></div>' +
      '<div class="dp-days">' + html + '</div>' +
      '<div class="dp-footer"><button class="dp-clear">\u0418\u0437\u0447\u0438\u0441\u0442\u0438</button></div>';
    popup.querySelectorAll('.dp-nav').forEach(function(btn) {
      btn.onclick = function(e) {
        e.stopPropagation();
        viewMonth += parseInt(btn.dataset.delta);
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        renderCal();
      };
    });
    popup.querySelectorAll('.dp-day:not(.dp-day--empty)').forEach(function(dayEl) {
      dayEl.onclick = function(e) {
        e.stopPropagation();
        selDate = new Date(dayEl.dataset.date + 'T12:00:00');
        onSelect(dayEl.dataset.date);
        popup.remove(); _dpCurrentPicker = null;
      };
    });
    popup.querySelector('.dp-clear').onclick = function(e) {
      e.stopPropagation();
      onSelect(null);
      popup.remove(); _dpCurrentPicker = null;
    };
  }
  renderCal();
  document.body.appendChild(popup);
  var rect = anchorEl.getBoundingClientRect();
  var pw = 264;
  var left = Math.min(rect.left, window.innerWidth - pw - 8);
  var top = rect.bottom + 6;
  if (top + 330 > window.innerHeight) top = Math.max(8, rect.top - 334);
  popup.style.cssText = 'position:fixed;left:' + Math.max(8,left) + 'px;top:' + top + 'px;z-index:10001;width:' + pw + 'px';
  setTimeout(function() {
    function _dpClose(e) {
      if (_dpCurrentPicker && !_dpCurrentPicker.contains(e.target)) {
        _dpCurrentPicker.remove(); _dpCurrentPicker = null;
        document.removeEventListener('click', _dpClose);
      }
    }
    document.addEventListener('click', _dpClose);
  }, 10);
}
function openDueDatePicker(cardId, btn) {
  showDatePickerPopup(btn, btn.dataset.value || '', function(dateStr) {
    btn.dataset.value = dateStr || '';
    btn.textContent = dateStr ? formatDate(dateStr) : '\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026';
    btn.className = dateStr ? 'bc-date-btn' : 'bc-date-btn bc-date-btn--placeholder';
    if (dateStr) { saveDueDateField(cardId, dateStr); }
    else { btn.style.display = 'none'; var r = document.querySelector('[name="due_' + cardId + '"]'); if (r) r.checked = true; updateField(cardId, 'due_on', null); }
  });
}
function openPublishDatePicker(cardId, btn) {
  showDatePickerPopup(btn, btn.dataset.value || '', function(dateStr) {
    btn.dataset.value = dateStr || '';
    btn.textContent = dateStr ? formatDate(dateStr) : '\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026';
    btn.className = dateStr ? 'bc-date-btn' : 'bc-date-btn bc-date-btn--placeholder';
    savePublishDateField(cardId, dateStr || null);
    if (!dateStr) { btn.style.display = 'none'; var r = document.querySelectorAll('[name="pub_' + cardId + '"]')[0]; if (r) r.checked = true; }
  });
}
function openNewStepDatePicker(btn) {
  showDatePickerPopup(btn, btn.dataset.value || '', function(dateStr) {
    btn.dataset.value = dateStr || '';
    btn.textContent = dateStr ? formatDate(dateStr) : '\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026';
    btn.className = dateStr ? 'bc-date-btn' : 'bc-date-btn bc-date-btn--placeholder';
  });
}
function openEditStepDatePicker(stepId, btn) {
  showDatePickerPopup(btn, btn.dataset.value || '', function(dateStr) {
    btn.dataset.value = dateStr || '';
    btn.textContent = dateStr ? formatDate(dateStr) : '\u0418\u0437\u0431\u0435\u0440\u0438 \u0434\u0430\u0442\u0430\u2026';
    btn.className = dateStr ? 'bc-date-btn' : 'bc-date-btn bc-date-btn--placeholder';
  });
}
