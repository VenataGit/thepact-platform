// PM Agent — Одитът (Фаза 1): пълен анализ „какво изпускаме".
//
// Поток: снапшот (ако е празен → пълен sync) → корпус по области (Video Production
// дъските; клиентските проекти) → Opus 4.8 анализ на всяка област → синтез в един
// доклад → публикация в Basecamp от ThePactAlerts, известие САМО до Венци.
const config = require('../../config');
const { query, queryOne, execute } = require('../../db/pool');
const bc = require('../basecamp');
const { getServiceAuth } = require('../basecamp-token');
const { runSync, snapshotCounts, syncInProgress } = require('./snapshot');
const { callClaude, MODEL } = require('./claude');

let running = false;

// ---------- текстови помощни ----------

function stripHtml(html) {
  return String(html || '')
    .replace(/<bc-attachment[^>]*>.*?<\/bc-attachment>/gis, '[файл]')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h1|h2|h3)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cap(text, n) {
  const t = String(text || '');
  return t.length > n ? `${t.slice(0, n)}… [съкратено]` : t;
}

function ymd(d) {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
}

// ---------- корпуси ----------

// Video Production: пълните активни карти + коментарите им; Done — само заглавия
// (нужни за проверката „идея → има ли задача").
async function buildTeamCorpus() {
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  const cards = await query(
    `SELECT * FROM bc_cards_snap WHERE project_id = $1 AND active
     ORDER BY board_title, column_title, due_on NULLS LAST`, [projectId]);
  if (!cards.length) return '';

  const ids = cards.map((c) => c.card_id);
  const comments = await query(
    `SELECT * FROM bc_comments_snap WHERE parent_id = ANY($1::bigint[]) ORDER BY bc_created_at`, [ids]);
  const byParent = new Map();
  for (const cm of comments) {
    if (!byParent.has(String(cm.parent_id))) byParent.set(String(cm.parent_id), []);
    byParent.get(String(cm.parent_id)).push(cm);
  }

  const boards = new Map();
  for (const c of cards) {
    if (!boards.has(c.board_title)) boards.set(c.board_title, []);
    boards.get(c.board_title).push(c);
  }

  const out = [];
  for (const [boardTitle, list] of boards) {
    out.push(`\n===== ДЪСКА: ${boardTitle} (${list.length} карти) =====`);
    for (const c of list) {
      const isDoneCol = /done|готово|завършен/i.test(c.column_title) || c.completed;
      const flags = [c.on_hold ? 'ON HOLD' : '', c.completed ? 'ЗАВЪРШЕНА' : ''].filter(Boolean).join(', ');
      if (isDoneCol) {
        out.push(`- [DONE] ${c.title} (id ${c.card_id})`);
        continue;
      }
      const steps = Array.isArray(c.steps) ? c.steps : [];
      const stepsTxt = steps.map((s) => `  · [${s.completed ? 'x' : ' '}] ${s.title}${s.due_on ? ` (до ${s.due_on})` : ''}${s.assignees && s.assignees.length ? ` — ${s.assignees.join(', ')}` : ''}`).join('\n');
      const assignees = (Array.isArray(c.assignees) ? c.assignees : []).map((a) => a.name).join(', ');
      const cms = byParent.get(String(c.card_id)) || [];
      const cmTxt = cms.map((cm) => `  💬 ${cm.creator_name}${cm.creator_is_client ? ' (КЛИЕНТ)' : ''} @ ${ymd(cm.bc_created_at)}: ${cap(stripHtml(cm.content), 600)}`).join('\n');
      out.push([
        `\n--- КАРТА: ${c.title} (id ${c.card_id})${flags ? ` [${flags}]` : ''}`,
        `Колона: ${c.column_title} | Краен срок: ${ymd(c.due_on) || 'НЯМА'} | Отговорници: ${assignees || 'НИКОЙ'} | Линк: ${c.app_url}`,
        c.content ? `Съдържание:\n${cap(stripHtml(c.content), 1500)}` : 'Съдържание: (празно)',
        steps.length ? `Стъпки:\n${stepsTxt}` : 'Стъпки: няма',
        cms.length ? `Коментари (${cms.length}):\n${cmTxt}` : 'Коментари: няма',
      ].join('\n'));
    }
  }
  return out.join('\n');
}

