// PM Agent — чатът (Фаза 2): tool-use цикъл върху снапшота.
//
// Поток: Венци пише → пазим реда в agent_chat_messages → цикъл с Claude
// (tools от tools.js) → прогресът и финалният отговор отиват по WebSocket
// (sendToUser) → всяка стъпка се пази в БД, за да е издръжлив разговорът
// на рестарти и да се вижда от всяко устройство.
const { query, queryOne, execute } = require('../../db/pool');
const { callClaude } = require('./claude');
const { TOOL_DEFS, executeTool } = require('./tools');
const { getReadAuth } = require('./snapshot');

let chatBusy = false;

const MAX_TURNS = 12;           // максимум Claude заявки на едно съобщение
const HISTORY_CHAR_CAP = 300_000; // ~85k токена контекст от историята

const CHAT_SYSTEM = () => {
  const today = new Date().toLocaleDateString('bg-BG', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' });
  return `Ти си "PM Agent" — безкомпромисният project manager на The Pact (българска видео продукционна агенция). Говориш само с Венци (основателя). Днес е ${today}.

Контекст: работата тече в Basecamp. Вътрешен проект "Video Production" с дъски Pre-Production → Production → Post-Production → Акаунт Мениджмънт + "Услуги извън КП", "Задачи", "Ops/Admin". Карти по конвенция "Клиент КП-X - Видео Y - Заглавие". Клиентите имат отделни проекти (съобщения/задачи/чат), където пишат и самите клиенти. Ти имаш пълен снапшот на всичко през инструментите.

Правила:
- Отговаряй на български, конкретно и директно, без празни любезности.
- ВИНАГИ проверявай фактите с инструментите — не си измисляй карти, срокове или коментари. Ако снапшотът не съдържа нещо, кажи го.
- Дълбочина: когато Венци пита "какво става с X", изрови всичко — карти, коментари, клиентска комуникация — и дай преценка на PM, не преразказ.
- Действия: когато трябва да се създаде/промени нещо в Basecamp, ползвай propose_action и кажи на Венци какво чака одобрение (бутонът е в чата). НИКОГА не обещавай, че вече е направено.
- Клиентските проекти са само за четене. Не предлагай съобщения до клиенти.
- Пиши линкове като голи URL-и. Форматирай с обикновен текст (без markdown таблици).
- Дръж отговорите стегнати: първо изводът, после детайлите.`;
};

// Историята: последните редове от активния разговор, подрязани до валидно
// начало (user ред с обикновен текст) и до лимита от знаци.
async function loadHistory() {
  const rows = await query(
    'SELECT role, content FROM agent_chat_messages WHERE NOT archived ORDER BY id DESC LIMIT 80');
  rows.reverse();
  // Режем отпред до първо user съобщение с plain text (не tool_result),
  // иначе Claude API отхвърля осиротели tool блокове.
  let start = 0;
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i].content;
    const isPlainUser = rows[i].role === 'user' && Array.isArray(c) && c.some((b) => b.type === 'text');
    if (isPlainUser) { start = i; break; }
    if (i === rows.length - 1) start = rows.length; // няма валидно начало
  }
  let msgs = rows.slice(start).map((r) => ({ role: r.role, content: r.content }));
  // Char cap: махаме най-старите ЦЕЛИ обмени (до следващ plain user ред).
  let total = msgs.reduce((n, m) => n + JSON.stringify(m.content).length, 0);
  while (total > HISTORY_CHAR_CAP && msgs.length > 2) {
    msgs.shift();
    while (msgs.length && !(msgs[0].role === 'user' && msgs[0].content.some((b) => b.type === 'text'))) msgs.shift();
    total = msgs.reduce((n, m) => n + JSON.stringify(m.content).length, 0);
  }
  return msgs;
}

async function storeMessage(role, content) {
  await execute('INSERT INTO agent_chat_messages (role, content) VALUES ($1, $2)', [role, JSON.stringify(content)]);
}

function wsSend(userId, event) {
  try {
    const { sendToUser } = require('../../ws/broadcast');
    sendToUser(userId, event);
  } catch (err) { console.warn('[pm-agent] ws send failed:', err.message); }
}

// Главният вход: обработва едно съобщение от Венци (async, WS известява).
async function handleChatMessage(userId, text) {
  if (chatBusy) {
    wsSend(userId, { type: 'agent:chat:done', text: '⏳ Още обработвам предишното съобщение — изчакай го.', busy: true });
    return;
  }
  chatBusy = true;
  try {
    await storeMessage('user', [{ type: 'text', text }]);
    const auth = await getReadAuth();
    const ctx = {
      auth,
      onProposal: (proposalId) => {
        // Ново предложение → чатът го показва веднага с бутони.
        queryOne('SELECT * FROM agent_proposals WHERE id = $1', [proposalId])
          .then((p) => { if (p) wsSend(userId, { type: 'agent:proposal', proposal: p }); })
          .catch(() => {});
      },
    };

    let messages = await loadHistory();
    let finalText = '';
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await callClaude({
        system: CHAT_SYSTEM(),
        messages,
        tools: TOOL_DEFS,
        maxTokens: 8000,
        effort: 'high',
      });
      await storeMessage('assistant', res.content);
      messages.push({ role: 'assistant', content: res.content });

      if (res.stopReason === 'tool_use') {
        const toolUses = res.content.filter((b) => b.type === 'tool_use');
        wsSend(userId, { type: 'agent:chat:tool', tools: toolUses.map((t) => t.name) });
        const results = [];
        for (const tu of toolUses) {
          let result;
          try {
            result = await executeTool(tu.name, tu.input || {}, ctx);
          } catch (err) {
            result = { error: err.message };
          }
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
        }
        await storeMessage('user', results);
        messages.push({ role: 'user', content: results });
        continue;
      }

      finalText = res.text || '(празен отговор)';
      if (res.stopReason === 'max_tokens') finalText += '\n\n⚠ Отговорът е отрязан по дължина.';
      break;
    }
    if (!finalText) finalText = '⚠ Стигнах лимита от стъпки, без да завърша — пробвай да разбиеш въпроса.';
    wsSend(userId, { type: 'agent:chat:done', text: finalText });
  } catch (err) {
    console.error('[pm-agent] chat error:', err.message);
    wsSend(userId, { type: 'agent:chat:done', text: `⚠ Грешка: ${err.message}`, error: true });
  } finally {
    chatBusy = false;
  }
}

// Историята за UI-а: само видимите неща (текст + предложения по ред).
async function chatHistoryForUi() {
  const rows = await query(
    'SELECT id, role, content, created_at FROM agent_chat_messages WHERE NOT archived ORDER BY id LIMIT 200');
  const out = [];
  for (const r of rows) {
    const blocks = Array.isArray(r.content) ? r.content : [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const proposals = blocks.filter((b) => b.type === 'tool_use' && b.name === 'propose_action').length;
    if (text || (r.role === 'assistant' && proposals)) {
      out.push({ id: r.id, role: r.role, text, at: r.created_at });
    }
  }
  return out;
}

async function resetChat() {
  await execute('UPDATE agent_chat_messages SET archived = TRUE WHERE NOT archived');
}

function isChatBusy() { return chatBusy; }

module.exports = { handleChatMessage, chatHistoryForUi, resetChat, isChatBusy };
