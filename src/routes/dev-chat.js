// Dev Chat API — говори САМО с watcher скрипта на компютъра на Венци.
// Auth: header X-Dev-Queue-Key срещу env DEV_QUEUE_SECRET (същият като dev-queue).
// Без настроен secret целият router е изключен (503).
//
// Потокът: watcher-ът claim-ва следващото съобщение (/next), пуска Claude в разговорен
// режим и връща отговора (/complete). Отговорът се публикува в Campfire чата през бота
// ThePactAlerts. session_id-то на разговора е глобално — една продължаваща сесия.
const express = require('express');
const router = express.Router();
const config = require('../config');
const { queryOne } = require('../db/pool');
const bc = require('../services/basecamp');
const { getServiceAuth } = require('../services/basecamp-token');
const dc = require('../services/dev-chat');

router.use((req, res, next) => {
  if (!config.DEV_QUEUE_SECRET) return res.status(503).json({ error: 'dev chat not configured' });
  if (req.get('x-dev-queue-key') !== config.DEV_QUEUE_SECRET) return res.status(403).json({ error: 'forbidden' });
  next();
});

// Чист текст → Campfire rich content (екранирано, нов ред → <br>).
function toCampfire(text) {
  return String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
}

// Следващо чакащо съобщение — ЗАКЛЮЧВА го (running).
router.get('/next', async (req, res) => {
  try {
    const msg = await dc.claimNextChat();
    res.json({ msg: msg || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Финал: { text, ok, attempt, session_id } → done/error + отговор в Campfire чата.
// Статусът се пише ПЪРВИ (по модела на dev-queue) — провалът на публикуването се
// връща като post_error и watcher-ът го логва; съобщението не се преработва наново.
router.post('/:id(\\d+)/complete', async (req, res) => {
  try {
    const msg = await queryOne('SELECT * FROM dev_chat WHERE id = $1', [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'not found' });
    if (msg.status !== 'running' || Number(req.body?.attempt) !== Number(msg.attempts)) {
      return res.status(409).json({ error: 'stale claim', status: msg.status, attempts: msg.attempts });
    }
    const text = String(req.body?.text || '').trim();
    const ok = req.body?.ok !== false;
    const updated = await queryOne(
      `UPDATE dev_chat SET status = $1, reply = $2, updated_at = NOW()
       WHERE id = $3 AND status = 'running' AND attempts = $4 RETURNING id`,
      [ok ? 'done' : 'error', text.slice(0, 8000) || null, msg.id, msg.attempts]
    );
    if (!updated) return res.status(409).json({ error: 'stale claim (raced)' });

    // Сесията на разговора се помни глобално (следващото съобщение --resume-ва).
    if (req.body?.session_id) await dc.saveSetting('dev_chat_session_id', req.body.session_id);

    let postError = null;
    if (text) {
      try {
        const cfg = await queryOne(
          "SELECT string_agg(key || '=' || value, ',') AS s FROM settings WHERE key IN ('dev_chat_bc_project','dev_chat_bc_chat')"
        );
        const map = Object.fromEntries(String(cfg?.s || '').split(',').filter(Boolean).map((kv) => kv.split('=')));
        const project = parseInt(map.dev_chat_bc_project) || 47742842;
        const chat = parseInt(map.dev_chat_bc_chat) || 10005689776;
        const auth = await getServiceAuth();
        await bc.createCampfireLine(auth.token, auth.account, project, chat, toCampfire(text));
      } catch (e) {
        postError = e.message;
        console.error('[dev-chat] отговорът в Campfire не мина:', e.message);
      }
    }
    res.json({ ok: true, post_error: postError });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Връщане в опашката БЕЗ отговор — за инфраструктурни провали на watcher-а
// (напр. CLI-то не е логнато): съобщението не е виновно, чака следващия опит.
router.post('/:id(\\d+)/release', async (req, res) => {
  try {
    const msg = await queryOne('SELECT * FROM dev_chat WHERE id = $1', [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'not found' });
    if (msg.status !== 'running' || Number(req.body?.attempt) !== Number(msg.attempts)) {
      return res.status(409).json({ error: 'stale claim' });
    }
    const updated = await queryOne(
      `UPDATE dev_chat SET status = 'pending', updated_at = NOW()
       WHERE id = $1 AND status = 'running' AND attempts = $2 RETURNING id`,
      [msg.id, msg.attempts]
    );
    if (!updated) return res.status(409).json({ error: 'stale claim (raced)' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
