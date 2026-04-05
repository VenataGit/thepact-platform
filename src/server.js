// ThePact Platform — server entry point
const http = require('http');
const path = require('path');
const config = require('./config');
const app = require('./app');
const { setupWebSocket } = require('./ws/broadcast');
const { trackError } = require('./middleware/errorHandler');

const server = http.createServer(app);

// Auto-run pending DB migrations on startup
(async () => {
  try {
    const { execSync } = require('child_process');
    const out = execSync('node scripts/run-new-migrations.js', {
      cwd: path.join(__dirname, '..'),
      timeout: 30000,
      env: { ...process.env }
    }).toString();
    if (!out.includes('Nothing to do')) console.log('[startup] migrations:', out.trim());
  } catch (err) {
    console.error('[startup] migration warning:', err.stderr?.toString() || err.message);
  }
})();

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

// Init services (non-blocking, safe to fail if tables don't exist yet)
const { initCheckInScheduler } = require('./services/checkin-scheduler');
const { initEmail } = require('./services/email');
const { initDailyReport } = require('./services/daily-report');
setTimeout(() => {
  initCheckInScheduler();
  initEmail();
  initDailyReport();
}, 2000);

// Auto-cleanup: permanently delete cards that have been in trash for 30+ days
async function purgeOldTrash() {
  try {
    const { execute } = require('./db/pool');
    await execute(`DELETE FROM cards WHERE trashed_at IS NOT NULL AND trashed_at < NOW() - INTERVAL '30 days'`);
  } catch (err) {
    console.error('[trash] purge error:', err.message);
  }
}
setTimeout(purgeOldTrash, 5000); // run shortly after startup
setInterval(purgeOldTrash, 60 * 60 * 1000); // then every hour
