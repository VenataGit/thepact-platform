// PM Agent — инструментите на чат агента (Фаза 2/3).
//
// Read инструментите четат от снапшота (бърз, без Basecamp заявки) + живата
// структура на дъските (за колони/ids). Write НЯМА — единственият "write" е
// propose_action, който само записва ПРЕДЛОЖЕНИЕ в agent_proposals; изпълнява
// се чак след одобрение от Венци (actions.js).
const config = require('../../config');
const { query, queryOne } = require('../../db/pool');
const agg = require('../bc-aggregate');

// ---------- дефиниции (Claude tools) ----------

const TOOL_DEFS = [
  {
    name: 'list_boards',
    description: 'Дъските (card tables) на Video Production с колоните им (id, име, брой карти). Ползвай за ориентация и за да намериш column_id при предложение за нова карта.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_cards',
    description: 'Търси карти по заглавие във Video Production снапшота. Връща до 30 карти с id, дъска, колона, срок, отговорници, линк.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Част от заглавието (напр. име на клиент). Празно = всички.' },
        board: { type: 'string', description: 'Филтър по име на дъска (частично съвпадение).' },
        include_done: { type: 'boolean', description: 'Включи и завършените/Done картите (default false).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_card',
    description: 'Пълна карта по id: съдържание, стъпки, отговорници, всички коментари.',
    input_schema: {
      type: 'object',
      properties: { card_id: { type: 'number' } },
      required: ['card_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_text',
    description: 'Пълнотекстово търсене в целия снапшот: съдържание на карти, коментари, съобщения, задачи, campfire чат (всички проекти). Връща до 40 съвпадения със снипет и линк.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Текст за търсене (мин. 3 знака).' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_projects',
    description: 'Всички Basecamp проекти в снапшота (вкл. клиентските) с id и име.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'project_activity',
    description: 'Активността в конкретен проект (обикновено клиентски): последни съобщения с коментарите им, отворени задачи, campfire чат. Ползвай за въпроси от типа "какво става при клиент X".',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'number' },
        days: { type: 'number', description: 'Колко дни назад (default 30).' },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_status',
    description: 'Състояние на снапшота: бройки и кога е бил последният синхрон.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'propose_action',
    description: 'Предложи действие в Basecamp (ще се изпълни ЧАК след одобрение от Венци в чата). Разрешени kind: create_card (payload: column_id, title, content?, due_on?, board_id?), create_step (payload: card_id, title, due_on?), add_comment (payload: recording_id, content), post_message (payload: subject, content), move_card (payload: card_id, board_id, column_id). Всичко е само във Video Production проекта. След като предложиш, кажи на Венци какво чака одобрение.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['create_card', 'create_step', 'add_comment', 'post_message', 'move_card'] },
        title: { type: 'string', description: 'Кратко човешко описание на предложението (за бутона за одобрение).' },
        reasoning: { type: 'string', description: 'Защо предлагаш това (1-2 изречения).' },
        payload: { type: 'object', description: 'Параметрите според kind (виж description).' },
      },
      required: ['kind', 'title', 'payload'],
      additionalProperties: false,
    },
  },
];

// ---------- помощни ----------

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h1|h2|h3)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}
function cap(t, n) { const s = String(t || ''); return s.length > n ? `${s.slice(0, n)}…` : s; }
function snippet(text, q, span = 160) {
  const t = stripHtml(text);
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return cap(t, span);
  return `${i > 40 ? '…' : ''}${t.slice(Math.max(0, i - 40), i + q.length + span)}…`;
}
function asg(a) { return (Array.isArray(a) ? a : []).map((x) => x.name).join(', '); }

// ---------- изпълнение ----------

