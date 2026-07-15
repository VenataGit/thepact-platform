// Dev Queue API — говори САМО с watcher скрипта на компютъра на Венци.
// Auth: header X-Dev-Queue-Key срещу env DEV_QUEUE_SECRET (по модела на webhook secret-а).
// Без настроен secret целият router е изключен (503) — нищо не изтича по подразбиране.
//
// Fencing: claimNext връща attempts; watcher-ът го подава обратно като body.attempt.
// Callback за друг (по-стар) claim или за задача извън running → 409 и НИЩО не се
// пише (нито в DB, нито в Basecamp) — пази от „зомби" watcher след hibernate.
const express = require('express');
const router = express.Router();
const config = require('../config');
const { query, queryOne, execute } = require('../db/pool');
const bc = require('../services/basecamp');
const { getServiceAuth } = require('../services/basecamp-token');
const dq = require('../services/dev-queue');

router.use((req, res, next) => {
  if (!config.DEV_QUEUE_SECRET) return res.status(503).json({ error: 'dev queue not configured' });
  if (req.get('x-dev-queue-key') !== config.DEV_QUEUE_SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// Следващата задача. Без параметри я ЗАКЛЮЧВА (running); ?peek=1 само показва.
router.get('/next', async (req, res) => {
  try {
    if (req.query.peek) {
      const task = await queryOne("SELECT * FROM dev_tasks WHERE status = 'pending' ORDER BY created_at, id LIMIT 1");
      return res.json({ task: task || null, peek: true });
    }
    const task = await dq.claimNext();
    res.json({ task: task || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Валиден ли е callback-ът за текущия claim? (задача + running + верен attempt)
async function loadClaimed(req, res) {
  const task = await queryOne('SELECT * FROM dev_tasks WHERE id = $1', [req.params.id]);
  if (!task) { res.status(404).json({ error: 'not found' }); return null; }
  if (task.status !== 'running' || Number(req.body?.attempt) !== Number(task.attempts)) {
    res.status(409).json({ error: 'stale claim', status: task.status, attempts: task.attempts });
    return null;
  }
  return task;
}

// Междинен коментар под задачата. { html, attempt, question: true } → чакаме отговор.
router.post('/:id(\\d+)/comment', async (req, res) => {
  try {
    const task = await loadClaimed(req, res);
    if (!task) return;
    const html = String(req.body?.html || '').trim();
    if (!html) return res.status(400).json({ error: 'html required' });
    const auth = await getServiceAuth();
    const c = await bc.createComment(auth.token, auth.account, task.bc_project_id, task.bc_todo_id, html);
    const question = !!req.body?.question;
    const updated = await queryOne(
      `UPDATE dev_tasks SET last_comment_id = $1, session_id = COALESCE($2, session_id),
         status = CASE WHEN $3 THEN 'waiting_reply' ELSE status END,
         reply_html = CASE WHEN $3 THEN NULL ELSE reply_html END,
         updated_at = NOW()
       WHERE id = $4 AND status = 'running' AND attempts = $5
       RETURNING id`,
      [c.id, req.body?.session_id || null, question, task.id, task.attempts]
    );
    if (!updated) return res.status(409).json({ error: 'stale claim (raced)' });
    res.json({ ok: true, comment_id: c.id, waiting: question });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Финал: { html, ok: true|false, attempt, session_id } → done/error + коментар.
// СТАТУСЪТ се пише ПЪРВИ (свършената работа никога не се изпълнява повторно
// само защото Basecamp коментарът е гръмнал) — провалът на коментара се връща
// като comment_error и watcher-ът го логва.
router.post('/:id(\\d+)/complete', async (req, res) => {
  try {
    const task = await loadClaimed(req, res);
    if (!task) return;
    const html = String(req.body?.html || '').trim();
    const ok = req.body?.ok !== false;
    const updated = await queryOne(
      `UPDATE dev_tasks SET status = $1, result = $2, session_id = COALESCE($3, session_id),
         reply_html = NULL, updated_at = NOW()
       WHERE id = $4 AND status = 'running' AND attempts = $5
       RETURNING id`,
      [ok ? 'done' : 'error', html.slice(0, 4000) || null, req.body?.session_id || null, task.id, task.attempts]
    );
    if (!updated) return res.status(409).json({ error: 'stale claim (raced)' });
    let commentError = null;
    if (html) {
      try {
        const auth = await getServiceAuth();
        const c = await bc.createComment(auth.token, auth.account, task.bc_project_id, task.bc_todo_id, html);
        await execute('UPDATE dev_tasks SET last_comment_id = $1 WHERE id = $2', [c.id, task.id]);
      } catch (e) {
        commentError = e.message;
        console.error('[dev-queue] финалният коментар не мина:', e.message);
      }
    }
    res.json({ ok: true, comment_error: commentError });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Връщане в опашката БЕЗ резултат и без коментар — за инфраструктурни провали
// на watcher-а (напр. CLI-то не е логнато): задачата не е виновна, не бива да
// изгаря като error, нито да чака stale recovery.
router.post('/:id(\\d+)/release', async (req, res) => {
  try {
    const task = await loadClaimed(req, res);
    if (!task) return;
    const updated = await queryOne(
      `UPDATE dev_tasks SET status = 'pending', updated_at = NOW()
       WHERE id = $1 AND status = 'running' AND attempts = $2
       RETURNING id`,
      [task.id, task.attempts]
    );
    if (!updated) return res.status(409).json({ error: 'stale claim (raced)' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Диагностика: последните задачи в опашката (за наблюдение от watcher-а/админа).
router.get('/status', async (req, res) => {
  try {
    const tasks = await query(
      `SELECT id, bc_todo_id, title, list_name, status, attempts, stale_retries,
              (session_id IS NOT NULL) AS has_session, created_at, updated_at
       FROM dev_tasks ORDER BY updated_at DESC LIMIT 30`
    );
    res.json({ tasks });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
