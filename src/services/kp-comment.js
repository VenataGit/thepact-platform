// Коментар под новосъздадената КП карта в Basecamp.
//
// Какво влиза в коментара:
//   1. Тагове на хората, отговорни да направят контент плана — активните хора от
//      Basecamp с позиция, маркирана „отговаря за контент плановете"
//      (Админ → Екип и роли). Таг в коментар = Basecamp известие за тях.
//   2. Какво КОНКРЕТНО трябва да се направи по този план — от проекта на клиента
//      в Basecamp: съобщения, отворени задачи, коментари и чат от последните N дни.
//      Не се чете на живо от Basecamp — ползва се снапшотът на PM Agent-а
//      (bc_messages_snap / bc_todos_snap / bc_comments_snap / bc_campfire_lines_snap,
//      виж services/pm-agent/snapshot.js), който се опреснява на 15 минути.
//   3. Ако има ANTHROPIC_API_KEY и `kp_comment_ai` е включено — Claude обобщава
//      суровия материал до конкретни задачи. Иначе се пуска сухо изброяване.
//
// Коментарът никога не бламира създаването на картата: викащият го пуска във фонов
// режим (postKpCommentInBackground) и всяка грешка отива само в лога + kp_audit_log.
const config = require('../config');
const { query, queryOne, execute } = require('../db/pool');
const bc = require('./basecamp');
const team = require('./bc-team');
const { callClaude } = require('./pm-agent/claude');

const escHtml = team.escHtml;

// ---------- настройки ----------

async function loadCommentConfig() {
  const rows = await query(
    "SELECT key, value FROM settings WHERE key IN ('kp_comment_enabled','kp_comment_ai','kp_comment_lookback_days')"
  );
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  const days = parseInt(s.kp_comment_lookback_days, 10);
  return {
    enabled: s.kp_comment_enabled !== 'false',   // по подразбиране включено
    ai: s.kp_comment_ai !== 'false',             // по подразбиране включено
    lookbackDays: Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 45,
  };
}

// ---------- проектът на клиента в Basecamp ----------

// Нормализация за сравнение на имена: маха диакритика-независими дребни разлики,
// пунктуацията и типичните суфикси на проекти („… - Видео", „… (клиент)").
function normName(s) {
  return String(s || '').toLowerCase()
    .replace(/[„""'']/g, '')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim();
}

/**
 * Кой Basecamp проект е проектът на клиента.
 * Приоритет: запомненият kp_clients.bc_project_id → точно съвпадение по име →
 * проект, чието име започва с/съдържа името на клиента (само ако е еднозначно).
 * Връща { project_id, name } или null.
 */
async function resolveClientProject(client) {
  if (client.bc_project_id) {
    const saved = await queryOne(
      'SELECT project_id, name FROM bc_projects WHERE project_id = $1 AND active = TRUE',
      [client.bc_project_id]
    );
    if (saved) return saved;
  }
  const teamId = String(config.BASECAMP_TEAM_PROJECT_ID);
  const projects = (await query('SELECT project_id, name FROM bc_projects WHERE active = TRUE'))
    .filter((p) => String(p.project_id) !== teamId);
  const target = normName(client.name);
  if (!target) return null;

  let hits = projects.filter((p) => normName(p.name) === target);
  if (!hits.length) {
    hits = projects.filter((p) => {
      const n = normName(p.name);
      return n.startsWith(target + ' ') || n === target || n.split(' ').includes(target);
    });
  }
  if (hits.length !== 1) return null; // 0 = няма, >1 = двусмислено → по-добре нищо

  // Запомняме съвпадението, за да не се пресмята всеки път (и да може да се коригира в БД).
  await execute('UPDATE kp_clients SET bc_project_id = $1 WHERE id = $2', [hits[0].project_id, client.id])
    .catch(() => { /* не е критично */ });
  return hits[0];
}

// ---------- материал от проекта на клиента ----------