// Клиентските проекти: съобщения (+коментарите им), отворени задачи, campfire.
async function buildClientCorpus() {
  const teamId = config.BASECAMP_TEAM_PROJECT_ID;
  const projects = await query(
    'SELECT * FROM bc_projects WHERE active AND project_id != $1 ORDER BY name', [teamId]);
  if (!projects.length) return '';

  const out = [];
  for (const p of projects) {
    const section = [`\n===== ПРОЕКТ: ${p.name} (id ${p.project_id}) =====`];
    const messages = await query(
      `SELECT * FROM bc_messages_snap WHERE project_id = $1
       AND (bc_updated_at IS NULL OR bc_updated_at > NOW() - INTERVAL '90 days')
       ORDER BY bc_created_at DESC LIMIT 30`, [p.project_id]);
    const msgIds = messages.map((m) => m.message_id);
    const msgComments = msgIds.length ? await query(
      `SELECT * FROM bc_comments_snap WHERE parent_id = ANY($1::bigint[]) ORDER BY bc_created_at`, [msgIds]) : [];
    const cmByMsg = new Map();
    for (const cm of msgComments) {
      if (!cmByMsg.has(String(cm.parent_id))) cmByMsg.set(String(cm.parent_id), []);
      cmByMsg.get(String(cm.parent_id)).push(cm);
    }
    if (messages.length) {
      section.push('— Съобщения (message board):');
      for (const m of messages) {
        section.push(`  ✉ "${m.subject}" от ${m.creator_name}${m.creator_is_client ? ' (КЛИЕНТ)' : ''} @ ${ymd(m.bc_created_at)} | ${m.app_url}\n    ${cap(stripHtml(m.content), 800)}`);
        for (const cm of (cmByMsg.get(String(m.message_id)) || [])) {
          section.push(`    💬 ${cm.creator_name}${cm.creator_is_client ? ' (КЛИЕНТ)' : ''} @ ${ymd(cm.bc_created_at)}: ${cap(stripHtml(cm.content), 500)}`);
        }
      }
    }
    const todos = await query(
      `SELECT * FROM bc_todos_snap WHERE project_id = $1 AND NOT completed
       ORDER BY due_on NULLS LAST LIMIT 60`, [p.project_id]);
    if (todos.length) {
      section.push('— Отворени задачи (to-do):');
      for (const t of todos) {
        const asg = (Array.isArray(t.assignees) ? t.assignees : []).map((a) => a.name).join(', ');
        section.push(`  ☐ ${t.title} [списък: ${t.todolist_title}] срок: ${ymd(t.due_on) || 'няма'} | отговорник: ${asg || 'никой'}`);
      }
    }
    const lines = await query(
      `SELECT * FROM bc_campfire_lines_snap WHERE project_id = $1
       AND bc_created_at > NOW() - INTERVAL '14 days' ORDER BY bc_created_at DESC LIMIT 40`, [p.project_id]);
    if (lines.length) {
      section.push('— Campfire чат (последни 14 дни, най-новите първи):');
      for (const ln of lines) {
        section.push(`  🔥 ${ln.creator_name}${ln.creator_is_client ? ' (КЛИЕНТ)' : ''} @ ${ymd(ln.bc_created_at)}: ${cap(stripHtml(ln.content), 300)}`);
      }
    }
    if (section.length > 1) out.push(section.join('\n'));
  }
  return out.join('\n');
}

// ---------- анализ ----------

