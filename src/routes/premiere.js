// Premiere Pro project (.prproj) downgrader.
// A .prproj is gzip-compressed XML. Premiere refuses to open a project whose
// <Project> element Version is higher than the running app supports ("saved in a
// newer version…"). We rewrite that single Version attribute — the <Project> node
// carries ClassID 62ad66dd-0dcd-42da-a660-6d8fbde94876 — to the chosen target
// (default 1 = opens in EVERY older Premiere) and re-gzip. Nothing else changes,
// so the edit/timeline stays intact; only very new effects may not transfer.
// The uploaded file lives only in memory for the duration of the request.
const express = require('express');
const multer = require('multer');
const zlib = require('zlib');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB — large projects/sequences
const PROJECT_CLASS_ID = '62ad66dd-0dcd-42da-a660-6d8fbde94876';
// Matches …ClassID="62ad66dd-…" Version="41"  and captures the three parts so we
// can swap only the digits. Non-global on purpose: exactly one <Project> definition.
const VERSION_RE = new RegExp('(' + PROJECT_CLASS_ID + '"\\s+Version=")(\\d+)(")');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

function isGzip(buf) {
  return buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

// Decompress if gzipped, otherwise treat as plain XML (Premiere can save either).
function readProjectXml(buf) {
  if (isGzip(buf)) return zlib.gunzipSync(buf).toString('utf8');
  return buf.toString('utf8');
}

// POST /api/premiere/inspect — report the current project Version, no download.
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

// POST /api/premiere/downgrade — rewrite Version and stream back the new .prproj.
// Target comes from ?target= or body.target; defaults to 1 (universal).
router.post('/downgrade', requireAuth, upload.single('project'), (req, res) => {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ error: 'няма качен файл (поле "project")' });
  }
  let target = parseInt((req.query.target != null ? req.query.target : (req.body && req.body.target)) || '1', 10);
  if (!Number.isInteger(target) || target < 1 || target > 10000) target = 1;

  let xml;
  try { xml = readProjectXml(req.file.buffer); }
  catch (e) { return res.status(422).json({ error: 'файлът не се разархивира — валиден .prproj файл ли е?' }); }

  const m = xml.match(VERSION_RE);
  if (!m) return res.status(422).json({ error: 'в XML-а няма версия на проект — това .prproj файл ли е?' });
  const original = parseInt(m[2], 10);

  const newXml = xml.replace(VERSION_RE, '$1' + target + '$3');
  let out;
  try { out = zlib.gzipSync(Buffer.from(newXml, 'utf8')); }
  catch (e) { return res.status(500).json({ error: 'грешка при компресиране: ' + e.message }); }

  // Build a filename: <name>_v<target>.prproj. Keep an ASCII fallback for the
  // legacy filename= and a UTF-8 filename* for Cyrillic-safe download names.
  const base = String(req.file.originalname || 'project.prproj').replace(/\.prproj$/i, '');
  const cleanBase = base.replace(/[\/\\:*?"<>|]+/g, '_').trim() || 'project';
  const outName = cleanBase + '_v' + target + '.prproj';
  const asciiName = outName.replace(/[^\x20-\x7E]+/g, '_');

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition',
    'attachment; filename="' + asciiName + "\"; filename*=UTF-8''" + encodeURIComponent(outName));
  res.setHeader('X-Original-Version', String(original));
  res.setHeader('X-Target-Version', String(target));
  res.send(out);
});

// Multer errors (file too large, etc.)
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'файлът е твърде голям (макс ' + Math.round(MAX_BYTES / 1024 / 1024) + 'MB)' });
  }
  next(err);
});

module.exports = router;
