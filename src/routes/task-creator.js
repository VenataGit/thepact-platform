// Инструментът „Създаване на задачи" (More → Създаване на задачи) — достъпен за всички.
//
// Картите се създават ВИНАГИ от бот профила ThePactAlerts (getServiceAuth), а не от
// акаунта на човека, който ги поръчва — така в Basecamp авторът е един и същ, а кой
// я е поръчал се вижда в Настройки → Създаване на задачи (таблица created_task_log).
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { query, execute } = require('../db/pool');
const bc = require('../services/basecamp');
const agg = require('../services/bc-aggregate');
const kpc = require('../services/kp-create');
const { getServiceAuth } = require('../services/basecamp-token');
const tc = require('../services/task-creator');
const fp = require('../services/folder-paths');
const fq = require('../services/folder-queue');

const MAX_TITLE = 200;
const MAX_CONTENT = 20000;

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

// Дъската + колоната за задачите „Измисляне". Явните настройки печелят; празни
// настройки → авто по име (Pre-Production → Измисляне), както при КП картите.
function resolvePlanDest(struct, cfg) {
  const boards = struct.boards || [];
  let board = cfg.planBoardId ? boards.find((b) => String(b.id) === String(cfg.planBoardId)) : null;
  if (!board) {
    board = boards.find((b) => /pre[\s-]*produc|предпрод/i.test(b.title || '') && !/post|пост/i.test(b.title || ''));
  }
  if (!board) throw new Error('Не намерих дъска „Pre-Production" в Basecamp — задай я в Настройки → Създаване на задачи.');

  const cols = board.columns || [];
  let column = cfg.planColumnId ? cols.find((c) => String(c.id) === String(cfg.planColumnId)) : null;
  if (!column) column = cols.find((c) => /измисляне/i.test(c.title || '')) || cols.find((c) => !c.isDone);
  if (!column) throw new Error(`Дъската „${board.title}" няма подходяща колона за задачите.`);

  return {
    projectId: struct.projectId,
    boardId: board.id, boardTitle: board.title,
    columnId: column.id, columnTitle: column.title,
  };
}

