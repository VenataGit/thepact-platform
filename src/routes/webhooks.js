// Basecamp webhook receiver. Registered on the Video Production project for Kanban::Card
// events, so when a card's Due date changes the bot recomputes the stage step dates instantly.
// The secret lives in the URL path — only Basecamp (which we gave the URL) can reach it.
const express = require('express');
const router = express.Router();
const config = require('../config');
const { syncCardDates } = require('../services/bc-date-sync');
const sheetAlerts = require('../services/sheet-alerts');

router.post('/basecamp/:secret', (req, res) => {
  if (!config.BASECAMP_WEBHOOK_SECRET || req.params.secret !== config.BASECAMP_WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.status(200).json({ ok: true }); // acknowledge immediately; do the work async

  try {
    const rec = (req.body && req.body.recording) || {};
    const kind = (req.body && req.body.kind) || '';
    // We subscribe to Kanban::Card only, but guard against step events just in case (no loops).
    if (rec.id && !/step/i.test(kind)) {
      syncCardDates(rec.id)
        .then((r) => { if (r && r.changes && r.changes.length) console.log('[bc-date-sync] updated', JSON.stringify(r)); })
        .catch((e) => console.error('[bc-date-sync]', e.message));
    }
  } catch (e) {
    console.error('[webhook basecamp]', e.message);
  }
});

// Google Sheets → „Известия от таблица". Apps Script в таблицата на клиента праща
// всяка редакция тук; тайната е в пътя (както при Basecamp), а се пази в settings,
// за да може да се върти от админ панела. Отговаряме веднага — Apps Script чака
// отговор синхронно и не бива да го бавим с Basecamp заявки.
router.post('/sheet/:secret', async (req, res) => {
  let cfg;
  try {
    cfg = await sheetAlerts.loadConfig();
  } catch (e) {
    console.error('[webhook sheet] config:', e.message);
    return res.status(500).json({ error: 'config' });
  }
  if (!cfg.secret || req.params.secret !== cfg.secret) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.status(200).json({ ok: true });

  sheetAlerts.handleHit(req.body).catch((e) => console.error('[webhook sheet]', e.message));
});

module.exports = router;
