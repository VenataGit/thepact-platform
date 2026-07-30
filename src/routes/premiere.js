// Premiere Pro project (.prproj) downgrader.
//
// A .prproj is gzip-compressed XML. The <Project> object carries a schema
// Version number; Premiere refuses to open a project whose number is newer
// than itself. For projects saved in PP2025 and older, lowering that number is
// the whole job — the surrounding structure is compatible, so we do it right
// here with zlib. No third party, no size limit.
//
// PP2026 (schema 45) is the exception: Adobe changed the project STRUCTURE
// (Object Mask & co.), so a number-swapped 2026 file crashes PP2025 — Adobe
// confirmed this themselves. A faithful 2026 downgrade needs the project's
// object graph re-hosted in a genuine older-schema container, which we proxy
// to the zerobalanced conversion engine (free up to 500 KB).
//
// The uploaded file lives only in memory for the request.
const express = require('express');
const multer = require('multer');
const zlib = require('zlib');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const MAX_BYTES = 200 * 1024 * 1024;      // hard cap on upload
const ENGINE_MAX_BYTES = 500 * 1024;      // engine's free tier, reported by the engine itself
const PROJECT_CLASS_ID = '62ad66dd-0dcd-42da-a660-6d8fbde94876';
const VERSION_RE = new RegExp('(' + PROJECT_CLASS_ID + '"\\s+Version=")(\\d+)(")', 'g');
const ENGINE_URL = 'https://floral-hall-076a.sanju-a25.workers.dev/downgrade-prproj?format=json';

// Premiere release year -> internal <Project> schema Version number.
// Anchored on documented values (2019 = 37, 2020 = 38) and on the engine's own
// output ("Blank Project Version: 43 | Target: 2025", "Schema v45 -> PP2025").
const YEAR_TO_VERSION = { 2019: 37, 2020: 38, 2021: 39, 2022: 40, 2023: 41, 2024: 42, 2025: 43 };

// From this schema up, a plain number swap produces a file that crashes older Premiere.
const STRUCTURED_SCHEMA = 45;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

function isGzip(buf) {
  return buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

// Decompress if gzipped, otherwise treat as plain XML (Premiere reads either).
function readProjectXml(buf) {
  if (isGzip(buf)) return zlib.gunzipSync(buf).toString('utf8');
  return buf.toString('utf8');
}

function findVersion(xml) {
  VERSION_RE.lastIndex = 0;
  const m = VERSION_RE.exec(xml);
  VERSION_RE.lastIndex = 0;
  return m ? parseInt(m[2], 10) : null;
}

// Parse the upload into { xml, version } or throw a message-bearing error.
function parseUpload(buf) {
  let xml;
  try { xml = readProjectXml(buf); }
  catch (e) { throw new Error('файлът не се разархивира — валиден .prproj файл ли е?'); }
  const version = findVersion(xml);
  if (version === null) throw new Error('в XML-а няма версия на проект — това .prproj файл ли е?');
  return { xml, version };
}

// POST /api/premiere/inspect — report the project's schema version and which
// conversion path applies, so the UI can say the right thing up front.
router.post('/inspect', requireAuth, upload.single('project'), (req, res) => {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ error: 'няма качен файл (поле "project")' });
  }
  let parsed;
  try { parsed = parseUpload(req.file.buffer); }
  catch (e) { return res.status(422).json({ error: e.message }); }

  const needsEngine = parsed.version >= STRUCTURED_SCHEMA;
  res.json({
    version: parsed.version,
    needsEngine,
    engineMaxBytes: ENGINE_MAX_BYTES,
    // true when this file cannot be converted at all right now
    tooBigForEngine: needsEngine && req.file.buffer.length > ENGINE_MAX_BYTES,
  });
});

// POST /api/premiere/convert — body: target=<year>. Returns { ok, name, data(base64), logs[] }.
router.post('/convert', requireAuth, upload.single('project'), async (req, res) => {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ error: 'няма качен файл (поле "project")' });
  }
  const target = parseInt(String((req.body && req.body.target) || '').trim(), 10);
  const targetVersion = YEAR_TO_VERSION[target];
  if (!targetVersion) return res.status(400).json({ error: 'невалидна целева версия' });

  const buf = req.file.buffer;
  const name = String(req.file.originalname || 'project.prproj');
  const outName = name.replace(/\.prproj$/i, '') + '_PP' + target + '.prproj';

  let parsed;
  try { parsed = parseUpload(buf); }
  catch (e) { return res.status(422).json({ error: e.message }); }

  // ---- PP2026+ source: structure changed, needs the schema engine ----
  if (parsed.version >= STRUCTURED_SCHEMA) {
    if (buf.length > ENGINE_MAX_BYTES) {
      return res.status(413).json({
        error: 'Проектът е от Premiere 2026, а такъв файл се преработва само през външния енджин, '
          + 'който е безплатен до ' + Math.round(ENGINE_MAX_BYTES / 1024) + ' KB (този е '
          + Math.round(buf.length / 1024) + ' KB). Проекти от 2025 и по-стари се свалят при нас без ограничение за размер.',
      });
    }
    return convertViaEngine(res, buf, name, target, outName);
  }

  // ---- PP2025 and older: plain version rewrite, done locally, any size ----
  if (targetVersion >= parsed.version) {
    return res.status(400).json({
      error: 'Проектът вече е версия ' + parsed.version + ' — Premiere ' + target + ' го отваря без преработка.',
    });
  }

  let out;
  try {
    VERSION_RE.lastIndex = 0;
    const newXml = parsed.xml.replace(VERSION_RE, '$1' + targetVersion + '$3');
    out = isGzip(buf) ? zlib.gzipSync(Buffer.from(newXml, 'utf8')) : Buffer.from(newXml, 'utf8');
  } catch (e) {
    return res.status(500).json({ error: 'записът се провали: ' + e.message });
  }

  res.json({
    ok: true,
    name: outName,
    data: out.toString('base64'),
    logs: [
      { t: 'info', m: 'Схема на проекта: v' + parsed.version + ' → цел Premiere ' + target + ' (v' + targetVersion + ')' },
      { t: 'ok', m: 'Свалено на място, без външен енджин и без ограничение за размер' },
      { t: 'info', m: 'Монтажът и секвенциите се пренасят 1:1; ефекти, въведени след Premiere ' + target + ', може да липсват' },
    ],
  });
});

// Proxy a PP2026 project to the schema engine.
async function convertViaEngine(res, buf, name, target, fallbackName) {
  const deviceId = 'pact_' + crypto.randomBytes(6).toString('hex');
  let r, j;
  try {
    r = await fetch(ENGINE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-target-version': String(target),
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
  const logs = Array.isArray(j.logs) ? j.logs.slice() : [];
  logs.unshift({ t: 'info', m: 'Проектът е от Premiere 2026 — преработен през схема-енджин (само смяна на номера чупи файла)' });
  res.json({ ok: true, name: j.name || fallbackName, data: j.data, logs });
}

// Multer errors (file too large, etc.)
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'файлът е твърде голям (макс ' + Math.round(MAX_BYTES / 1024 / 1024) + 'MB)' });
  }
  next(err);
});

module.exports = router;
