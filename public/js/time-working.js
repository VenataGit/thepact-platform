// ==================== "КОЙ РАБОТИ СЕГА" (The Pact Tools таймери) ====================
// Живо състояние кой по коя Basecamp задача работи в момента. Пълни се от
// GET /api/time/active и се поддържа по WS (time:working:start/stop).
// Часовничето на dash картите свети червено, докато някой работи по картата.

const _twWorking = new Map(); // bcRecordingId (string) -> { userId, userName, startedAt, title }

async function twLoad() {
  try {
    const r = await fetch('/api/time/active');
    if (!r.ok) return;
    const list = await r.json();
    _twWorking.clear();
    (list || []).forEach((e) => {
      if (e.bcRecordingId) {
        _twWorking.set(String(e.bcRecordingId), {
          userId: e.userId, userName: e.userName || 'Някой', startedAt: e.startedAt, title: e.title || ''
        });
      }
    });
    twPaint();
  } catch { /* offline — ще догоним на следващия sync */ }
}

function twHandleWS(ev) {
  if (ev.type === 'time:working:start' && ev.bcRecordingId) {
    _twWorking.set(String(ev.bcRecordingId), {
      userId: ev.userId, userName: ev.userName || 'Някой',
      startedAt: ev.startedAt || new Date().toISOString(), title: ev.title || ''
    });
    twPaint();
  }
  if (ev.type === 'time:working:stop') {
    if (ev.bcRecordingId) {
      _twWorking.delete(String(ev.bcRecordingId));
    } else if (ev.userId) {
      for (const [k, v] of _twWorking) { if (v.userId === ev.userId) _twWorking.delete(k); }
    }
    twPaint();
  }
  // отчетната страница се опреснява на живо, ако е отворена
  if (typeof window._trOnWorking === 'function') window._trOnWorking(ev);
}

function twMinutes(w) {
  return Math.max(1, Math.round((Date.now() - new Date(w.startedAt).getTime()) / 60000));
}

function twPaint() {
  document.querySelectorAll('.dash-card[data-card-id]').forEach((el) => {
    const btn = el.querySelector('.dash-card__timer');
    if (!btn) return;
    const w = _twWorking.get(String(el.dataset.cardId));
    if (w) {
      btn.classList.add('dash-card__timer--working');
      btn.title = '⏱ ' + w.userName + ' работи по това в момента (' + twMinutes(w) + ' мин)';
    } else {
      btn.classList.remove('dash-card__timer--working');
      btn.title = 'Следене на времето';
    }
  });
}

// Дашбордът се пре-рендва асинхронно — след всяка смяна на съдържанието боядисваме
// наново (клас/title промените са attribute мутации и не тригерират този observer).
(function twObserve() {
  const host = document.getElementById('pageContent') || document.body;
  new MutationObserver(() => { if (_twWorking.size) twPaint(); })
    .observe(host, { childList: true, subtree: true });
})();

setInterval(() => { if (_twWorking.size) twPaint(); }, 30000); // опреснява "(X мин)"
setInterval(twLoad, 120000); // догонващ sync при изпуснато WS събитие
twLoad();
