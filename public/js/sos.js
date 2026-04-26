// ==================== SOS SYSTEM + VIDEO CARDS ====================
function generateVideoCards(cardId, cardTitle, btn) {
  showConfirmModal('\u0429\u0435 \u0431\u044a\u0434\u0430\u0442 \u0433\u0435\u043d\u0435\u0440\u0438\u0440\u0430\u043d\u0438 \u0432\u0438\u0434\u0435\u043e \u0437\u0430\u0434\u0430\u0447\u0438 \u0437\u0430 "' + cardTitle + '".\n\u041a\u0430\u0440\u0442\u0438\u0442\u0435 \u0449\u0435 \u0431\u044a\u0434\u0430\u0442 \u0441\u044a\u0437\u0434\u0430\u0434\u0435\u043d\u0438 \u0432 \u043a\u043e\u043b\u043e\u043d\u0430 "\u0420\u0430\u0437\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d\u0438\u0435". \u041f\u0440\u043e\u0434\u044a\u043b\u0436\u0430\u0432\u0430\u0448?', async function() {
    if (btn) { btn.disabled = true; btn.textContent = '\u23f3 \u0413\u0435\u043d\u0435\u0440\u0438\u0440\u0430\u043d\u0435...'; }
    try {
      var res = await fetch('/api/kp/generate-video-cards/' + cardId, { method: 'POST' });
      var data = await res.json();
      if (data.ok) {
        showToast('\u2705 \u0413\u0435\u043d\u0435\u0440\u0438\u0440\u0430\u043d\u0438 ' + data.count + ' \u0432\u0438\u0434\u0435\u043e \u0437\u0430\u0434\u0430\u0447\u0438 \u0443\u0441\u043f\u0435\u0448\u043d\u043e!', 'success');
      } else {
        showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + (data.error || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430 \u0433\u0440\u0435\u0448\u043a\u0430'), 'error');
      }
    } catch (err) {
      showToast('\u0413\u0440\u0435\u0448\u043a\u0430: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '\u2699\ufe0f \u0413\u0435\u043d\u0435\u0440\u0438\u0440\u0430\u0439 \u0437\u0430\u0434\u0430\u0447\u0438'; }
    }
  });
}

// ==================== SOS СИСТЕМА ====================
function openSosModal(cardId, cardTitle) {
  document.querySelectorAll('#sosModal').forEach(m => m.remove());
  fetch('/api/users/team').then(r => r.json()).then(function(users) {
    var userOpts = users.filter(function(u) { return u.id !== currentUser.id; }).map(function(u) {
      return '<label><input type="checkbox" value="' + u.id + '"> ' + esc(u.name) + '</label>';
    }).join('');
    var modal = document.createElement('div');
    modal.id = 'sosModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = '<div class="sos-modal-box">' +
      '<div class="sos-modal-header">' +
        '<span class="sos-modal-header__icon">🚨</span>' +
        '<span>Спешен сигнал</span>' +
      '</div>' +
      '<div class="sos-modal-body">' +
        (cardId ? '<div class="sos-card-ref">📌 Карта: <strong>' + esc(cardTitle || '') + '</strong></div>' : '') +
        '<div>' +
          '<label class="sos-field-label">Съобщение<span class="sos-field-hint">(по избор)</span></label>' +
          '<textarea id="sosMessage" class="sos-textarea" rows="3" placeholder="Опиши какво е спешното..."></textarea>' +
        '</div>' +
        '<div>' +
          '<label class="sos-field-label">Изпрати до</label>' +
          '<div class="sos-target-options">' +
            '<label class="sos-target-option"><input type="radio" name="sosTarget" value="all" checked> <strong>Целия екип</strong></label>' +
            '<label class="sos-target-option"><input type="radio" name="sosTarget" value="specific"> Конкретни хора</label>' +
          '</div>' +
          '<div id="sosUserList" class="sos-user-list">' + userOpts + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="sos-modal-footer">' +
        '<button class="btn" onclick="document.getElementById(\'sosModal\').remove()">Отказ</button>' +
        '<button class="btn sos-send-btn" onclick="sendSos(' + (cardId || 'null') + ')">🚨 Изпрати сигнал</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(modal);
    // Show/hide user list on radio change
    modal.querySelectorAll('input[name="sosTarget"]').forEach(function(r) {
      r.addEventListener('change', function() {
        document.getElementById('sosUserList').classList.toggle('is-visible', this.value === 'specific');
      });
    });
    modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
    // Auto-focus textarea
    setTimeout(function() { var ta = document.getElementById('sosMessage'); if (ta) ta.focus(); }, 50);
  }).catch(function() { showToast('Грешка при зареждане', 'error'); });
}

async function sendSos(cardId) {
  var message = document.getElementById('sosMessage').value.trim();
  var targetRadio = document.querySelector('input[name="sosTarget"]:checked');
  var targetAll = !targetRadio || targetRadio.value === 'all';
  var targetUserIds = [];
  if (!targetAll) {
    document.querySelectorAll('#sosUserList input:checked').forEach(function(cb) {
      targetUserIds.push(parseInt(cb.value));
    });
    if (targetUserIds.length === 0) return showToast('Избери поне един човек', 'warn');
  }
  try {
    var res = await fetch('/api/sos', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ message, card_id: cardId || null, target_all: targetAll, target_user_ids: targetUserIds })
    });
    var data = await res.json();
    if (data.ok) {
      document.getElementById('sosModal').remove();
    } else {
      showToast('Грешка: ' + (data.error || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430'), 'error');
    }
  } catch (err) { showToast('Грешка: ' + err.message, 'error'); }
}

function showSosAlert(ev) {
  // Check if this alert is for current user
  if (!ev.targetAll && ev.targetUserIds && !ev.targetUserIds.includes(currentUser.id)) return;
  if (ev.senderId === currentUser.id) return; // Don't alert yourself

  // Play SOS sound
  playSosSound();

  // Browser notification
  if (Notification.permission === 'granted') {
    new Notification('🚨 Спешен сигнал от ' + ev.senderName, {
      body: ev.message || (ev.cardTitle ? 'Карта: ' + ev.cardTitle : 'Погледни платформата'),
      icon: '/img/logo-white.svg'
    });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission();
  }

  // Remove existing SOS banners
  document.querySelectorAll('.sos-alert-banner').forEach(function(b) { b.remove(); });

  var banner = document.createElement('div');
  banner.className = 'sos-alert-banner';
  banner.innerHTML =
    '<span class="sos-alert-icon">🚨</span>' +
    '<div class="sos-alert-content">' +
      '<strong>Спешен сигнал от ' + esc(ev.senderName) + '</strong>' +
      (ev.message ? '<span>' + esc(ev.message) + '</span>' : '') +
      (ev.cardTitle ? '<a href="#/card/' + ev.cardId + '" onclick="this.closest(\'.sos-alert-banner\').remove()">→ ' + esc(ev.cardTitle) + '</a>' : '') +
    '</div>' +
    '<button class="sos-alert-resolve" onclick="resolveSos(' + ev.alertId + ',this.closest(\'.sos-alert-banner\'))">✓ Видях</button>' +
    '<button class="sos-alert-close" onclick="this.closest(\'.sos-alert-banner\').remove()">✕</button>';
  document.body.insertBefore(banner, document.body.firstChild);

  // Auto-remove after 5 min
  setTimeout(function() { if (banner.parentNode) banner.remove(); }, 300000);
}

async function resolveSos(alertId, bannerEl) {
  try {
    await fetch('/api/sos/' + alertId + '/resolve', { method: 'PUT' });
    if (bannerEl) bannerEl.remove();
  } catch (err) {}
}

function playSosSound() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    function beep(freq, start, dur) {
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq;
      o.type = 'sine';
      g.gain.setValueAtTime(0.4, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + dur + 0.05);
    }
    beep(880, 0, 0.15);
    beep(880, 0.2, 0.15);
    beep(880, 0.4, 0.15);
    beep(660, 0.65, 0.4);
  } catch(e) {}
}

