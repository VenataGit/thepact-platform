// Контент стратегия агент — старт: довършва прекъснатите пускания и на 15 мин засича
// новите клиентски проекти в Basecamp (от bc_projects) като „чакащи стратегия".
const cron = require('node-cron');
const store = require('./store');
const pipeline = require('./pipeline');

function initStrategyAgent() {
  try {
    pipeline.resumeAfterRestart().catch((e) => console.warn('[strategy-agent] resume:', e.message));
    const detect = () => store.detectProjects().catch((e) => console.warn('[strategy-agent] засичане:', e.message));
    setTimeout(detect, 60_000); // след първия синхрон на bc_projects
    cron.schedule('7,22,37,52 * * * *', detect, { timezone: 'Europe/Sofia' });
    console.log('  Strategy Agent: active (new projects every 15 min)');
  } catch (e) {
    console.log('  Strategy Agent: skipped —', e.message);
  }
}

module.exports = { initStrategyAgent };
