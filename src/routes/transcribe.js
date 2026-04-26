// Audio transcription proxy → forwards to local whisper-service (faster-whisper).
// The Python service binds to 127.0.0.1:5001 and is managed by PM2.
const express = require('express');
const multer = require('multer');
const http = require('http');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const WHISPER_HOST = process.env.WHISPER_HOST || '127.0.0.1';
const WHISPER_PORT = parseInt(process.env.WHISPER_PORT || '5001', 10);
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB hard cap (≈ 25 min webm/opus)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1 }
});

router.get('/health', requireAuth, (req, res) => {
  const req2 = http.get({ host: WHISPER_HOST, port: WHISPER_PORT, path: '/health', timeout: 3000 }, (resp) => {
    let body = '';
    resp.on('data', (c) => body += c);
    resp.on('end', () => {
      try { res.status(resp.statusCode || 200).json(JSON.parse(body)); }
      catch { res.status(502).json({ error: 'whisper-service returned non-JSON' }); }
    });
  });
  req2.on('timeout', () => { req2.destroy(); res.status(504).json({ error: 'whisper-service timeout' }); });
  req2.on('error', (e) => res.status(503).json({ error: 'whisper-service unreachable', detail: e.code || e.message }));
});

router.post('/', requireAuth, upload.single('audio'), (req, res) => {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ error: 'no audio uploaded (field name must be "audio")' });
  }
  const buf = req.file.buffer;
  // Derive extension from MIME or original filename — whisper service uses it for ffmpeg hint
  let ext = 'webm';
  const mt = (req.file.mimetype || '').toLowerCase();
  if (mt.includes('ogg')) ext = 'ogg';
  else if (mt.includes('mp4') || mt.includes('m4a')) ext = 'm4a';
  else if (mt.includes('wav')) ext = 'wav';
  else if (mt.includes('mpeg') || mt.includes('mp3')) ext = 'mp3';

  const proxyReq = http.request({
    host: WHISPER_HOST,
    port: WHISPER_PORT,
    path: '/transcribe',
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': buf.length,
      'X-Audio-Ext': ext
    },
    timeout: 300_000 // 5 min — small model on 2 cpu cores can be slow on long audio
  }, (resp) => {
    let body = '';
    resp.setEncoding('utf8');
    resp.on('data', (c) => body += c);
    resp.on('end', () => {
      res.status(resp.statusCode || 200);
      res.type('application/json');
      res.send(body);
    });
  });
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).json({ error: 'transcription timeout' });
  });
  proxyReq.on('error', (e) => {
    if (!res.headersSent) res.status(503).json({ error: 'whisper-service unreachable', detail: e.code || e.message });
  });
  proxyReq.write(buf);
  proxyReq.end();
});

// Multer error handler (file too large, etc.)
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `audio too large (max ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)}MB)` });
  }
  next(err);
});

module.exports = router;
