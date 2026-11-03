#!/usr/bin/env node
// Сигнал от deploy скрипта на VPS-а към Венци (чатът „Сигнал за неработеща система").
//   node scripts/system-signal.js deploy-failed "детайли"   — тестовете спряха качване
//   node scripts/system-signal.js deploy-ok                  — пак минава (праща само ако е имало проблем)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const sw = require('../src/services/system-watch');

const [kind, detail] = process.argv.slice(2);
(async () => {
  if (kind === 'deploy-failed') await sw.deploySignal(false, detail);
  else if (kind === 'deploy-ok') await sw.deploySignal(true);
  else throw new Error('непознат сигнал: ' + kind);
  process.exit(0);
})().catch((e) => { console.error('[system-signal]', e.message); process.exit(1); });