async function executeTool(name, input, ctx) {
  const teamId = config.BASECAMP_TEAM_PROJECT_ID;
  switch (name) {
    case 'list_boards': {
      const s = await agg.loadStructure(ctx.auth.token, ctx.auth.account);
      return { boards: s.boards.map((b) => ({ id: b.id, title: b.title, columns: b.columns })) };
    }
    case 'search_cards': {
      const conds = ['project_id = $1', 'active'];
      const params = [teamId];
      if (input.query) { params.push(`%${input.query}%`); conds.push(`title ILIKE $${params.length}`); }
      if (input.board) { params.push(`%${input.board}%`); conds.push(`board_title ILIKE $${params.length}`); }
      if (!input.include_done) conds.push("NOT completed AND column_title !~* '^(done|готово)'");
      const rows = await query(
        `SELECT card_id, title, board_title, column_title, due_on, completed, assignees, comments_count, app_url
         FROM bc_cards_snap WHERE ${conds.join(' AND ')} ORDER BY board_title, due_on NULLS LAST LIMIT 30`, params);
      return {
        count: rows.length,
        cards: rows.map((r) => ({
          id: Number(r.card_id), title: r.title, board: r.board_title, column: r.column_title,
          due: r.due_on, done: r.completed, who: asg(r.assignees), comments: r.comments_count, url: r.app_url,
        })),
      };
    }
    case 'get_card': {
      const c = await queryOne('SELECT * FROM bc_cards_snap WHERE card_id = $1', [input.card_id]);
      if (!c) return { error: 'Няма такава карта в снапшота.' };
      const comments = await query(
        'SELECT creator_name, creator_is_client, content, bc_created_at, app_url FROM bc_comments_snap WHERE parent_id = $1 ORDER BY bc_created_at DESC LIMIT 25', [input.card_id]);
      return {
        id: Number(c.card_id), title: c.title, board: c.board_title, column: c.column_title,
        due: c.due_on, done: c.completed, on_hold: c.on_hold, who: asg(c.assignees), url: c.app_url,
        content: cap(stripHtml(c.content), 5000),
        steps: (Array.isArray(c.steps) ? c.steps : []).map((s) => ({ title: s.title, due: s.due_on, done: s.completed, who: (s.assignees || []).join(', ') })),
        comments: comments.reverse().map((cm) => ({
          who: cm.creator_name + (cm.creator_is_client ? ' (КЛИЕНТ)' : ''),
          at: cm.bc_created_at, text: cap(stripHtml(cm.content), 1200),
        })),
      };
    }
    case 'search_text': {
      const q = String(input.query || '').trim();
      if (q.length < 3) return { error: 'Търсенето изисква поне 3 знака.' };
      const like = `%${q}%`;
      const out = [];
      const cards = await query(
        `SELECT card_id, title, board_title, content, app_url FROM bc_cards_snap
         WHERE active AND (title ILIKE $1 OR content ILIKE $1) LIMIT 15`, [like]);
      for (const r of cards) out.push({ type: 'card', title: r.title, board: r.board_title, match: snippet(r.content || r.title, q), url: r.app_url });
      const comments = await query(
        `SELECT c.parent_title, c.creator_name, c.creator_is_client, c.content, c.app_url, p.name AS project
         FROM bc_comments_snap c LEFT JOIN bc_projects p ON p.project_id = c.project_id
         WHERE c.content ILIKE $1 ORDER BY c.bc_created_at DESC LIMIT 15`, [like]);
      for (const r of comments) out.push({ type: 'comment', under: r.parent_title, project: r.project, who: r.creator_name + (r.creator_is_client ? ' (КЛИЕНТ)' : ''), match: snippet(r.content, q), url: r.app_url });
      const messages = await query(
        `SELECT m.subject, m.content, m.app_url, m.creator_name, p.name AS project
         FROM bc_messages_snap m LEFT JOIN bc_projects p ON p.project_id = m.project_id
         WHERE m.subject ILIKE $1 OR m.content ILIKE $1 ORDER BY m.bc_created_at DESC LIMIT 8`, [like]);
      for (const r of messages) out.push({ type: 'message', subject: r.subject, project: r.project, who: r.creator_name, match: snippet(r.content, q), url: r.app_url });
      const todos = await query(
        `SELECT t.title, t.app_url, t.completed, p.name AS project FROM bc_todos_snap t
         LEFT JOIN bc_projects p ON p.project_id = t.project_id WHERE t.title ILIKE $1 LIMIT 8`, [like]);
      for (const r of todos) out.push({ type: 'todo', title: r.title, project: r.project, done: r.completed, url: r.app_url });
      const lines = await query(
        `SELECT l.content, l.creator_name, l.creator_is_client, l.bc_created_at, p.name AS project
         FROM bc_campfire_lines_snap l LEFT JOIN bc_projects p ON p.project_id = l.project_id
         WHERE l.content ILIKE $1 ORDER BY l.bc_created_at DESC LIMIT 8`, [like]);
      for (const r of lines) out.push({ type: 'campfire', project: r.project, who: r.creator_name + (r.creator_is_client ? ' (КЛИЕНТ)' : ''), at: r.bc_created_at, match: snippet(r.content, q) });
      return { count: out.length, results: out.slice(0, 40) };
    }
    case 'list_projects': {
      const rows = await query('SELECT project_id, name, clients_enabled FROM bc_projects WHERE active ORDER BY name');
      return {
        team_project_id: teamId,
        projects: rows.map((r) => ({ id: Number(r.project_id), name: r.name, team: String(r.project_id) === String(teamId) })),
      };
    }
    case 'project_activity': {
      const pid = input.project_id;
      const days = Math.min(Number(input.days) || 30, 120);
      const p = await queryOne('SELECT name FROM bc_projects WHERE project_id = $1', [pid]);
      if (!p) return { error: 'Няма такъв проект в снапшота.' };
      const messages = await query(
        `SELECT message_id, subject, content, creator_name, creator_is_client, bc_created_at, app_url
         FROM bc_messages_snap WHERE project_id = $1 AND bc_created_at > NOW() - ($2 || ' days')::interval
         ORDER BY bc_created_at DESC LIMIT 10`, [pid, days]);
      const msgIds = messages.map((m) => m.message_id);
      const comments = await query(
        `SELECT parent_id, parent_title, creator_name, creator_is_client, content, bc_created_at, app_url
         FROM bc_comments_snap WHERE project_id = $1 AND bc_created_at > NOW() - ($2 || ' days')::interval
         ORDER BY bc_created_at DESC LIMIT 40`, [pid, days]);
      const todos = await query(
        `SELECT title, todolist_title, due_on, assignees, app_url FROM bc_todos_snap
         WHERE project_id = $1 AND NOT completed ORDER BY due_on NULLS LAST LIMIT 40`, [pid]);
      const lines = await query(
        `SELECT creator_name, creator_is_client, content, bc_created_at FROM bc_campfire_lines_snap
         WHERE project_id = $1 AND bc_created_at > NOW() - ($2 || ' days')::interval
         ORDER BY bc_created_at DESC LIMIT 30`, [pid, days]);
      return {
        project: p.name,
        messages: messages.map((m) => ({
          id: Number(m.message_id), subject: m.subject, who: m.creator_name + (m.creator_is_client ? ' (КЛИЕНТ)' : ''),
          at: m.bc_created_at, text: cap(stripHtml(m.content), 800), url: m.app_url,
          comments: comments.filter((c) => msgIds.some((id) => String(id) === String(c.parent_id)) && String(c.parent_id) === String(m.message_id))
            .map((c) => ({ who: c.creator_name + (c.creator_is_client ? ' (КЛИЕНТ)' : ''), at: c.bc_created_at, text: cap(stripHtml(c.content), 500) })),
        })),
        other_comments: comments.filter((c) => !msgIds.some((id) => String(id) === String(c.parent_id)))
          .map((c) => ({ under: c.parent_title, who: c.creator_name + (c.creator_is_client ? ' (КЛИЕНТ)' : ''), at: c.bc_created_at, text: cap(stripHtml(c.content), 500), url: c.app_url })),
        open_todos: todos.map((t) => ({ title: t.title, list: t.todolist_title, due: t.due_on, who: asg(t.assignees), url: t.app_url })),
        campfire: lines.map((l) => ({ who: l.creator_name + (l.creator_is_client ? ' (КЛИЕНТ)' : ''), at: l.bc_created_at, text: cap(stripHtml(l.content), 300) })),
      };
    }
    case 'snapshot_status': {
      const { snapshotCounts } = require('./snapshot');
      return await snapshotCounts();
    }
    case 'propose_action': {
      const kinds = ['create_card', 'create_step', 'add_comment', 'post_message', 'move_card'];
      if (!kinds.includes(input.kind)) return { error: 'Непознат kind.' };
      if (!input.payload || typeof input.payload !== 'object') return { error: 'Липсва payload.' };
      const row = await queryOne(
        `INSERT INTO agent_proposals (kind, title, payload, status) VALUES ($1, $2, $3, 'pending') RETURNING id`,
        [input.kind, cap(input.title, 300), JSON.stringify({ ...input.payload, _reasoning: input.reasoning || '' })]);
      if (ctx.onProposal) ctx.onProposal(row.id);
      return { proposal_id: row.id, status: 'pending', note: 'Чака одобрение от Венци в чата.' };
    }
    default:
      return { error: `Непознат инструмент: ${name}` };
  }
}

module.exports = { TOOL_DEFS, executeTool };
