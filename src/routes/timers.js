const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { query, queryOne, execute } = require('../db/pool');
const { getUserAuth } = require('../services/basecamp-token');
const { loadBoardCards } = require('../services/bc-aggregate');

// Има ли дъската черна карта — решава СЪРВЪРЪТ, не браузърът. Преди всеки отворен таб
// пращаше своята преценка: стар таб (или друга логика) спираше таймера, следващият
// рефреш го пускаше пак от нула. Сега таймерът е един за всички. (Венци, 19.11.2026)
// Броят се само нормалните колони (без Done / „Not now"), без приоритетните (бели) карти
// и без On Hold — както таблото показва черните карти.
const sofiaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(new Date());
function boardHasOverdue(columns, today = sofiaToday()) {
  return (columns || []).some((col) => {
    const t = col.title || '';
    if (col.isDone || /not\s*now/i.test(t) || /\bdone\b|готово/i.test(t)) return false;
    return (col.cards || []).some((c) => {
      const due = c.dueOn ? String(c.dueOn).slice(0, 10) : null;
      return due && due < today && !c.completed && !c.priority;
    });
  });
}

// GET /api/timers/boards
router.get('/boards', requireAuth, async (req, res) => {
  try {
    const rows = await query('SELECT board_id, started_at, is_paused FROM board_overdue_timers');
    res.json(rows);
  } catch (err) {
    console.error('[timers]', err.message); // досега грешката не се виждаше никъде
    res.status(500).json({ error: err.message });
  }
});

// POST /api/timers/boards/sync
// Body: [{board_id, has_overdue}]
router.post('/boards/sync', requireAuth, async (req, res) => {
  try {
    const boards = req.body;
    if (!Array.isArray(boards) || boards.length === 0) return res.json([]);

    let auth = null;
    try { auth = await getUserAuth(req.user.userId); } catch { /* без Basecamp — нищо не пипаме */ }
    for (const { board_id } of boards) {
      if (!board_id || !auth) continue;
      let has_overdue;
      try { has_overdue = boardHasOverdue((await loadBoardCards(auth.token, auth.account, board_id)).columns); }
      catch (e) { console.error('[timers] board', board_id, e.message); continue; } // при грешка таймерът не се пипа
      const existing = await queryOne(
        'SELECT is_paused FROM board_overdue_timers WHERE board_id = $1',
        [board_id]
      );
      if (!existing) {
        await execute(
          'INSERT INTO board_overdue_timers (board_id, started_at, is_paused) VALUES ($1, NOW(), $2)',
          [board_id, has_overdue ? true : false]
        );
      } else if (has_overdue && !existing.is_paused) {
        await execute(
          'UPDATE board_overdue_timers SET is_paused = true WHERE board_id = $1',
          [board_id]
        );
      } else if (!has_overdue && existing.is_paused) {
        await execute(
          'UPDATE board_overdue_timers SET is_paused = false, started_at = NOW() WHERE board_id = $1',
          [board_id]
        );
      }
    }

    const rows = await query('SELECT board_id, started_at, is_paused FROM board_overdue_timers');
    res.json(rows);
  } catch (err) {
    console.error('[timers]', err.message); // досега грешката не се виждаше никъде
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.boardHasOverdue = boardHasOverdue;
