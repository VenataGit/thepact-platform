// ThePact Platform — server entry point
const http = require('http');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { setupWebSocket, getConnectedCount } = require('./ws/broadcast');
const { errorHandler, trackError } = require('./middleware/errorHandler');

const app = express();
const server = http.createServer(app);

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
app.use(helmet({ contentSecurityPolicy: false }));

// Body parsing
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate limiting
app.use('/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Too many requests' } }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 300, message: { error: 'Too many requests' } }));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// Health check (no auth)
app.get('/api/health', async (req, res) => {
  const { pool } = require('./db/pool');
  let dbOk = false;
  try { await pool.query('SELECT 1'); dbOk = true; } catch {}
  const healthy = dbOk;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks: { server: true, database: dbOk },
    uptime: process.uptime(),
    wsClients: getConnectedCount()
  });
});

// Serve uploaded files (avatars, etc.)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Deploy endpoint (no auth needed, uses secret)
app.post('/deploy', (req, res) => {
  const secret = req.query.secret || req.body?.secret;
  if (!config.DEPLOY_SECRET || secret !== config.DEPLOY_SECRET) {
    return res.status(403).json({ error: 'Invalid secret' });
  }
  const { execSync } = require('child_process');
  try {
    const gitOut = execSync('git pull origin main --ff-only', { cwd: path.join(__dirname, '..'), timeout: 30000 }).toString();
    const pm2Out = execSync('pm2 restart thepact-v2', { timeout: 15000 }).toString();
    res.json({ ok: true, git: gitOut.trim(), pm2: pm2Out.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/boards', require('./routes/boards'));
app.use('/api/cards', require('./routes/cards'));
app.use('/api/users', require('./routes/users'));

// Serve login page if not authenticated (check for JWT cookie)
app.get('/', (req, res) => {
  const jwt = require('jsonwebtoken');
  const token = req.cookies?.__pact_jwt;
  try {
    if (token) jwt.verify(token, config.JWT_SECRET);
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  } catch {
    res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
  }
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

// Uncaught errors
process.on('uncaughtException', (err) => { trackError('uncaughtException', err); });
process.on('unhandledRejection', (reason) => { trackError('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason))); });

// Start
server.listen(config.PORT, () => {
  console.log(`\n  ThePact Platform running at http://localhost:${config.PORT}`);
  console.log(`  Environment: ${config.IS_PRODUCTION ? 'PRODUCTION' : 'development'}`);
  console.log(`  Database: ${config.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}\n`);
});

// WebSocket
setupWebSocket(server);
