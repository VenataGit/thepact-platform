// ThePact Platform — Express app (extracted for testability)
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const config = require('./config');
const { getConnectedCount } = require('./ws/broadcast');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// Gzip/Brotli compression — reduces ~551 KB transfer to ~150 KB
app.use(compression());

// Trust proxy (Nginx)
if (config.IS_PRODUCTION) app.set('trust proxy', 1);

// HTTPS redirect in production
if (config.IS_PRODUCTION) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.hostname}${req.url}`);
    }
    next();
  });
}

// Security
// CSP: скриптове само от нас + Trix (unpkg). 'unsafe-inline' остава, защото интерфейсът
// е изграден с inline onclick; основната защита срещу XSS е екранирането/чистенето на HTML.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'blob:', 'https:'],
      connectSrc: ["'self'", 'wss:', 'https://unpkg.com'],
      frameSrc: ["'self'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
}));

// 5xx отговори: вътрешните детайли (SQL, пътища, мрежови грешки) не стигат до браузъра —
// пишат се в лога, а клиентът получава общо съобщение. Нормалните съобщения остават.
const INTERNAL_ERR = /relation |column |syntax error|violates|duplicate key|null value|invalid input syntax|ECONN|ETIMEDOUT|ENOTFOUND|EADDR|ENOENT|EACCES|[\\/](opt|home|root|usr|var)[\\/]|node_modules|\bat [\w.<>]+ \(|pg_|password|secret/i;
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500 && res.statusCode !== 503) {
      try { require('./services/system-watch').recordError('http' + res.statusCode, `${req.method} ${req.path}: ${body && body.error}`); } catch { /* */ }
    }
    if (res.statusCode >= 500 && body && typeof body.error === 'string' && INTERNAL_ERR.test(body.error)) {
      console.error('[5xx]', req.method, req.originalUrl, body.error);
      body = { ...body, error: 'Вътрешна грешка на сървъра' };
      delete body.stack; delete body.output; delete body.tried;
    }
    return json(body);
  };
  next();
});

// Body parsing
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate limiting — only on login attempts (brute-force protection)
// GET /auth/status is called on every page load, so we only limit POST /auth/login
if (process.env.NODE_ENV !== 'test') {
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many login attempts. Try again in 15 minutes.' } });
  app.post('/auth/login', loginLimiter);
}

// Static files with smart caching
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      // HTML: always revalidate (ensures fresh app shell)
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      // JS/CSS: cache 1 hour, revalidate after (ETag handles freshness)
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    } else if (filePath.endsWith('.svg') || filePath.endsWith('.png') || filePath.endsWith('.jpg')) {
      // Images: cache 7 days
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  }
}));

// Health check (no auth)
app.get('/api/health', async (req, res) => {
  const { pool } = require('./db/pool');
  let dbOk = false;
  try { await pool.query('SELECT 1'); dbOk = true; } catch (e) { console.warn('[health] db check failed:', e.message); }
  const healthy = dbOk;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks: { server: true, database: dbOk },
    uptime: process.uptime(),
    wsClients: getConnectedCount(),
    eventLoopP99Ms: require('./services/system-watch').status().eventLoopP99Ms,
  });
});

// Serve uploaded files (avatars, attachments, vault).
// Hardened: nosniff prevents MIME confusion attacks; HTML/SVG/scripts are forced
// to download as text/plain so they cannot execute as XSS even if an attacker
// somehow uploaded one before the new whitelist was in place.
const DANGEROUS_UPLOAD_EXTS = new Set([
  '.html', '.htm', '.xhtml', '.svg',
  '.js', '.mjs', '.php', '.phtml', '.jsp', '.asp', '.aspx',
  '.sh', '.bat', '.cmd', '.exe', '.com', '.dll', '.scr', '.ps1',
]);
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), {
  etag: true,
  fallthrough: false,
  index: false,           // never serve directory listings
  dotfiles: 'deny',       // 403 on hidden files
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox;");
    const ext = path.extname(filePath).toLowerCase();
    if (DANGEROUS_UPLOAD_EXTS.has(ext)) {
      // Strip MIME, force download, never render in browser
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment');
    }
  }
}));

// Deploy endpoint (no auth needed, uses secret)
// Тайната САМО в хедър X-Deploy-Secret (в ?secret= оставаше в логовете на Nginx); без execSync,
// за да не замръзва сървърът. Нормалният deploy е cron-ът на VPS-а — този адрес е резервен.
const { keyMatches } = require('./middleware/machine-key');
const deployAuth = (req) => keyMatches(req.get('x-deploy-secret'), config.DEPLOY_SECRET);
const runCmd = (cmd, args, opts) => new Promise((resolve, reject) => {
  require('child_process').execFile(cmd, args, opts, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout })) : resolve(String(stdout))));
});
app.post('/deploy', async (req, res) => {
  if (!deployAuth(req)) return res.status(403).json({ error: 'Invalid secret' });
  try {
    const gitOut = await runCmd('git', ['pull', 'origin', 'main', '--ff-only'], { cwd: path.join(__dirname, '..'), timeout: 30000 });
    res.json({ ok: true, git: gitOut.trim(), pm2: 'restarting' });
    setTimeout(() => require('child_process').execFile('pm2', ['restart', 'thepact-v2'], () => {}), 500);
  } catch (err) {
    console.error('[deploy]', err.message);
    res.status(500).json({ error: 'deploy failed' });
  }
});

// Run migrations endpoint (uses deploy secret)
app.post('/migrate', async (req, res) => {
  if (!deployAuth(req)) return res.status(403).json({ error: 'Invalid secret' });
  try {
    const out = await runCmd(process.execPath, ['scripts/run-new-migrations.js'], { cwd: path.join(__dirname, '..'), timeout: 60000, env: { ...process.env, DATABASE_URL: config.DATABASE_URL } });
    res.json({ ok: true, output: out.trim() });
  } catch (err) {
    console.error('[migrate]', err.message);
    res.status(500).json({ error: 'migrate failed', output: String(err.stdout || '') });
  }
});

// Routes — Core
app.use('/auth', require('./routes/auth'));
app.use('/auth', require('./routes/basecamp-auth'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/boards', require('./routes/boards'));
app.use('/api/cards', require('./routes/cards'));
app.use('/api/users', require('./routes/users'));
app.use('/api/cards', require('./routes/comments'));
app.use('/api/cards', require('./routes/attachments'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/history', require('./routes/history'));
app.use('/api/search', require('./routes/search'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/messageboard', require('./routes/messageboard'));
app.use('/api/vault', require('./routes/vault'));
app.use('/api/settings', require('./routes/admin'));
// Routes — Phase 2+
app.use('/api/campfire', require('./routes/campfire'));
app.use('/api/schedule', require('./routes/schedule'));
app.use('/api/checkins', require('./routes/checkins'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/bookmarks', require('./routes/bookmarks'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/timers', require('./routes/timers'));
app.use('/api/kp', require('./routes/kp'));
app.use('/api/sos', require('./routes/sos'));
app.use('/api/production-calendar', require('./routes/production-calendar'));
app.use('/api/bc-board', require('./routes/bc-board'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/client-report', require('./routes/client-report'));
app.use('/api/task-completions', require('./routes/task-completions'));
app.use('/api/overtime', require('./routes/overtime'));
app.use('/api/bc-calendar', require('./routes/bc-calendar'));
app.use('/api/kp-split', require('./routes/kp-split'));
app.use('/api/task-creator', require('./routes/task-creator'));
app.use('/api/gcal-alerts', require('./routes/gcal-alerts'));
app.use('/api/kp-results', require('./routes/kp-results'));
app.use('/api/sheet-alerts', require('./routes/sheet-alerts'));
app.use('/webhooks', require('./routes/webhooks'));
app.use('/go', require('./routes/go'));
app.use('/api/folder-queue', require('./routes/folder-queue'));
app.use('/api/ai-queue', require('./routes/ai-queue'));
app.use('/api/trash', require('./routes/trash'));
app.use('/api/push', require('./routes/push'));
app.use('/api/positions', require('./routes/positions'));
app.use('/api/team', require('./routes/team'));
app.use('/api/transcribe', require('./routes/transcribe'));
app.use('/api/premiere', require('./routes/premiere'));
app.use('/api/agent', require('./routes/agent'));
app.use('/api/extension', require('./routes/extension-tokens'));
app.use('/api/time', require('./routes/time'));
app.use('/api/crm', require('./routes/crm'));
app.use('/api/content-agent', require('./routes/content-agent'));
app.use('/api/dev-queue', require('./routes/dev-queue'));
app.use('/api/dev-chat', require('./routes/dev-chat'));
app.use('/api/backup', require('./routes/backup'));
// Online users endpoint
app.get('/api/users/online', require('./middleware/auth').requireAuth, (req, res) => {
  const { getOnlineUserIds } = require('./ws/broadcast');
  res.json(getOnlineUserIds());
});

// Serve login page if not authenticated (check for JWT cookie)
app.get('/', (req, res) => {
  // Без бисквитка → index.html (той сам праща към входа); с невалидна/изтекла сесия → login.
  const { verifyFromCookieHeader } = require('./middleware/auth');
  const valid = !req.cookies?.__pact_jwt || !!verifyFromCookieHeader(req.headers.cookie);
  res.sendFile(path.join(__dirname, '..', 'public', valid ? 'index.html' : 'login.html'));
});

// Serve presentation page (standalone, no SPA wrapper)
app.get('/present/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'present.html'));
});

// Serve card history page (standalone)
app.get('/card-history/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'card-history.html'));
});

// Catch-all: serve index.html for SPA routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handler
app.use(errorHandler);

module.exports = app;