function plainText(html, max = 1200) {
  const t = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function bgDate(v) {
  if (!v) return '';
  const s = (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10).split('-');
  return s.length === 3 ? `${s[2]}.${s[1]}.${s[0]}` : '';
}

/**
 * Всичко от проекта на клиента, което може да каже „какво трябва да се направи".
 * Ограничено по количество, за да не надуваме нито коментара, нито AI заявката.
 */
async function gatherClientContext(projectId, lookbackDays) {
  const since = new Date(Date.now() - lookbackDays * 86400_000).toISOString();

  const [messages, todos, comments, chat] = await Promise.all([
    query(
      `SELECT subject, content, creator_name, creator_is_client, bc_created_at, app_url
         FROM bc_messages_snap WHERE project_id = $1 AND COALESCE(bc_created_at, synced_at) >= $2
        ORDER BY COALESCE(bc_created_at, synced_at) DESC LIMIT 15`,
      [projectId, since]
    ),
    query(
      `SELECT title, description, due_on, todolist_title, completed, app_url
         FROM bc_todos_snap WHERE project_id = $1 AND completed = FALSE
        ORDER BY due_on NULLS LAST LIMIT 25`,
      [projectId]
    ),
    query(
      `SELECT parent_title, content, creator_name, creator_is_client, bc_created_at
         FROM bc_comments_snap WHERE project_id = $1 AND COALESCE(bc_created_at, synced_at) >= $2
        ORDER BY COALESCE(bc_created_at, synced_at) DESC LIMIT 30`,
      [projectId, since]
    ),
    query(
      `SELECT content, creator_name, creator_is_client, bc_created_at
         FROM bc_campfire_lines_snap WHERE project_id = $1 AND bc_created_at >= $2
        ORDER BY bc_created_at DESC LIMIT 40`,
      [projectId, since]
    ),
  ]);

  return { messages, todos, comments, chat };
}

function contextIsEmpty(ctx) {
  return !ctx.messages.length && !ctx.todos.length && !ctx.comments.length && !ctx.chat.length;
}

// Суровият материал като текст за Claude (кой го е казал има значение —
// „клиентът каза" тежи повече от вътрешна бележка).
function contextToPrompt(ctx, clientName, lookbackDays) {
  const who = (r) => `${r.creator_name || 'неизвестен'}${r.creator_is_client ? ' (КЛИЕНТ)' : ''}`;
  const parts = [];
  parts.push(`Клиент: ${clientName}. Материал от последните ${lookbackDays} дни.`);

  if (ctx.messages.length) {
    parts.push('\n=== СЪОБЩЕНИЯ (message board) ===');
    for (const m of ctx.messages) {
      parts.push(`[${bgDate(m.bc_created_at)}] ${who(m)}: ${m.subject || ''}\n${plainText(m.content, 900)}`);
    }
  }
  if (ctx.todos.length) {
    parts.push('\n=== ОТВОРЕНИ ЗАДАЧИ ===');
    for (const t of ctx.todos) {
      parts.push(`- [${t.todolist_title || 'без списък'}] ${t.title || ''}` +
        (t.due_on ? ` (срок ${bgDate(t.due_on)})` : '') +
        (t.description ? `\n  ${plainText(t.description, 300)}` : ''));
    }
  }
  if (ctx.comments.length) {
    parts.push('\n=== КОМЕНТАРИ ===');
    for (const c of ctx.comments) {
      parts.push(`[${bgDate(c.bc_created_at)}] ${who(c)} под „${c.parent_title || ''}": ${plainText(c.content, 500)}`);
    }
  }
  if (ctx.chat.length) {
    parts.push('\n=== CAMPFIRE ЧАТ ===');
    for (const l of ctx.chat) {
      const t = plainText(l.content, 300);
      if (t) parts.push(`[${bgDate(l.bc_created_at)}] ${who(l)}: ${t}`);
    }
  }
  return parts.join('\n');
}

const AI_SYSTEM = `Ти си асистент на българска видео продукция (The Pact). Екипът тъкмо получи задача да измисли нов контент план (КП) за клиент.

Задачата ти: от материала на клиентския проект в Basecamp извади САМО това, което е нужно на човека, който ще прави контент плана.

Правила:
- Пиши на български, кратко и конкретно, без учтиви въведения и без заключения.
- Отговори с чист HTML: САМО <ul><li>…</li></ul>, вътре може <strong> и <em>. Никакви други тагове, без markdown, без код блокове.
- Максимум 7 точки. Всяка точка е едно конкретно нещо — искане на клиента, тема, дата/кампания, ограничение, продукт за промотиране, изрична забрана, чакащо решение.
- Приоритет: изрично казано от КЛИЕНТА > вътрешна договорка > предположение. Ако нещо е искане на клиента, започни точката с <strong>Клиентът:</strong>.
- Ако има краен срок или дата — включи я.
- НЕ преразказвай оперативни неща без връзка с контент плана (фактури, техника, логистика на минали снимки).
- НЕ си измисляй нищо. Ако в материала няма нищо съществено за контент плана, отговори точно с: НЯМА`;

// Пита Claude какво трябва да се направи по плана. Връща HTML (<ul>…) или null.
async function aiSummary(ctx, clientName, lookbackDays) {
  if (!config.ANTHROPIC_API_KEY) return null;
  const prompt = contextToPrompt(ctx, clientName, lookbackDays);
  const r = await callClaude({
    system: AI_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 8000,
    effort: 'low',
  });
  const text = String(r.text || '').trim();
  if (!text || /^НЯМА$/i.test(text)) return null;
  const m = text.match(/<ul[\s\S]*<\/ul>/i);
  if (!m) return null;
  // Пазим само таговете, които Basecamp rich text приема от нас.
  const safe = m[0].replace(/<(?!\/?(ul|li|strong|em|br)\b)[^>]*>/gi, '');
  return /<li[\s>]/i.test(safe) ? safe : null;
}

// Резервният вариант без AI: сухо изброяване на най-свежото от проекта.
function plainSummary(ctx) {
  const items = [];
  for (const m of ctx.messages.slice(0, 4)) {
    const title = m.subject || plainText(m.content, 80);
    if (!title) continue;
    items.push(`<strong>${escHtml(m.creator_name || '')}${m.creator_is_client ? ' (клиент)' : ''}</strong>, ` +
      `${escHtml(bgDate(m.bc_created_at))}: ` +
      (m.app_url ? `<a href="${escHtml(bc.normalizeAppUrl(m.app_url))}">${escHtml(title)}</a>` : escHtml(title)));
  }
  for (const t of ctx.todos.slice(0, 6)) {
    if (!t.title) continue;
    items.push(`Отворена задача: ${t.app_url ? `<a href="${escHtml(bc.normalizeAppUrl(t.app_url))}">${escHtml(t.title)}</a>` : escHtml(t.title)}` +
      (t.due_on ? ` <em>(срок ${escHtml(bgDate(t.due_on))})</em>` : ''));
  }
  if (!items.length) return null;
  return '<ul>' + items.map((i) => `<li>${i}</li>`).join('') + '</ul>';
}

// ---------- самият коментар ----------

/**
 * Съставя HTML-а на коментара.
 * @returns {{ html: string|null, people: object[], projectName: string|null, aiUsed: boolean, note: string }}
 */
async function buildComment({ client, kpNumber, firstPublishDate, videoCount, dueOn, cfg }) {
  const people = await team.kpResponsiblePeople();
  const project = await resolveClientProject(client);

  let summaryHtml = null;
  let aiUsed = false;
  let note = '';

  if (project) {
    const ctx = await gatherClientContext(project.project_id, cfg.lookbackDays);
    if (contextIsEmpty(ctx)) {
      note = `в проекта на клиента няма нищо ново от последните ${cfg.lookbackDays} дни`;
    } else {
      if (cfg.ai) {
        try {
          summaryHtml = await aiSummary(ctx, client.name, cfg.lookbackDays);
          aiUsed = Boolean(summaryHtml);
        } catch (err) {
          console.warn('[kp-comment] AI обобщението се провали:', err.message);
        }
      }
      if (!summaryHtml) summaryHtml = plainSummary(ctx);
      if (!summaryHtml) note = 'в проекта на клиента няма нищо съществено за плана';
    }
  } else {
    note = 'не намирам проекта на клиента в Basecamp (името на клиента трябва да съвпада с името на проекта)';
  }

  // Basecamp (Trix) иска списъкът да е самостоятелен блок — <ul> между <br>-ове се
  // разпада при първото отваряне за редакция. Затова параграфите и списъкът са
  // отделни блокове, а не един див с <br> между всичко.
  const head = [];

  // 1) Тагове — кой прави плана.
  if (people.length) {
    head.push(`${people.map((p) => team.mentionOf(p, p.name)).join(' ')} — ` +
      `новият контент план на <strong>${escHtml(client.name)}</strong> (КП-${kpNumber}) е за вас.`);
  } else {
    head.push(`<strong>Няма зададени отговорници за контент плановете.</strong> ` +
      `Задай позиция „отговаря за контент плановете" в Настройки → Екип и роли, за да се тагват хората тук автоматично.`);
  }

  // 2) Рамката на плана.
  const facts = [`🎬 <strong>${videoCount}</strong> видеа`, `📅 първо видео: <strong>${escHtml(bgDate(firstPublishDate))}</strong>`];
  if (dueOn) facts.push(`⏳ планът да е готов до <strong>${escHtml(bgDate(dueOn))}</strong>`);
  head.push('');
  head.push(facts.join(' · '));

  // 3) Какво трябва да се направи конкретно.
  const blocks = [];
  if (summaryHtml) {
    head.push('');
    head.push(`📌 <strong>От проекта на клиента${project ? ` „${escHtml(project.name)}"` : ''} (последните ${cfg.lookbackDays} дни):</strong>`);
    blocks.push(summaryHtml);
    if (aiUsed) blocks.push('<div><em>Извадено автоматично от Basecamp — сверете в проекта, преди да разчитате на него.</em></div>');
  } else {
    head.push('');
    head.push(`📌 <em>Няма конкретни насоки от клиента — ${escHtml(note)}.</em>`);
  }

  const html = `<div>${head.join('<br>')}</div>` + blocks.join('');
  return { html, people, projectName: project ? project.name : null, aiUsed, note };
}

/**
 * Публикува коментара под КП картата в Basecamp.
 * @param {object} p
 * @param {object} p.auth        { token, account }
 * @param {number|string} p.projectId  Basecamp проектът на картата (Video Production)
 * @param {number|string} p.cardId     картата, под която коментираме
 * @param {object} p.client      kp_clients ред
 */
async function postKpComment({ auth, projectId, cardId, client, kpNumber, firstPublishDate, videoCount, dueOn }) {
  const cfg = await loadCommentConfig();
  if (!cfg.enabled) return { skipped: 'disabled' };
  if (!auth || !projectId || !cardId) return { skipped: 'no-target' };

  const built = await buildComment({ client, kpNumber, firstPublishDate, videoCount, dueOn, cfg });
  await bc.createComment(auth.token, auth.account, projectId, cardId, built.html);

  const tagged = built.people.map((p) => p.name).join(', ');
  console.log(`[kp-comment] коментар под карта ${cardId} (${client.name} КП-${kpNumber})` +
    (tagged ? ` · тагнати: ${tagged}` : ' · без тагнати') +
    (built.aiUsed ? ' · AI обобщение' : built.note ? ` · ${built.note}` : ''));

  return { ok: true, tagged: built.people.length, aiUsed: built.aiUsed, project: built.projectName, note: built.note };
}

// Фонов вариант: викащият (създаването на КП картата) не чака и не пада заради нас.
// AI заявката може да отнеме десетки секунди — затова не блокираме HTTP отговора.
function postKpCommentInBackground(params) {
  setImmediate(() => {
    postKpComment(params)
      .then((r) => {
        if (r && r.ok) {
          return execute(
            'INSERT INTO kp_audit_log (user_name, action, client_name, details) VALUES ($1,$2,$3,$4)',
            ['Система', 'kp_card_comment', params.client.name,
             `КП-${params.kpNumber}: тагнати ${r.tagged} · ${r.aiUsed ? 'AI обобщение' : (r.note || 'сухо изброяване')}` +
             (r.project ? ` · проект „${r.project}"` : '')]
          );
        }
      })
      .catch((err) => {
        console.error(`[kp-comment] коментарът за ${params.client && params.client.name} се провали:`, err.message);
        return execute(
          'INSERT INTO kp_audit_log (user_name, action, client_name, details) VALUES ($1,$2,$3,$4)',
          ['Система', 'kp_card_comment_error', (params.client && params.client.name) || '',
           String(err.message || err).slice(0, 500)]
        ).catch(() => {});
      })
      .catch(() => { /* дори логът да падне — тихо */ });
  });
}

module.exports = {
  loadCommentConfig, resolveClientProject, gatherClientContext,
  buildComment, postKpComment, postKpCommentInBackground,
  normName, plainText, bgDate,
};