const TODAY = () => new Date().toLocaleDateString('bg-BG', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' });

const ANALYST_SYSTEM = () => `Ти си безкомпромисен senior project manager на The Pact — българска видео продукционна агенция. Днес е ${TODAY()}.

Контекст: работата тече в Basecamp. Вътрешният проект "Video Production" има дъски (card tables) по етапи: Pre-Production → Production → Post-Production → Акаунт Мениджмънт, плюс "Услуги извън КП", "Задачи" и "Ops/Admin". Картите следват конвенция "Клиент КП-X - Видео Y - Заглавие". Всеки клиент има и ОТДЕЛЕН Basecamp проект, където клиентът пише (съобщения, задачи, чат).

Твоята работа: намери какво ИЗПУСКАМЕ. Конкретно търсиш:
1. Идеи/ангажименти в съдържание и коментари на карти, за които НЯМА създадена задача никъде (сравни с заглавията на всички карти, вкл. Done).
2. Клиентски съобщения/коментари/чат, на които екипът НЕ е реагирал (клиентът е последният писал и виси).
3. Карти без краен срок, без отговорник, просрочени, или застояли (стари, без движение).
4. Противоречия: обещано в коментар едно, направено друго; разминаване на бройки/дати.
5. Рискове за срокове в близките дни.

Правила:
- Пиши на български, конкретно и директно. Никакви общи приказки.
- Всяка находка: [СЕРИОЗНОСТ: висока/средна/ниска] + какво точно + къде (име на карта/проект + линк, ако е даден) + какво препоръчваш да се направи.
- Ако нещо е ОК — не го споменавай. Докладвай само проблеми и рискове.
- Не си измисляй нищо, което не е в данните. Ако данните не стигат за извод — кажи какво липсва.
- Групирай находките по тема, най-сериозните първи.`;

// Голям корпус се реже на части по секционните маркери (===== ...), за да не
// опрем в контекст/max_tokens лимити. Всяка част се анализира отделно.
function packChunks(corpus, maxChars = 400_000) {
  if (corpus.length <= maxChars) return [corpus];
  const sections = corpus.split(/(?=\n===== )/);
  const chunks = [];
  let cur = '';
  for (const s of sections) {
    if (cur && cur.length + s.length > maxChars) { chunks.push(cur); cur = ''; }
    cur += s;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function analyzeArea(label, corpus, stats) {
  const chunks = packChunks(corpus);
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    const partLabel = chunks.length > 1 ? `${label} (част ${i + 1}/${chunks.length})` : label;
    const res = await callClaude({
      system: ANALYST_SYSTEM(),
      messages: [{
        role: 'user',
        content: `Ето снапшот на "${partLabel}". Анализирай и дай находките си като структуриран текст.\n\n${chunks[i]}`,
      }],
      maxTokens: 16000,
      effort: 'high',
    });
    stats.calls.push({ area: partLabel, input: res.usage.input_tokens, output: res.usage.output_tokens, stopReason: res.stopReason });
    let text = res.text;
    if (res.stopReason === 'max_tokens') {
      console.warn('[pm-agent] анализът на', partLabel, 'е отрязан (max_tokens)');
      text += '\n\n⚠ ВНИМАНИЕ: този анализ е отрязан по дължина — находките може да са непълни.';
    }
    parts.push(text);
  }
  return parts.join('\n\n');
}

async function synthesizeReport(areaFindings, stats) {
  const res = await callClaude({
    system: ANALYST_SYSTEM(),
    messages: [{
      role: 'user',
      content: `По-долу са находките ти от отделните области. Обедини ги в ЕДИН финален одит доклад за Венци (основателя).

Изисквания към формата:
- Върни САМО HTML фрагмент (без <html>/<body>), подходящ за Basecamp съобщение. Позволени тагове: <h1>, <h2>, <strong>, <em>, <ul>, <li>, <ol>, <br>, <a href="...">, <div>.
- Започни с "Резюме" — 3-5 изречения: най-важното.
- После секции: "🔴 Спешно", "🟡 Важно", "🟢 Наблюдавай". Във всяка — конкретните находки с линкове.
- Накрая "Предложени действия" — номериран списък конкретни стъпки (задачи за създаване, съобщения за отговор), най-важните първи.
- Без празни любезности. Директно.

НАХОДКИ:

${areaFindings.map((f) => `### ${f.label}\n${f.text}`).join('\n\n')}`,
    }],
    maxTokens: 16000,
    effort: 'high',
  });
  stats.calls.push({ area: 'synthesis', input: res.usage.input_tokens, output: res.usage.output_tokens, stopReason: res.stopReason });
  let text = res.text;
  if (res.stopReason === 'max_tokens') {
    console.warn('[pm-agent] синтезът е отрязан (max_tokens)');
    text += '<br><br><strong>⚠ Докладът е отрязан по дължина — виж журнала.</strong>';
  }
  return text;
}

// Санитизация на доклада преди запис/публикация. Докладът е LLM изход, синтезиран
// и от КЛИЕНТСКО Basecamp съдържание → prompt injection може да вкара опасен HTML
// (stored XSS в браузъра на админа). Позволяваме само безобидни тагове; на <a>
// оставяме единствено http(s) href. Всичко останало се маха.
const ALLOWED_TAGS = new Set(['h1', 'h2', 'h3', 'p', 'div', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'a']);
function sanitizeReportHtml(html) {
  return String(html || '').replace(/<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (m, tag, attrs) => {
    const t = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(t)) return '';
    if (m.startsWith('</')) return `</${t}>`;
    if (t === 'a') {
      const hrefM = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs || '');
      const href = hrefM ? (hrefM[1] || hrefM[2] || '') : '';
      if (/^https?:\/\//i.test(href)) return `<a href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener">`;
      return '<a>';
    }
    return t === 'br' ? '<br>' : `<${t}>`;
  });
}

// ---------- публикация в Basecamp ----------

async function resolveReportDestination() {
  const teamId = config.BASECAMP_TEAM_PROJECT_ID;
  const override = await queryOne("SELECT value FROM settings WHERE key = 'pm_agent_bc_board'");
  if (override && parseInt(override.value)) return { projectId: teamId, boardId: parseInt(override.value) };
  const row = await queryOne('SELECT dock FROM bc_projects WHERE project_id = $1', [teamId]);
  const dock = row && Array.isArray(row.dock) ? row.dock : [];
  const board = dock.find((t) => t.enabled && t.name === 'message_board');
  if (!board) throw new Error('Не намерих message board във Video Production (пусни sync първо).');
  return { projectId: teamId, boardId: board.id };
}

async function resolveSubscriberIds(auth) {
  const rows = await query(
    'SELECT person_id FROM bc_people WHERE LOWER(email) = ANY($1::text[]) AND active', [config.ADMIN_EMAILS]);
  const ids = rows.map((r) => Number(r.person_id)).filter(Boolean);
  if (ids.length) return ids;
  // Fallback: само ботът (нула човешки известия) — НИКОГА празен списък.
  try {
    const me = await bc.getMyProfile(auth.token, auth.account);
    if (me && me.id) return [Number(me.id)];
  } catch { /* ignore */ }
  return [];
}

async function postReport(html, subject) {
  const auth = await getServiceAuth(); // пишем като ThePactAlerts
  const dest = await resolveReportDestination();
  const subs = await resolveSubscriberIds(auth);
  const message = await bc.createMessage(auth.token, auth.account, dest.projectId, dest.boardId, {
    subject,
    content: html,
    subscriptions: subs,
  });
  return message.app_url || '';
}

// ---------- главният entry point ----------

// Изчаква евентуално течащ sync (cron/ръчен), за да не одитираме наполовина
// записан снапшот. Максимум 30 минути.
async function waitForSync() {
  const deadline = Date.now() + 30 * 60_000;
  while (syncInProgress() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

async function runAudit({ trigger = 'manual' } = {}) {
  if (running) return { skipped: 'already-running' };
  running = true;
  // ВСИЧКО след флага е в try/finally — една паднала заявка не бива да
  // оставя running=true завинаги (тих отказ на всички следващи одити).
  let runId = null;
  const started = Date.now();
  const stats = { trigger, model: MODEL, calls: [] };
  try {
    const runRow = await queryOne(
      "INSERT INTO agent_runs (kind, status, stats) VALUES ('audit', 'running', $1) RETURNING id",
      [JSON.stringify({ trigger, model: MODEL })]
    );
    runId = runRow.id;

    // 1) Снапшотът трябва да е пълен. Ако тече sync — изчакваме го; ако е
    // празен — пускаме пълен sync (и пак изчакваме, ако междувременно е тръгнал друг).
    await waitForSync();
    let counts = await snapshotCounts();
    if (!counts.projects || !counts.cards) {
      console.log('[pm-agent] снапшотът е празен → пълен sync преди одита');
      const syncRes = await runSync({ trigger: 'audit', full: true });
      if (syncRes && syncRes.skipped) await waitForSync();
      counts = await snapshotCounts();
      if (!counts.projects || !counts.cards) {
        throw new Error('Снапшотът е празен и sync-ът не успя да го напълни — виж журнала за sync грешки.');
      }
    }

    // 2) Корпуси.
    const teamCorpus = await buildTeamCorpus();
    const clientCorpus = await buildClientCorpus();
    if (!teamCorpus && !clientCorpus) throw new Error('Снапшотът е празен — няма какво да се анализира.');
    stats.corpusChars = { team: teamCorpus.length, clients: clientCorpus.length };

    // 3) Анализ по области.
    const findings = [];
    if (teamCorpus) {
      findings.push({ label: 'Video Production (вътрешните дъски)', text: await analyzeArea('Video Production — всички дъски, карти, стъпки и коментари', teamCorpus, stats) });
    }
    if (clientCorpus) {
      findings.push({ label: 'Клиентски проекти', text: await analyzeArea('Клиентските Basecamp проекти — съобщения, задачи, чат', clientCorpus, stats) });
    }

    // 4) Синтез → финален HTML доклад (санитизиран — виж sanitizeReportHtml).
    const reportHtml = sanitizeReportHtml(await synthesizeReport(findings, stats));

    // 5) Публикация в Basecamp (ThePactAlerts → само Венци).
    const dateStr = TODAY();
    let bcUrl = '';
    try {
      bcUrl = await postReport(reportHtml, `🤖 PM Одит — ${dateStr}`);
    } catch (err) {
      console.error('[pm-agent] Basecamp публикацията се провали:', err.message);
      stats.postError = err.message;
    }

    stats.seconds = Math.round((Date.now() - started) / 1000);
    stats.tokens = stats.calls.reduce((acc, c) => ({
      input: acc.input + (c.input || 0), output: acc.output + (c.output || 0),
    }), { input: 0, output: 0 });
    // Ориентировъчна цена (Opus 4.8: $5 вход / $25 изход за 1M токена).
    stats.costUsd = Number(((stats.tokens.input * 5 + stats.tokens.output * 25) / 1_000_000).toFixed(2));

    await execute(
      "UPDATE agent_runs SET status = 'done', report = $2, bc_message_url = $3, stats = $4, finished_at = NOW() WHERE id = $1",
      [runId, reportHtml, bcUrl, JSON.stringify(stats)]
    );
    console.log('[pm-agent] одитът приключи:', JSON.stringify({ runId, ...stats.tokens, costUsd: stats.costUsd, bcUrl }));
    return { runId, bcUrl, stats };
  } catch (err) {
    if (runId) {
      await execute("UPDATE agent_runs SET status = 'error', error = $2, stats = $3, finished_at = NOW() WHERE id = $1",
        [runId, String(err.message || err).slice(0, 2000), JSON.stringify(stats)]).catch(() => {});
    }
    throw err;
  } finally {
    running = false;
  }
}

module.exports = { runAudit };