// ==================== DASHBOARD TIMER TICKER ====================
// 1-second ticker that updates "X дни, Y часа..." labels on the dashboard.
// Skips DOM work when the page isn't visible (tab in background) or when the
// dashboard view isn't active — saves CPU on long-running sessions.
setInterval(function() {
  if (document.hidden) return;
  var bars = document.querySelectorAll('.dash-timer-bar--clean[data-since]');
  if (bars.length === 0) return; // not on dashboard or no clean timers
  bars.forEach(function(el) {
    var since = el.dataset.since;
    if (!since) return;
    var diff = Math.floor((Date.now() - new Date(since).getTime()) / 1000);
    if (diff < 0) diff = 0;
    var days = Math.floor(diff / 86400);
    var hours = Math.floor((diff % 86400) / 3600);
    var mins = Math.floor((diff % 3600) / 60);
    var secs = diff % 60;
    var val = el.querySelector('.dash-timer-value');
    if (val) val.textContent = days + '\u0434, ' + hours + '\u0447, ' + mins + '\u043c, ' + secs + '\u0441';
  });
}, 1000);

// ==================== DRAG FAILSAFE CLEANUP ====================
// Runs whenever any drag ends on the document — covers cases where
// the card-level ondragend doesn't fire (element removed mid-drag, tab blur, etc.)
document.addEventListener('dragend', function() {
  if (dragCardId || document.querySelector('.dragging, .drag-over, .col-drag-over, .dash-drop-over')) {
    dragCardId = null;
    _clearAllDragOver();
  }
});
// Secondary failsafe: pointerup catches cancelled drags where dragend didn't fire
document.addEventListener('pointerup', function() {
  if (!dragCardId) return;
  setTimeout(function() {
    if (dragCardId) { dragCardId = null; _clearAllDragOver(); }
  }, 200);
});
