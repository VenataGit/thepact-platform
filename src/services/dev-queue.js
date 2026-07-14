// Dev Queue — „Basecamp задача → Claude Code" мост.
//
// Личният проект на Венци има отделен to-dos панел (settings: dev_queue_bc_project /
// dev_queue_bc_todoset). Всяка отворена задача там, без значение в кой лист, влиза в
// опашката dev_tasks. Watcher скрипт на компютъра на Венци тегли задачите през
// /api/dev-queue (secret header) и пуска headless Claude Code сесия с абонамента му.
// Всички Basecamp write-ове (коментари) минават оттук, през бота ThePactAlerts —
// watcher-ът никога не говори директно с Basecamp.
//
// Диалог: върне ли Claude въпрос, задачата минава в waiting_reply. Следващ коментар
// под задачата, който не е от бота, я връща в pending с reply_html — watcher-ът
// продължава СЪЩАТА сесия (claude --resume session_id). Същото важи и за наскоро
// приключени (done/error) задачи с още отворен todo: нов коментар = нова итерация.
const cron = require('node-cron');
const config = require('../config');
const { query, queryOne, execute } = require('../db/pool');
const bc = require('./basecamp');
const { getServiceAuth } = require('./basecamp-token');

const TZ = 'Europe/Sofia';
let running = false;

function initDevQueue() {
  try {
    cron.schedule('*/2 * * * *', () => {
      pollOnce().catch((err) => console.error('[dev-queue] poll error:', err.message));
    }, { timezone: TZ });
    console.log('  Dev Queue: active (every 2 minutes)');
  } catch (err) {
    console.log('  Dev Queue: skipped —', err.message);
  }
}

async function loadCfg() {
  const rows = await query(
    "SELECT key, value FROM settings WHERE key IN ('dev_queue_enabled','dev_queue_bc_project','dev_queue_bc_todoset','dev_queue_stale_minutes')"
  );
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    enabled: s.dev_queue_enabled !== 'false', // default включено
    project: parseInt(s.dev_queue_bc_project) || 47742842,       // личният проект на Венци
    todoset: parseInt(s.dev_queue_bc_todoset) || 10095785275,    // to-dos панелът-опашка
    staleMinutes: parseInt(s.dev_queue_stale_minutes) || 240,    // заседнал running → ретрай
  };
}

function isBot(comment) {
  return String(comment.creator?.email_address || '').toLowerCase() === config.BASECAMP_SERVICE_EMAIL;
}

// Всички отворени задачи от панела: всеки лист + групите вътре в него.
// ВСЯКА грешка освен 404 на groups.json се хвърля нагоре — при частичен fetch
// НЕ бива да стигаме до auto-close стъпката с непълен списък.
async function fetchOpenTodos(auth, cfg) {
  const lists = await bc.getTodoLists(auth.token, auth.account, cfg.project, cfg.todoset);
  const out = [];
  for (const list of lists) {
    const listName = list.title || list.name || '';
    const containers = [list];
    try {
      const groups = await bc.getTodoGroups(auth.token, auth.account, cfg.project, list.id);
      containers.push(...groups);
    } catch (err) {
      // Само 404 (лист без групи / стар акаунт) е безопасно да се игнорира.
      if (!String(err.message).includes('(404)')) throw err;
    }
    for (const c of containers) {
      const todos = await bc.getTodos(auth.token, auth.account, cfg.project, c.id);
      for (const t of todos) out.push({ todo: t, listId: list.id, listName });
    }
  }
  return out;
}

// Точният статус на конкретен todo — за проверка преди auto-close.
// Връща { exists, completed }.
async function getTodoState(auth, projectId, todoId) {
  try {
    const { json } = await bc.authedGet(`${bc.API_BASE}/${auth.account}/buckets/${projectId}/todos/${todoId}.json`, auth.token);
    return { exists: true, completed: !!json?.completed };
  } catch (err) {
    if (String(err.message).includes('(404)')) return { exists: false, completed: false };
    throw err;
  }
}