async function logCreated(req, row) {
  try {
    await execute(
      `INSERT INTO created_task_log
        (user_id, user_name, kind, title, bc_card_id, card_url, board_title, column_title, video_count, due_on, step_dates)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        req.user.userId, req.user.name || '', row.kind, row.title,
        row.cardId || null, row.url || '', row.board || '', row.column || '',
        row.videoCount || null, row.dueOn || null,
        row.stepDates ? JSON.stringify(row.stepDates) : null,
      ]
    );
  } catch (e) {
    // Историята никога не бива да събори създаването на картата — тя вече е в Basecamp.
    console.error('[task-creator log]', e.message);
  }
}

// GET /api/task-creator/init — какво може да избере човекът: дъски/колони, къде отива
// задачата за измисляне, стъпките и техните отмествания.
router.get('/init', requireAuth, async (req, res) => {
  try {
    const cfg = await tc.loadTaskCfg();
    const auth = await getServiceAuth();
    const struct = await agg.loadStructure(auth.token, auth.account);
    let plan = null, planError = null;
    try { plan = resolvePlanDest(struct, cfg); } catch (e) { planError = e.message; }
    res.json({
      boards: (struct.boards || []).map((b) => ({
        id: String(b.id),
        title: b.title,
        columns: (b.columns || []).map((c) => ({ id: String(c.id), title: c.title, isDone: !!c.isDone })),
      })),
      plan: plan ? { boardId: String(plan.boardId), boardTitle: plan.boardTitle, columnId: String(plan.columnId), columnTitle: plan.columnTitle } : null,
      planError,
      steps: cfg.steps,
      maxVideos: cfg.maxVideos,
      defaultVideos: cfg.defaultVideos,
      // Описанието на единичната задача тръгва попълнено с този шаблон.
      singleTemplate: cfg.singleTemplate,
    });
  } catch (err) {
    console.error('[task-creator init]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/task-creator/dates?field=publish|<step key>&date=YYYY-MM-DD
// Смята останалите дати по системата (работни дни + БГ празници).
router.get('/dates', requireAuth, async (req, res) => {
  try {
    const cfg = await tc.loadTaskCfg();
    res.json(tc.deriveDates(cfg.steps, String(req.query.field || 'publish'), String(req.query.date || '')));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/task-creator/plan { title, dueOn, videoCount, extraInfo } — задача за измисляне.
router.post('/plan', requireAuth, async (req, res) => {
  try {
    const title = clean(req.body?.title, MAX_TITLE);
    if (!title) return res.status(400).json({ error: 'Напиши име на задачата.' });
    const dueOn = req.body?.dueOn ? String(req.body.dueOn).slice(0, 10) : null;
    if (dueOn && !tc.isDate(dueOn)) return res.status(400).json({ error: 'Невалиден краен срок.' });

    const cfg = await tc.loadTaskCfg();
    const videoCount = parseInt(req.body?.videoCount, 10);
    if (!Number.isFinite(videoCount) || videoCount < 1 || videoCount > cfg.maxVideos) {
      return res.status(400).json({ error: `Броят видеа трябва да е между 1 и ${cfg.maxVideos}.` });
    }

    const auth = await getServiceAuth();
    const struct = await agg.loadStructure(auth.token, auth.account);
    const dest = resolvePlanDest(struct, cfg);

    const extraInfo = clean(req.body?.extraInfo, MAX_CONTENT);
    // Локациите идват от заглавието („Клиент КП-12") — виж services/folder-paths.js.
    // Тук блокът е най-отгоре: текстът на плана съдържа N видео секции, всяка със свое
    // „Описание:", тоест вмъкването по средата би паднало вътре в първото видео.
    const content = fp.locationHtml(title, { lead: false })
      + kpc.textToBcHtml(tc.buildPlanText(cfg, title, videoCount, extraInfo));
    const card = await bc.createCard(auth.token, auth.account, dest.projectId, dest.columnId, {
      title, content, due_on: dueOn || undefined,
    });
    agg.invalidateBoard(dest.boardId);
    // Папката на самия контент план — видео папките идват при разбиването.
    await fq.enqueue({ cardId: card.id, title });

    const out = {
      kind: 'plan', title: card.title || title, cardId: card.id,
      url: bc.normalizeAppUrl(card.app_url), board: dest.boardTitle, column: dest.columnTitle,
      videoCount, dueOn,
    };
    await logCreated(req, out);
    res.json(out);
  } catch (err) {
    console.error('[task-creator plan]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/task-creator/single { title, content, boardId, columnId, dueOn, stepDates }
// Единична задача — карта + стъпките с техните дати.
router.post('/single', requireAuth, async (req, res) => {
  try {
    const title = clean(req.body?.title, MAX_TITLE);
    if (!title) return res.status(400).json({ error: 'Напиши име на задачата.' });
    const dueOn = req.body?.dueOn ? String(req.body.dueOn).slice(0, 10) : null;
    if (dueOn && !tc.isDate(dueOn)) return res.status(400).json({ error: 'Невалидна дата за публикуване.' });
    const boardId = String(req.body?.boardId || '');
    const columnId = String(req.body?.columnId || '');
    if (!boardId || !columnId) return res.status(400).json({ error: 'Избери дъска и колона.' });

    const cfg = await tc.loadTaskCfg();
    const auth = await getServiceAuth();
    const struct = await agg.loadStructure(auth.token, auth.account);

    // Само дъска/колона от НАШИЯ проект — иначе картата може да иде къде ли не.
    const board = (struct.boards || []).find((b) => String(b.id) === boardId);
    if (!board) return res.status(400).json({ error: 'Непозната дъска.' });
    const column = (board.columns || []).find((c) => String(c.id) === columnId);
    if (!column) return res.status(400).json({ error: 'Колоната не е от избраната дъска.' });

    // Датите на стъпките: каквото човекът е оставил във формата (той има пълен контрол).
    const raw = req.body?.stepDates || {};
    const stepDates = {};
    for (const s of cfg.steps) {
      const v = raw[s.key];
      if (v == null || v === '') continue;
      const d = String(v).slice(0, 10);
      if (!tc.isDate(d)) return res.status(400).json({ error: `Невалидна дата за „${s.title}".` });
      stepDates[s.key] = d;
    }

    const contentText = clean(req.body?.content, MAX_CONTENT);
    // Локациите идват от заглавието и стоят ГОРЕ — след водещите /…/ редове, преди
    // „Описание:" (services/folder-paths.js).
    const split = fp.splitForLocation(contentText);
    const content = kpc.textToBcHtml(split.before) + fp.locationHtml(title) + kpc.textToBcHtml(split.after);
    const card = await bc.createCard(auth.token, auth.account, struct.projectId, column.id, {
      title,
      content: content || undefined,
      due_on: dueOn || undefined,
    });

    // Папките ги прави агентът в офиса — тук само записваме заявката (никога не хвърля).
    await fq.enqueue({ cardId: card.id, title });

    const stepErrors = [];
    const stepsByTitle = {};
    for (const s of cfg.steps) {
      try {
        await bc.createStep(auth.token, auth.account, struct.projectId, card.id, {
          title: s.title, due_on: stepDates[s.key] || undefined,
        });
        if (stepDates[s.key]) stepsByTitle[s.title] = stepDates[s.key];
      } catch (e) {
        console.warn('[task-creator] step failed', s.title, e.message);
        stepErrors.push(s.title);
      }
    }
    agg.invalidateBoard(board.id);

    const out = {
      kind: 'single', title: card.title || title, cardId: card.id,
      url: bc.normalizeAppUrl(card.app_url), board: board.title, column: column.title,
      dueOn, stepDates: stepsByTitle, stepErrors,
    };
    await logCreated(req, out);
    res.json(out);
  } catch (err) {
    console.error('[task-creator single]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/task-creator/history — админ: кой какви карти е поръчвал.
router.get('/history', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 60));
    const rows = await query(
      `SELECT l.*, u.name AS current_name, u.avatar_url
         FROM created_task_log l
         LEFT JOIN users u ON u.id = l.user_id
        ORDER BY l.created_at DESC
        LIMIT $1`,
      [limit]
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('[task-creator history]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/task-creator/templates — админ: шаблоните за задачата „Измисляне".
router.get('/templates', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cfg = await tc.loadTaskCfg();
    res.json({
      template: cfg.mainTemplate,
      videoSection: cfg.videoTemplate,
      singleTemplate: cfg.singleTemplate,
      ownTemplate: cfg.ownMainTemplate,
      ownVideoSection: cfg.ownVideoTemplate,
      ownSingleTemplate: cfg.ownSingleTemplate,
      steps: cfg.steps,
      defaultSteps: tc.DEFAULT_STEPS,
      maxVideos: cfg.maxVideos,
      defaultVideos: cfg.defaultVideos,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/task-creator/templates { template, videoSection, singleTemplate } — админ.
// Празен низ = изтриване на собствения шаблон → пак се ползва КП шаблонът.
router.put('/templates', requireAuth, requireAdmin, async (req, res) => {
  try {
    const save = async (key, value) => {
      if (value == null) return;
      const v = String(value);
      if (!v.trim()) { await execute('DELETE FROM app_settings WHERE key = $1', [key]); return; }
      await execute(
        'INSERT INTO app_settings (key, value, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
        [key, v.slice(0, MAX_CONTENT)]
      );
    };
    await save('task_plan_template', req.body?.template);
    await save('task_plan_video_template', req.body?.videoSection);
    await save('task_single_template', req.body?.singleTemplate);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/task-creator/steps { steps: [{title, label, offset}] } — админ.
// Празен списък = връщане към стъпките по подразбиране (16/11/6/1).
router.put('/steps', requireAuth, requireAdmin, async (req, res) => {
  try {
    const arr = Array.isArray(req.body?.steps) ? req.body.steps : [];
    const cleaned = arr
      .map((s) => ({
        title: clean(s?.title, 120),
        label: clean(s?.label, 60),
        offset: Math.max(0, parseInt(s?.offset, 10) || 0),
      }))
      .filter((s) => s.title);
    if (cleaned.length > 12) return res.status(400).json({ error: 'Максимум 12 стъпки.' });
    if (!cleaned.length) {
      await execute('DELETE FROM settings WHERE key = $1', ['task_single_steps']);
      return res.json({ ok: true, steps: tc.DEFAULT_STEPS });
    }
    await execute(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,NOW())
       ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
      ['task_single_steps', JSON.stringify(cleaned)]
    );
    res.json({ ok: true, steps: tc.parseSteps(JSON.stringify(cleaned)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
