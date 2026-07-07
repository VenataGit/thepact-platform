// ==================== PM AGENT — ЧАТ (#/agent) ====================
// Чат с PM агента (само админ). Отговорите идват по WebSocket (agent:* събития
// от websocket.js → agcHandleWS). Предложенията за действия се одобряват тук.

var _agcBusy = false;
var _agcProposals = {}; // id -> proposal

function renderAgentChat(el) {
  if (!currentUser || currentUser.role !== 'admin') {
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--red)">Нямаш достъп до тази страница.</div>';
    return;
  }
  setBreadcrumb(null);
  el.className = '';
  el.innerHTML =
    '<div style="max-width:860px;margin:0 auto;display:flex;flex-direction:column;height:calc(100vh - 120px)">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0 14px">' +
        '<h1 style="font-size:20px;margin:0">🤖 PM Agent</h1>' +
        '<button class="btn btn-sm" onclick="agcReset()">✚ Нов разговор</button>' +
      '</div>' +
      '<div id="agcMsgs" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:4px 2px"></div>' +
      '<div id="agcStatus" style="min-height:20px;font-size:12px;opacity:.7;padding:6px 2px"></div>' +
      '<div style="display:flex;gap:8px;align-items:flex-end">' +
        '<textarea id="agcInput" rows="2" placeholder="Питай PM агента… (Enter = изпрати, Shift+Enter = нов ред)" ' +
          'style="flex:1;resize:none;padding:10px 12px;border-radius:10px;background:var(--bg-card,#1b2930);color:var(--text,#e8ecee);border:1px solid rgba(255,255,255,.12);font:inherit"></textarea>' +
        '<button class="btn btn-primary" id="agcSendBtn" onclick="agcSend()">Изпрати</button>' +
      '</div>' +
    '</div>';
  var input = document.getElementById('agcInput');
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); agcSend(); }
  });
  agcLoad();
}

async function agcLoad() {
  var host = document.getElementById('agcMsgs');
  if (!host) return;
  host.innerHTML = '<div style="opacity:.6;font-size:13px">Зареждане…</div>';
  try {
    var res = await fetch('/api/agent/chat/history');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    _agcProposals = {};
    (data.proposals || []).forEach(function (p) { _agcProposals[p.id] = p; });
    host.innerHTML = '';
    if (!(data.messages || []).length) {
      host.innerHTML = '<div style="opacity:.6;font-size:13px;text-align:center;padding:30px">Питай ме каквото и да е за Basecamp: „Какво изпускаме при клиент X?", „Кои карти са без срок?", „Направи задачи от идеите в тази карта"…</div>';
    }
    (data.messages || []).forEach(function (m) { agcAppend(m.role, m.text); });
    // Чакащите предложения — най-отдолу, с бутони.
    (data.proposals || []).filter(function (p) { return p.status === 'pending'; })
      .reverse().forEach(function (p) { agcAppendProposal(p); });
    _agcBusy = Boolean(data.busy);
    agcSetBusy(_agcBusy, _agcBusy ? 'Агентът работи…' : '');
    host.scrollTop = host.scrollHeight;
  } catch (e) {
    host.innerHTML = '<div style="color:var(--red);font-size:13px">Грешка: ' + esc(e.message) + '</div>';
  }
}

function agcLinkify(escapedText) {
  return escapedText.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent,#1cb0f6)">$1</a>');
}

function agcAppend(role, text) {
  var host = document.getElementById('agcMsgs');
  if (!host || !text) return;
  var isUser = role === 'user';
  var div = document.createElement('div');
  div.style.cssText = 'max-width:85%;padding:10px 14px;border-radius:12px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word;' +
    (isUser
      ? 'align-self:flex-end;background:var(--accent,#1cb0f6);color:#fff'
      : 'align-self:flex-start;background:var(--bg-card,#1b2930);border:1px solid rgba(255,255,255,.08)');
  div.innerHTML = agcLinkify(esc(text));
  host.appendChild(div);
  host.scrollTop = host.scrollHeight;
}

