// ==================== "КОЙ РАБОТИ СЕГА" (The Pact Tools таймери) ====================
// Живо състояние кой по коя Basecamp задача работи в момента. Пълни се от
// GET /api/time/active и се поддържа по WS (time:working:start/stop).
// Часовничето на dash картите мига бавно, докато някой работи по картата.
//
// По една задача може да работят НЯКОЛКО души едновременно (Венци, 16.08.2026),
// затова на карта пазим списък, а не един човек — иначе вторият стартирал таймер
// изтриваше първия и картата „забравяше" кой още работи по нея.

const _twWorking = new Map(); // bcRecordingId (string) -> [{ userId, userName, startedAt, title }]

// Добавя/подменя човек в списъка на картата (един човек = един таймер на карта).
function twAdd(cardId, w) {
  const key = String(cardId);
  const list = _twWorking.get(key) || [];
  const i = list.findIndex((x) => x.userId === w.userId);
  if (i >= 0) list[i] = w; else list.push(w);
  _twWorking.set(key, list);
}

function twRemove(cardId, userId) {
  const key = String(cardId);
  const list = _twWorking.get(key);
  if (!list) return;
  const left = list.filter((x) => x.userId !== userId);
  if (left.length) _twWorking.set(key, left); else _twWorking.delete(key);
}

async function twLoad() {
  try {
    const r = await fetch('/api/time/active');
    if (!r.ok) return;
    const list = await r.json();
    _twWorking.clear();
    (list || []).forEach((e) => {
      if (e.bcRecordingId) {
        twAdd(e.bcRecordingId, {
          userId: e.userId, userName: e.userName || 'Някой', startedAt: e.startedAt, title: e.title || ''
        });
      }
    });
    twPaint();
  } catch { /* offline — ще догоним на следващия sync */ }
}

function twHandleWS(ev) {
  if (ev.type === 'time:working:start' && ev.bcRecordingId) {
    // Един човек работи по едно нещо: старият му таймер другаде вече е спрян от сървъра.
    for (const [k] of [..._twWorking]) { if (k !== String(ev.bcRecordingId)) twRemove(k, ev.userId); }
    twAdd(ev.bcRecordingId, {
      userId: ev.userId, userName: ev.userName || 'Някой',
      startedAt: ev.startedAt || new Date().toISOString(), title: ev.title || ''
    });
    twPaint();
  }
  if (ev.type === 'time:working:stop') {
    if (ev.bcRecordingId && ev.userId != null) {
      twRemove(ev.bcRecordingId, ev.userId);
    } else if (ev.bcRecordingId) {
      _twWorking.delete(String(ev.bcRecordingId));
    } else if (ev.userId != null) {
      for (const [k] of [..._twWorking]) twRemove(k, ev.userId);
    }
    twPaint();
  }
  // отчетната страница се опреснява на живо, ако е отворена
  if (typeof window._trOnWorking === 'function') window._trOnWorking(ev);
}

function twMinutes(w) {
  return Math.max(1, Math.round((Date.now() - new Date(w.startedAt).getTime()) / 60000));
}

// „25 мин" / „1ч 05м" — за да се чете от колко време върви таймерът.
function twSince(w) {
  const m = twMinutes(w);
  return m < 60 ? m + ' мин' : Math.floor(m / 60) + 'ч ' + String(m % 60).padStart(2, '0') + 'м';
}

// Tooltip: един човек → изречение; повече → списък с всички и техните таймери.
function twTitleFor(list) {
  if (list.length === 1) return '⏱ ' + list[0].userName + ' работи по това в момента (' + twSince(list[0]) + ')';
  const who = list.map((w) => '• ' + w.userName + ' (' + twSince(w) + ')').join('\n');
  return '⏱ ' + list.length + ' души работят по това в момента:\n' + who;
}

function twPaint() {
  document.querySelectorAll('.dash-card[data-card-id]').forEach((el) => {
    const btn = el.querySelector('.dash-card__timer');
    if (!btn) return;
    const list = _twWorking.get(String(el.dataset.cardId));
    if (list && list.length) {
      btn.classList.add('dash-card__timer--working');
      // Броячът излиза само при 2+ души — при един човек часовничето говори само.
      if (list.length > 1) btn.dataset.twCount = String(list.length);
      else delete btn.dataset.twCount;
      btn.title = twTitleFor(list);
    } else {
      btn.classList.remove('dash-card__timer--working');
      delete btn.dataset.twCount;
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
