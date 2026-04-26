// Audio transcription proxy → forwards to local whisper-service (faster-whisper).
// The Python service binds to 127.0.0.1:5001 and is managed by PM2.
// Also exposes /summary which restructures dictated text via Claude API.
const express = require('express');
const multer = require('multer');
const http = require('http');
const https = require('https');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const WHISPER_HOST = process.env.WHISPER_HOST || '127.0.0.1';
const WHISPER_PORT = parseInt(process.env.WHISPER_PORT || '5001', 10);
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB hard cap (≈ 25 min webm/opus)
const MAX_SUMMARY_CHARS = 50_000; // ~12k tokens input cap, generous but bounded
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

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

// ==================== AI Summary (Claude API) ====================
// Restructures dictated text into a readable, well-formatted version.
// Body: { text: string }
// Returns: { text, model, input_tokens, output_tokens }
router.post('/summary', requireAuth, express.json({ limit: '1mb' }), (req, res) => {
  if (!config.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Claude API ключ не е конфигуриран (ANTHROPIC_API_KEY в .env).' });
  }
  const text = (req.body && typeof req.body.text === 'string') ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'липсва текст' });
  if (text.length > MAX_SUMMARY_CHARS) {
    return res.status(413).json({ error: `текстът е твърде дълъг (макс ${MAX_SUMMARY_CHARS} символа)` });
  }

  const systemPrompt = [
    'Ти си редактор на български. Получаваш суров текст от диктовка (Whisper STT), който често е без структура — едно дълго изречение, повторения, "ъ-ъ" моменти, разпокъсани мисли.',
    '',
    'Твоята задача:',
    '• Преподреди мислите логично, в добре структуриран и четим вид.',
    '• Раздели на параграфи. Където има отделни теми — добави подзаглавия (Markdown ##).',
    '• Ако има списъчни неща — направи bullet list (-).',
    '• Ако има задачи/стъпки — направи numbered list (1. 2. 3.).',
    '• Поправи граматика, пунктуация и очевидни Whisper грешки в думи.',
    '• Запази оригиналния смисъл и тон. Не добавяй информация, която я няма в текста.',
    '• Не съкращавай агресивно — целта е по-четим текст, не резюме.',
    '',
    'Формат на отговора: само подреденият текст в Markdown. Без увод тип "Ето подредената версия:". Без обяснения.'
  ].join('\n');

  const payload = JSON.stringify({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: text }]
  });

  const apiReq = https.request({
    host: 'api.anthropic.com',
    port: 443,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'x-api-key': config.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    timeout: 120_000
  }, (apiResp) => {
    let body = '';
    apiResp.setEncoding('utf8');
    apiResp.on('data', (c) => body += c);
    apiResp.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch { return res.status(502).json({ error: 'Claude API върна невалиден JSON', raw: body.slice(0, 200) }); }
      if (apiResp.statusCode !== 200) {
        const apiErr = parsed.error || {};
        return res.status(apiResp.statusCode || 500).json({
          error: apiErr.message || 'Claude API грешка',
          type: apiErr.type
        });
      }
      const out = (parsed.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      res.json({
        text: out,
        model: parsed.model || CLAUDE_MODEL,
        input_tokens: parsed.usage?.input_tokens,
        output_tokens: parsed.usage?.output_tokens
      });
    });
  });
  apiReq.on('timeout', () => {
    apiReq.destroy();
    if (!res.headersSent) res.status(504).json({ error: 'Claude API timeout' });
  });
  apiReq.on('error', (e) => {
    if (!res.headersSent) res.status(503).json({ error: 'Claude API недостъпен', detail: e.code || e.message });
  });
  apiReq.write(payload);
  apiReq.end();
});

// Multer error handler (file too large, etc.)
router.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `audio too large (max ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)}MB)` });
  }
  next(err);
});

module.exports = router;