function agcKindLabel(kind) {
  return {
    create_card: '🗂 Нова карта', create_step: '☑ Нова стъпка', add_comment: '💬 Коментар',
    post_message: '✉ Съобщение', move_card: '➡ Местене на карта',
  }[kind] || kind;
}

function agcAppendProposal(p) {
  var host = document.getElementById('agcMsgs');
  if (!host) return;
  var old = document.getElementById('agcProp' + p.id);
  if (old) old.remove();
  _agcProposals[p.id] = p;
  var payload = p.payload || {};
  var reasoning = payload._reasoning || '';
  var div = document.createElement('div');
  div.id = 'agcProp' + p.id;
  div.style.cssText = 'align-self:stretch;background:rgba(28,176,246,.07);border:1px solid rgba(28,176,246,.35);border-radius:12px;padding:12px 14px;font-size:13px';
  var body = '<div style="font-weight:600;margin-bottom:4px">' + agcKindLabel(p.kind) + ' · Предложение #' + p.id + '</div>' +
    '<div style="margin-bottom:6px">' + esc(p.title || '') + '</div>' +
    (reasoning ? '<div style="opacity:.75;margin-bottom:8px">Защо: ' + esc(reasoning) + '</div>' : '');
  if (p.status === 'pending') {
    body += '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-sm btn-primary" onclick="agcDecide(' + p.id + ',true)">✓ Одобри</button>' +
      '<button class="btn btn-sm" onclick="agcDecide(' + p.id + ',false)">✗ Откажи</button></div>';
  } else {
    var r = p.result || {};
    body += '<div style="opacity:.8">' +
      (p.status === 'done' ? '✓ Изпълнено' + (r.url ? ' — <a href="' + esc(r.url) + '" target="_blank" rel="noopener" style="color:var(--accent,#1cb0f6)">отвори в Basecamp</a>' : '')
        : p.status === 'rejected' ? '✗ Отказано'
        : p.status === 'error' ? '⚠ Грешка: ' + esc((r.error || '')) : esc(p.status)) +
      '</div>';
  }
  div.innerHTML = body;
  host.appendChild(div);
  host.scrollTop = host.scrollHeight;
}

async function agcDecide(id, approve) {
  var p = _agcProposals[id];
  if (!p) return;
  if (approve && !confirm('Изпълнявам „' + (p.title || agcKindLabel(p.kind)) + '" в Basecamp (като ThePactAlerts). Потвърждаваш ли?')) return;
  try {
    var res = await fetch('/api/agent/proposals/' + id + '/' + (approve ? 'approve' : 'reject'), { method: 'POST' });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    agcAppendProposal(data.proposal);
  } catch (e) {
    alert('Грешка: ' + e.message);
    agcLoad();
  }
}

function agcSetBusy(busy, statusText) {
  _agcBusy = busy;
  var btn = document.getElementById('agcSendBtn');
  var status = document.getElementById('agcStatus');
  if (btn) btn.disabled = busy;
  if (status) status.textContent = statusText || '';
}

async function agcSend() {
  if (_agcBusy) return;
  var input = document.getElementById('agcInput');
  var text = (input.value || '').trim();
  if (!text) return;
  input.value = '';
  agcAppend('user', text);
  agcSetBusy(true, 'Агентът мисли…');
  try {
    var res = await fetch('/api/agent/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }),
    });
    if (!res.ok) {
      var data = await res.json().catch(function () { return {}; });
      throw new Error(data.error || ('HTTP ' + res.status));
    }
  } catch (e) {
    agcSetBusy(false, '');
    agcAppend('assistant', '⚠ ' + e.message);
  }
}

// Викана от websocket.js за всички agent:* събития.
function agcHandleWS(ev) {
  if (location.hash.indexOf('#/agent') !== 0) return; // не сме на страницата
  if (ev.type === 'agent:chat:tool') {
    var names = (ev.tools || []).join(', ');
    agcSetBusy(true, '🔎 Агентът работи: ' + names + '…');
  } else if (ev.type === 'agent:chat:done') {
    agcSetBusy(false, '');
    agcAppend('assistant', ev.text || '');
  } else if (ev.type === 'agent:proposal' && ev.proposal) {
    agcAppendProposal(ev.proposal);
  }
}
