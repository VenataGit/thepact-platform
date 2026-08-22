// Бекъп на Basecamp проекта Video Production — един самостоятелен HTML (или JSON).
//
// Вика се от планираната задача „ThePactBasecampBackup" на компютъра на Венци
// (scripts/backup/backup-basecamp.ps1), която записва файла в
// Z:\Backup - платформа и бейскамп. Сървърът не вижда тази мрежова папка, затова
// той само подава файла, а свалянето и записът стават от компютъра.
//
// Достъп: същият ключ като Dev Queue (header X-Dev-Queue-Key) — той вече е
// настроен и на сървъра, и на компютъра. Влезли админи могат да отворят адреса
// и от браузъра, за да видят как изглежда бекъпът, без да чакат събота.
const express = require('express');
const router = express.Router();
const config = require('../config');
const { requireAdmin } = require('../middleware/auth');
const backup = require('../services/bc-backup');

// Ключ в хедъра → пуска се веднага; иначе се минава през нормалния админ логин.
function keyOrAdmin(req, res, next) {
  const key = req.get('x-dev-queue-key');
  if (config.DEV_QUEUE_SECRET && key === config.DEV_QUEUE_SECRET) return next();
  if (key) return res.status(403).json({ error: 'forbidden' });
  return requireAdmin(req, res, next);
}

// GET /api/backup/basecamp[?format=json][&comments=0][&fresh=1]
// Пълното изтегляне отнема 2-3 минути (заявките към Basecamp са нарочно бавни,
// за да не ударим лимита му) — отговорът се пише чак когато всичко е събрано.
// Снимката се пази 15 минути, за да са HTML-ът и JSON-ът един и същи момент.
router.get('/basecamp', keyOrAdmin, async (req, res) => {
  try {
    const snap = await backup.getSnapshot({
      comments: req.query.comments !== '0',
      fresh: req.query.fresh === '1',
    });
    if (req.query.format === 'json') {
      res.set('Cache-Control', 'no-store');
      return res.json(snap);
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    return res.send(backup.renderHtml(snap));
  } catch (e) {
    console.error('[backup] Basecamp бекъпът се провали:', e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
