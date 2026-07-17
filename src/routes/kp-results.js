// Админ API за „Резултати за клиент" известията (виж services/kp-results.js).
const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getServiceAuth } = require('../services/basecamp-token');
const kpr = require('../services/kp-results');

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

// GET /api/kp-results/overview — всичко за секцията с една заявка.
router.get('/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cfg = await kpr.loadConfig();
    const rows = await query("SELECT key, value FROM settings WHERE key LIKE 'kp_results_%'");
    const s = {};
    for (const r of rows) s[r.key] = r.value;

    let team = await query('SELECT * FROM bc_people WHERE active = TRUE ORDER BY name');
    if (!team.length) {
      try {
        await kpr.refreshBcPeople();
        team = await query('SELECT * FROM bc_people WHERE active = TRUE ORDER BY name');
      } catch (err) {
        console.warn('[kp-results] first people load failed:', err.message);
      }
    }
    const responsibles = (await query('SELECT bc_person_id FROM kp_results_responsibles'))
      .map((r) => String(r.bc_person_id));

    // Къде отиват картите „Резултати" — авто-откриване, ако не са зададени ръчно.
    let dest = null, destError = null;
    try {
      const auth = await getServiceAuth();
      dest = await kpr.resolveCardDest(auth, cfg);
      if (!dest) destError = 'Не намирам дъска „Акаунт Мениджмънт" → колона „Разпределение".';
    } catch (err) {
      destError = err.message;
    }

    const history = await query(
      `SELECT client_name, kp, range_start, range_end, videos_count, announced_at, bc_message_id
       FROM kp_results_alerts ORDER BY announced_at DESC LIMIT 20`
    );

    res.json({
      enabled: cfg.enabled,
      time: cfg.time,
      daysAfter: cfg.daysAfter,
      since: cfg.since,
      cardEnabled: cfg.cardEnabled,
      cardWorkdays: cfg.cardWorkdays,
      cardTitle: cfg.cardTitle,
      boardUrl: s.kp_results_bc_board_url || '',
      project: cfg.project,
      board: cfg.board,
      dest, destError,
      team, responsibles, history,
    });
  } catch (err) {
    console.error('[kp-results] overview error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/kp-results/config — toggle + борд + дати + карта.
router.put('/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, boardUrl, time, daysAfter, cardEnabled, cardWorkdays, cardTitle } = req.body || {};

    if (boardUrl !== undefined) {
      const ids = parseBoardUrl(boardUrl);
      if (!ids) return res.status(400).json({ error: 'Невалиден линк — очаквам …/buckets/…/message_boards/… от Basecamp.' });
      await save('kp_results_bc_board_url', String(boardUrl).trim());
      await save('kp_results_bc_project', ids.project);
      await save('kp_results_bc_board', ids.board);
    }
    if (time !== undefined) {
      if (!/^\d{1,2}:\d{2}$/.test(String(time))) return res.status(400).json({ error: 'Часът трябва да е във формат ЧЧ:ММ.' });
      await save('kp_results_time', String(time));
    }
    if (daysAfter !== undefined) {
      const n = parseInt(daysAfter, 10);
      if (!Number.isFinite(n) || n < 0 || n > 60) return res.status(400).json({ error: 'Дните след последното видео трябва да са между 0 и 60.' });
      await save('kp_results_days_after', String(n));
    }
    if (cardEnabled !== undefined) await save('kp_results_card_enabled', cardEnabled ? 'true' : 'false');
    if (cardWorkdays !== undefined) {
      const n = parseInt(cardWorkdays, 10);
      if (!Number.isFinite(n) || n < 0 || n > 30) return res.status(400).json({ error: 'Работните дни за изработка трябва да са между 0 и 30.' });
      await save('kp_results_card_workdays', String(n));
    }
    if (cardTitle !== undefined) await save('kp_results_card_title', String(cardTitle).trim() || '{клиент} КП-{номер} - Резултати');

    if (enabled !== undefined) {
      if (enabled) {
        const cfg = await kpr.loadConfig();
        if (!cfg.project || !cfg.board) return res.status(400).json({ error: 'Първо задай линк към Message Board.' });
        // При първо включване фиксираме „от днес" — иначе всички стари, отдавна
        // приключили КП-та биха се обявили наведнъж.
        if (!cfg.since) {
          const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit',
          }).format(new Date());
          await save('kp_results_since', today);
        }
      }
      await save('kp_results_enabled', enabled ? 'true' : 'false');
    }

    await kpr.restartKpResults();
    res.json({ ok: true });
  } catch (err) {
    console.error('[kp-results] config error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kp-results/responsibles { personId }
router.post('/responsibles', requireAuth, requireAdmin, async (req, res) => {
  try {
    const personId = parseInt(req.body && req.body.personId, 10);
    if (!personId) return res.status(400).json({ error: 'personId required' });
    const person = await queryOne('SELECT person_id FROM bc_people WHERE person_id = $1', [personId]);
    if (!person) return res.status(400).json({ error: 'Човекът не е в кеша на екипа — обнови екипа.' });
    await execute('INSERT INTO kp_results_responsibles (bc_person_id) VALUES ($1) ON CONFLICT DO NOTHING', [personId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/kp-results/responsibles/:personId
router.delete('/responsibles/:personId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await execute('DELETE FROM kp_results_responsibles WHERE bc_person_id = $1', [parseInt(req.params.personId, 10) || 0]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kp-results/refresh-people — екипът от Basecamp (споделен кеш bc_people).
router.post('/refresh-people', requireAuth, requireAdmin, async (req, res) => {
  try {
    const count = await kpr.refreshBcPeople();
    res.json({ ok: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kp-results/preview — какво БИ се обявило (без нищо да се пише).
router.get('/preview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await kpr.runResultsCheck({ dryRun: true });
    res.json(result);
  } catch (err) {
    console.error('[kp-results] preview error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/kp-results/run — ръчно пускане (пише в Basecamp).
router.post('/run', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await kpr.runResultsCheck();
    res.json(result);
  } catch (err) {
    console.error('[kp-results] run error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/kp-results/test — тестово съобщение към зададения борд.
router.post('/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await kpr.postTestMessage());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