async function pollOnce() {
  if (running) return;
  running = true;
  try {
    const cfg = await loadCfg();
    if (!cfg.enabled) return;

    // 1) Stale recovery ПЪРВО — чисто DB стъпка, работи и при паднал Basecamp/токен.
    //    stale_retries (не attempts!) брои само сривовете — диалоговите resume-и
    //    легитимно вдигат attempts и не бива да изяждат ретрая.
    const stale = await query(
      "SELECT * FROM dev_tasks WHERE status = 'running' AND updated_at < NOW() - make_interval(mins => $1)",
      [cfg.staleMinutes]
    );
    for (const task of stale) {
      if ((task.stale_retries || 0) < 1) {
        await execute(
          "UPDATE dev_tasks SET status = 'pending', stale_retries = stale_retries + 1, updated_at = NOW() WHERE id = $1",
          [task.id]);
        console.log(`[dev-queue] задача #${task.id} заседна — връщам я в опашката`);
      } else {
        await execute(
          "UPDATE dev_tasks SET status = 'error', result = 'прекъсната (watcher не върна резултат)', updated_at = NOW() WHERE id = $1",
          [task.id]);
        try {
          const auth = await getServiceAuth();
          await bc.createComment(auth.token, auth.account, task.bc_project_id, task.bc_todo_id,
            '<p>⚠️ Работата по задачата прекъсна два пъти, без да стигне до резултат. Ще я погледна ръчно.</p>');
        } catch (e) { console.error('[dev-queue] stale comment:', e.message); }
      }
    }

    const auth = await getServiceAuth();

    // 2) Нови/променени отворени задачи → pending (заглавие и notes се опресняват,
    //    докато задачата още чака — взима се актуалният текст при стартиране).
    const open = await fetchOpenTodos(auth, cfg);
    const openIds = new Set(open.map((x) => Number(x.todo.id)));
    for (const { todo: t, listId, listName } of open) {
      await execute(
        `INSERT INTO dev_tasks (bc_todo_id, bc_project_id, bc_list_id, list_name, title, notes_html, todo_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (bc_todo_id) DO UPDATE SET
           title = EXCLUDED.title, notes_html = EXCLUDED.notes_html,
           list_name = EXCLUDED.list_name, updated_at = NOW()
         WHERE dev_tasks.status = 'pending'`,
        [t.id, cfg.project, listId, listName, t.content || t.title || '(без заглавие)',
         t.description || '', bc.normalizeAppUrl(t.app_url || '')]
      );
    }

    // 3) Чакащи задачи, които липсват от отворените → проверка ЕДНА ПО ЕДНА срещу
    //    Basecamp преди затваряне (пази от ръбовете: архивиран лист, пагинационен
    //    таван, todo преместен другаде). Затваряме само реално completed/изтрити.
    const missing = await query(
      `SELECT * FROM dev_tasks WHERE status IN ('pending', 'waiting_reply') AND bc_project_id = $1`,
      [cfg.project]
    );
    for (const task of missing) {
      if (openIds.has(Number(task.bc_todo_id))) continue;
      try {
        const st = await getTodoState(auth, task.bc_project_id, task.bc_todo_id);
        if (!st.exists || st.completed) {
          await execute(
            "UPDATE dev_tasks SET status = 'done', result = $1, updated_at = NOW() WHERE id = $2 AND status IN ('pending','waiting_reply')",
            [st.exists ? 'затворена в Basecamp' : 'изтрита в Basecamp', task.id]);
          console.log(`[dev-queue] задача #${task.id} е ${st.exists ? 'затворена' : 'изтрита'} в Basecamp`);
        }
      } catch (e) {
        console.error(`[dev-queue] проверка на todo ${task.bc_todo_id}:`, e.message);
      }
    }

    // 4) Диалог: нови коментари (не от бота) активират задачата.
    //    - waiting_reply → отговор на въпроса ни;
    //    - наскоро done/error с още отворен todo → нова итерация по същата задача.
    //    Per-task try/catch — един лош ред не замразява останалите.
    const watchable = await query(
      `SELECT * FROM dev_tasks
       WHERE status = 'waiting_reply'
          OR (status IN ('done', 'error') AND updated_at > NOW() - INTERVAL '14 days')`
    );
    for (const task of watchable) {
      try {
        if (task.status !== 'waiting_reply' && !openIds.has(Number(task.bc_todo_id))) continue; // отметната/изтрита — не пипаме
        const comments = await bc.getComments(auth.token, auth.account, task.bc_project_id, task.bc_todo_id);
        const fresh = comments.filter((c) => Number(c.id) > Number(task.last_comment_id || 0) && !isBot(c));
        if (!fresh.length) continue;
        fresh.sort((a, b) => Number(a.id) - Number(b.id));
        const replyHtml = fresh.map((c) => c.content || '').join('\n<hr>\n');
        const maxId = comments.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0);
        await execute(
          `UPDATE dev_tasks SET status = 'pending', reply_html = $1, last_comment_id = $2, updated_at = NOW()
           WHERE id = $3 AND status = $4`,
          [replyHtml, maxId, task.id, task.status]
        );
        console.log(`[dev-queue] коментар активира задача #${task.id} („${task.title}")`);
      } catch (e) {
        console.error(`[dev-queue] диалог за задача #${task.id}:`, e.message);
      }
    }
  } finally {
    running = false;
  }
}

// Атомарно взимане на следващата чакаща задача (watcher-ът я заключва като running).
// attempts е и fencing токен: watcher-ът го връща при /comment и /complete, така
// закъснял („зомби") watcher от предишен claim не може да пипа новия.
// Стартов коментар се пуска само при чисто нова задача — не при продължение на диалог.
async function claimNext() {
  const task = await queryOne(
    `UPDATE dev_tasks SET status = 'running', attempts = attempts + 1, updated_at = NOW()
     WHERE id = (SELECT id FROM dev_tasks WHERE status = 'pending' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`
  );
  if (!task) return null;
  if (!task.reply_html && task.attempts === 1) {
    try {
      const auth = await getServiceAuth();
      const c = await bc.createComment(auth.token, auth.account, task.bc_project_id, task.bc_todo_id,
        '<p>🤖 Започвам работа по задачата.</p>');
      await execute('UPDATE dev_tasks SET last_comment_id = $1 WHERE id = $2', [c.id, task.id]);
      task.last_comment_id = c.id;
    } catch (e) {
      console.error('[dev-queue] start comment:', e.message); // не блокира работата
    }
  }
  return task;
}

module.exports = { initDevQueue, pollOnce, claimNext };
