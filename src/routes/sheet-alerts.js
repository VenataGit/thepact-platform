// Админ API за „Известия от таблица" (Google Sheets → Basecamp).
// Всичко тук е admin-only — конфигурира се от Настройки → 📊 Таблица известия.
// Самият приемник на промените е публичен (тайна в пътя) и живее в routes/webhooks.js.
const express = require('express');
const router = express.Router();
const { query, execute } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { normalizeAppUrl } = require('../services/basecamp');
const team = require('../services/bc-team');
const sa = require('../services/sheet-alerts');

// "https://3.basecamp.com/{acc}/buckets/{project}/message_boards/{board}" → ids.
function parseBoardUrl(url) {
  const m = String(url || '').match(/buckets\/(\d+)\/message_boards\/(\d+)/);
  return m ? { project: m[1], board: m[2] } : null;
}

const save = (key, value) => execute(
  `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
   ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
  [key, String(value)]
);

function originOf(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// GET /api/sheet-alerts/overview — всичко за секцията с една заявка.
router.get('/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const secret = await sa.ensureSecret();
    const cfg = await sa.loadConfig();

    let people = await query('SELECT * FROM bc_people WHERE active = TRUE ORDER BY name');
    if (!people.length) {
      try {
        await team.refreshTeam();
        people = await query('SELECT * FROM bc_people WHERE active = TRUE ORDER BY name');
      } catch (err) {
        console.warn('[sheet-alerts] first people load failed:', err.message);
      }
    }
    const responsibles = (await query('SELECT bc_person_id FROM sheet_alert_responsibles'))
      .map((r) => String(r.bc_person_id));

    const events = await query(
      `SELECT sheet_name, row_num, title, column_name, old_value, new_value,
              editor_email, important, posted, ignored, created_at
       FROM sheet_alert_events ORDER BY id DESC LIMIT 25`
    );
    // Кои акаунти изобщо са пипали таблицата — за да се игнорират с един клик,
    // вместо да се преписват имейли на ръка.
    const seenEditors = (await query(
      `SELECT DISTINCT editor_email FROM sheet_alert_events
       WHERE editor_email <> '' ORDER BY editor_email LIMIT 30`
    )).map((r) => r.editor_email);
    const threads = await query(
      `SELECT sheet_name, title, last_row, bc_message_id, updated_at
       FROM sheet_alert_threads ORDER BY updated_at DESC LIMIT 15`
    );

    res.json({
      enabled: cfg.enabled,
      boardUrl: cfg.boardUrl,
      project: cfg.project,
      board: cfg.board,
      important: cfg.important.join(', '),
      titleCols: cfg.titleCols.join(', '),
      allChanges: cfg.allChanges,
      ignored: cfg.ignored.join(', '),
      seenEditors,
      delay: cfg.delay,
      hookUrl: `${originOf(req)}/webhooks/sheet/${secret}`,
      script: sa.appsScriptCode(secret, originOf(req)),
      team: people,
      responsibles,
      events,
      threads,
    });
  } catch (err) {
    console.error('[sheet-alerts] overview error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/sheet-alerts/config
router.put('/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, boardUrl, important, titleCols, allChanges, ignored, delay } = req.body || {};

    if (boardUrl !== undefined) {
      const ids = parseBoardUrl(boardUrl);
      if (!ids) return res.status(400).json({ error: 'Невалиден линк — очаквам …/buckets/…/message_boards/… от Basecamp.' });
      await save('sheet_alerts_bc_board_url', String(boardUrl).trim());
      await save('sheet_alerts_bc_project', ids.project);
      await save('sheet_alerts_bc_board', ids.board);
    }
    if (important !== undefined) {
      const list = String(important).split(',').map((s) => s.trim()).filter(Boolean);
      if (!list.length) return res.status(400).json({ error: 'Задай поне една важна колона.' });
      await save('sheet_alerts_important', list.join(','));
    }
    if (titleCols !== undefined) {
      const list = String(titleCols).split(',').map((s) => s.trim()).filter(Boolean);
      if (!list.length) return res.status(400).json({ error: 'Задай поне една колона за име на видеото.' });
      await save('sheet_alerts_title_cols', list.join(','));
    }
    if (allChanges !== undefined) await save('sheet_alerts_all_changes', allChanges ? 'true' : 'false');
    if (ignored !== undefined) {
      // Празният списък е валиден — значи „известявай за всички".
      const list = String(ignored).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const bad = list.find((v) => !v.includes('@'));
      if (bad) return res.status(400).json({ error: `„${bad}" не е имейл или домейн — очаквам ivan@thepact.bg или @thepact.bg.` });
      await save('sheet_alerts_ignored', list.join(','));
    }
    if (delay !== undefined) {
      const n = parseInt(delay, 10);
      if (!Number.isFinite(n) || n < 0 || n > 600) return res.status(400).json({ error: 'Изчакването трябва да е между 0 и 600 секунди.' });
      await save('sheet_alerts_delay', String(n));
    }
    if (enabled !== undefined) {
      if (enabled) {
        const cfg = await sa.loadConfig();
        if (!cfg.project || !cfg.board) return res.status(400).json({ error: 'Първо задай линк към Message Board.' });
      }
      await save('sheet_alerts_enabled', enabled ? 'true' : 'false');
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[sheet-alerts] config error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sheet-alerts/responsibles — { personId }
router.post('/responsibles', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pid = String((req.body && req.body.personId) || '');
    if (!/^\d+$/.test(pid)) return res.status(400).json({ error: 'Невалиден човек.' });
    await execute('INSERT INTO sheet_alert_responsibles (bc_person_id) VALUES ($1) ON CONFLICT DO NOTHING', [pid]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[sheet-alerts] add responsible error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/sheet-alerts/responsibles/:id
router.delete('/responsibles/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ error: 'Невалиден човек.' });
    await execute('DELETE FROM sheet_alert_responsibles WHERE bc_person_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[sheet-alerts] remove responsible error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sheet-alerts/refresh-people — обновяване на екипа от Basecamp.
router.post('/refresh-people', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await team.refreshTeam();
    res.json({ ok: true, count: r.count });
  } catch (err) {
    console.error('[sheet-alerts] refresh people error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sheet-alerts/test — тестово съобщение в борда.
router.post('/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const message = await sa.postTestMessage();
    res.json({ ok: true, url: normalizeAppUrl(message.app_url) || null });
  } catch (err) {
    console.error('[sheet-alerts] test error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sheet-alerts/rotate — нова тайна (старият скрипт спира да работи).
router.post('/rotate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const secret = await sa.rotateSecret();
    res.json({ ok: true, hookUrl: `${originOf(req)}/webhooks/sheet/${secret}` });
  } catch (err) {
    console.error('[sheet-alerts] rotate error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/sheet-alerts/events — изчиства дневника (за чист тест).
router.delete('/events', requireAuth, requireAdmin, async (req, res) => {
  try {
    await execute('DELETE FROM sheet_alert_events');
    res.json({ ok: true });
  } catch (err) {
    console.error('[sheet-alerts] clear events error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/sheet-alerts/threads — забравя нишките, за да тръгнат нови съобщения.
router.delete('/threads', requireAuth, requireAdmin, async (req, res) => {
  try {
    await execute('DELETE FROM sheet_alert_threads');
    res.json({ ok: true });
  } catch (err) {
    console.error('[sheet-alerts] clear threads error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
