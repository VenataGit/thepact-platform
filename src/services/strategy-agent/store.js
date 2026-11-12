// Контент стратегия агент — таблиците, засичането на нови клиенти и чистите помощни
// функции (име на клиента, пакет от името на проекта, папката в „Клиентски карти").
//
// Засичане (Венци, 12.11.2026): „когато види, че има нов проект в Basecamp, да го добавя
// автоматично като чакащ клиент, който няма готова стратегия". Проектите идват от
// bc_projects (PM агентът ги синхронизира на 15 мин). Първото обхождане само записва
// съществуващите (is_new = false) — новите след това излизат най-отгоре като „нов".
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { query, queryOne, execute } = require('../../db/pool');

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'db', 'migrations', '067_strategy_agent.sql'), 'utf8');
    schemaReady = execute(sql).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

// ---------- чисти функции ----------

function normName(s) {
  return String(s || '').toLowerCase()
    .replace(/[„“”"'’]/g, '')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim();
}

/** „Altea Residence - SMM10 + Performance" → „Altea Residence"; „MOE | Gameloft - SMM" → „MOE". */
function clientNameFromProject(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  const first = n.split(/\s+[-–—|]\s+|\s*\|\s*/)[0].trim();
  // „Pulse Therme SMM 10 + Performance" (без разделител) → без пакета отзад.
  const bare = first.replace(/\s+(SMM|Static|Performance)\b.*$/i, '').trim();
  if (bare) return bare;
  return first || n;
}

/** Пакетът от името на проекта: „Rosberg - SMM 9 + Static 2" → { videos: 9, statics: 2, performance: false }. */
function planFromProject(name) {
  const n = String(name || '');
  const v = n.match(/SMM\s*(\d+)/i);
  const s = n.match(/Static\s*(\d+)/i);
  return {
    videos: v ? Number(v[1]) : null,
    statics: s ? Number(s[1]) : null,
    performance: /performance/i.test(n),
    consulting: /consult/i.test(n),
  };
}

/**
 * Папката на клиента в „Клиентски карти". Точно съвпадение по име → папка, чието име
 * се съдържа в името на клиента/проекта (най-дългото, за да не хване „Pulse" вместо
 * „Pulse Gym Shop"). Връща папката или null.
 */
function findClientFolder(folders, clientName, projectName) {
  const list = (folders || []).filter((f) => f && normName(f.title));
  const c = normName(clientName);
  const exact = list.find((f) => normName(f.title) === c);
  if (exact) return exact;
  const hay = ` ${c} ${normName(projectName)} `;
  const hits = list.filter((f) => hay.includes(` ${normName(f.title)} `))
    .sort((a, b) => normName(b.title).length - normName(a.title).length);
  return hits[0] || null;
}

/** Клиентът от КП-Автоматизация (kp_clients) за този проект — по запомнения проект или по име. */
function matchKpClient(rows, projectId, clientName) {
  const list = rows || [];
  const byProject = list.find((r) => r.bc_project_id && String(r.bc_project_id) === String(projectId));
  if (byProject) return byProject;
  const c = normName(clientName);
  if (!c) return null;
  const hits = list.filter((r) => normName(r.name) === c);
  if (!hits.length) return null;
  return hits.find((r) => r.is_active) || hits[0];
}

// ---------- засичане ----------

async function detectProjects() {
  await ensureSchema();
  const teamId = String(config.BASECAMP_TEAM_PROJECT_ID);
  const projects = (await query(
    'SELECT project_id, name FROM bc_projects WHERE active = TRUE AND clients_enabled = TRUE'
  )).filter((p) => String(p.project_id) !== teamId);
  if (!projects.length) return { added: 0 };

  const baseline = await queryOne("SELECT value FROM settings WHERE key = 'cs_baseline_done'");
  const isNew = !!(baseline && baseline.value === 'true');
  let added = 0;
  for (const p of projects) {
    const row = await queryOne(
      `INSERT INTO cs_projects (project_id, name, is_new) VALUES ($1, $2, $3)
       ON CONFLICT (project_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING (xmax = 0) AS inserted`,
      [p.project_id, String(p.name || '').trim(), isNew]
    );
    if (row && row.inserted) added += 1;
  }
  if (!isNew) {
    await execute(
      `INSERT INTO settings (key, value) VALUES ('cs_baseline_done', 'true')
       ON CONFLICT (key) DO UPDATE SET value = 'true'`
    );
  }
  if (added && isNew) console.log(`[strategy-agent] ${added} нов(и) клиентски проект(а) — чакат стратегия`);
  return { added };
}

async function getProject(projectId) {
  await ensureSchema();
  const p = await queryOne('SELECT * FROM cs_projects WHERE project_id = $1', [projectId]);
  if (!p) return null;
  return { ...p, client: p.client_name || clientNameFromProject(p.name) };
}

module.exports = {
  ensureSchema, detectProjects, getProject,
  normName, clientNameFromProject, planFromProject, findClientFolder, matchKpClient,
};
