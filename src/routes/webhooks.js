// Basecamp webhook receiver. Registered on the Video Production project for Kanban::Card
// events, so when a card's Due date changes the bot recomputes the stage step dates instantly.
// The secret lives in the URL path — only Basecamp (which we gave the URL) can reach it.
const express = require('express');
const router = express.Router();
const config = require('../config');
const { syncCardDates } = require('../services/bc-date-sync');

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

module.exports = router;
