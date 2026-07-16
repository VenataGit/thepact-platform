// Premiere Pro project (.prproj) downgrader.
//
// A .prproj is gzip-compressed XML. Simply lowering the <Project> Version number
// works only up to PP2025 — from PP2026 (schema v45) Adobe changed the project
// STRUCTURE (Object Mask, new colour management, tone mapping, clip-channel
// serializers), so a number-swapped 2026 file crashes older Premiere.
//
// A faithful downgrade therefore needs a full schema re-serialization. We proxy
// that to the zerobalanced conversion engine (a Cloudflare Worker) FROM our own
// server, so the whole flow stays on thepact.pro. Free & unlimited for files
// under 100 KB; larger files hit the engine's paid tier and come back as an error.
// The uploaded file lives only in memory for the request.
const express = require('express');
const multer = require('multer');
const zlib = require('zlib');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB hard cap on upload (engine's free limit is 100 KB)
const PROJECT_CLASS_ID = '62ad66dd-0dcd-42da-a660-6d8fbde94876';
const VERSION_RE = new RegExp('(' + PROJECT_CLASS_ID + '"\\s+Version=")(\\d+)(")');
const ENGINE_URL = 'https://floral-hall-076a.sanju-a25.workers.dev/downgrade-prproj?format=json';
const VALID_TARGET = /^20(19|2[0-6])$/; // "2019".."2026"

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

function isGzip(buf) {
  return buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

// Decompress if gzipped, otherwise treat as plain XML (Premiere can save either).
function readProjectXml(buf) {
  if (isGzip(buf)) return zlib.gunzipSync(buf).toString('utf8');
  return buf.toString('utf8');
}

// POST /api/premiere/inspect — report the current project Version (for the UI).
router.post('/inspect', requireAuth, upload.single('project'), (req, res) => {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ error: 'няма качен файл (поле "project")' });
  }
  let xml;
  try { xml = readProjectXml(req.file.buffer); }
  catch (e) { return res.status(422).json({ error: 'файлът не се разархивира — валиден .prproj файл ли е?' }); }
  const m = xml.match(VERSION_RE);
  if (!m) return res.status(422).json({ error: 'в XML-а няма версия на проект — това .prproj файл ли е?' });
  res.json({ version: parseInt(m[2], 10) });
});

// POST /api/premiere/convert — proxy the file to the zerobalanced schema engine
// and return { ok, name, data(base64), logs[] } (or { error }). Body: target=<year>.
router.post('/convert', requireAuth, upload.single('project'), async (req, res) => {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ error: 'няма качен файл (поле "project")' });
  }
  const target = String((req.body && req.body.target) || '').trim();
  if (!VALID_TARGET.test(target)) return res.status(400).json({ error: 'невалидна целева версия' });

  const buf = req.file.buffer;
  const name = String(req.file.originalname || 'project.prproj');
  // Random per-request device id — the engine uses it only for its free-tier bookkeeping.
  const deviceId = 'pact_' + crypto.randomBytes(6).toString('hex');

  let r, j;
  try {
    r = await fetch(ENGINE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-target-version': target,
        'x-file-name': name,
        'x-original-size': String(buf.length),
        'x-device-id': deviceId,
      },
      body: buf,
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? 'конверторът не отговори навреме' : ('конверторът е недостъпен: ' + e.message);
    return res.status(504).json({ error: msg });
  }
  try { j = await r.json(); } catch { j = null; }
  if (!r.ok || !j || !j.ok) {
    return res.status(502).json({ error: (j && j.err) ? j.err : ('конверторът върна грешка (HTTP ' + r.status + ')') });
  }
  const outName = j.name || (name.replace(/\.prproj$/i, '') + '_PP' + target + '.prproj');
  res.json({ ok: true, name: outName, data: j.data, logs: Array.isArray(j.logs) ? j.logs : [] });
});

// Multer errors (file too large, etc.)
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'файлът е твърде голям (макс ' + Math.round(MAX_BYTES / 1024 / 1024) + 'MB)' });
  }
  next(err);
});

module.exports = router;
