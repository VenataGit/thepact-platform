// Content агент — таблици и настройки.
//
// Таблиците се създават от кода при първа нужда (CREATE IF NOT EXISTS, само създаване),
// защото не разчитаме, че миграцията е минала на прода. Описание: db/migrations/059_content_agent.sql.
const fs = require('fs');
const path = require('path');
const { query, queryOne, execute } = require('../../db/pool');

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    const dir = path.join(__dirname, '..', '..', '..', 'db', 'migrations');
    const sql = ['059_content_agent.sql', '060_content_agent_history.sql']
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    schemaReady = execute(sql).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

// ---------- настройки ----------
// Ключовете с „token"/„api_key" не се връщат на не-админи от /api/settings (routes/admin.js).
const SETTING_KEYS = [
  'ca_enabled',          // следене на таговете в Basecamp (default вкл.)
  'ca_auto_on_kp',       // автоматично пускане при нов КП (default изкл. до теста)
  'ca_apify_token',      // Apify — TikTok / Instagram / Facebook
  'ca_youtube_api_key',  // YouTube Data API v3
  'ca_actor_tiktok', 'ca_actor_instagram', 'ca_actor_facebook',
  'ca_last_comment_at',  // курсор на следенето на коментари
  'ca_bot_sgid',         // attachable_sgid на ThePactAlerts (за разпознаване на тага)
  'ca_hidden_clients',   // JSON масив с id-та на скритите клиенти (крие ги админ)
];

const DEFAULT_ACTORS = {
  tiktok: 'clockworks~tiktok-scraper',
  instagram: 'apify~instagram-reel-scraper',
  facebook: 'apify~facebook-reels-scraper',
};

function parseIds(v) {
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.map(Number).filter(Boolean) : []; } catch { return []; }
}

async function loadSettings() {
  const rows = await query('SELECT key, value FROM settings WHERE key = ANY($1::text[])', [SETTING_KEYS]);
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    enabled: s.ca_enabled !== 'false',
    autoOnKp: s.ca_auto_on_kp === 'true',
    apifyToken: s.ca_apify_token || '',
    youtubeKey: s.ca_youtube_api_key || '',
    actors: {
      tiktok: s.ca_actor_tiktok || DEFAULT_ACTORS.tiktok,
      instagram: s.ca_actor_instagram || DEFAULT_ACTORS.instagram,
      facebook: s.ca_actor_facebook || DEFAULT_ACTORS.facebook,
    },
    lastCommentAt: s.ca_last_comment_at || null,
    hiddenClients: parseIds(s.ca_hidden_clients),
    botSgid: s.ca_bot_sgid || '',
  };
}

function saveSetting(key, value) {
  return execute(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, String(value)]
  );
}

// ---------- клиенти ----------

async function getClient(id) {
  return queryOne('SELECT id, name, videos_per_month, current_kp_number, bc_project_id, is_active FROM kp_clients WHERE id = $1', [id]);
}

// ---------- дублирани клиенти ----------
// В КП-Автоматизация един и същ клиент понякога е въведен два пъти (през юли 2026
// клиентите са създадени наново, старите редове от април останаха). За агента един
// клиент = едно име: от редовете с еднакво име „настоящ" е този, който не е скрит,
// свързан е с Basecamp проект, има най-висок КП, най-късна дата за следващ КП, най-нов.
// Останалите са дубликати: не се показват, а всичко, въведено в тях, се мести в
// настоящия (само смяна на client_id — нищо не се трие).
function nameKey(name) {
  return String(name || '').toLowerCase().replace(/[„“"'']/g, '').replace(/[^a-zа-я0-9]+/gi, ' ').trim();
}

async function clientGroups() {
  const [rows, cfg] = await Promise.all([
    query('SELECT id, name, bc_project_id, current_kp_number, next_kp_date, is_active FROM kp_clients'),
    loadSettings(),
  ]);
  const hidden = new Set(cfg.hiddenClients);
  const groups = {};
  for (const r of rows) {
    const k = nameKey(r.name);
    if (k) (groups[k] = groups[k] || []).push(r);
  }
  const canonicalOf = {};   // id → id на настоящия
  const duplicates = [];    // [{ name, canonical, others: [{id, kp}] }]
  for (const list of Object.values(groups)) {
    list.sort((a, b) =>
      ((hidden.has(a.id) ? 1 : 0) - (hidden.has(b.id) ? 1 : 0)) ||
      ((a.is_active === false ? 1 : 0) - (b.is_active === false ? 1 : 0)) ||
      ((b.bc_project_id ? 1 : 0) - (a.bc_project_id ? 1 : 0)) ||
      ((Number(b.current_kp_number) || 0) - (Number(a.current_kp_number) || 0)) ||
      (new Date(b.next_kp_date || 0) - new Date(a.next_kp_date || 0)) ||
      (b.id - a.id));
    const main = list[0];
    for (const r of list) canonicalOf[r.id] = main.id;
    if (list.length > 1) {
      duplicates.push({
        name: main.name, canonical: { id: main.id, kp: main.current_kp_number },
        others: list.slice(1).map((r) => ({ id: r.id, kp: r.current_kp_number })),
      });
    }
  }
  return { canonicalOf, duplicates };
}

/** Мести паметта/профилите/видеата/пусканията от дубликатите в настоящия клиент. */
async function mergeDuplicates(groups) {
  await ensureSchema();
  const g = groups || await clientGroups();
  let moved = 0;
  for (const d of g.duplicates) {
    for (const o of d.others) {
      for (const t of ['ca_memory', 'ca_profiles', 'ca_videos', 'ca_runs']) {
        const r = await query(`UPDATE ${t} SET client_id = $1 WHERE client_id = $2 RETURNING 1`, [d.canonical.id, o.id]);
        moved += r.length;
      }
    }
  }
  if (moved) console.log(`[content-agent] дубликати: преместени ${moved} записа в настоящите клиенти`);
  return { ...g, moved };
}

// ---------- паметта като текст за агентите ----------

const KIND_LABELS = {
  profile: 'Профил на клиента (бизнес, продукти, аудитория, цели)',
  like: 'Клиентът ХАРЕСВА',
  dislike: 'Клиентът НЕ ХАРЕСВА',
  rule: 'Правила и забрани (задължителни)',
  voice: 'Как говори клиентът (образци от гласа му)',
  past_video: 'Минали видеа (какво вече сме правили и как се е представило)',
  note: 'Други бележки',
};
const KINDS = Object.keys(KIND_LABELS);

async function memoryText(clientId) {
  await ensureSchema();
  const rows = await query(
    `SELECT kind, text, source, created_at FROM ca_memory
      WHERE client_id = $1 AND status = 'approved' ORDER BY kind, created_at DESC`,
    [clientId]
  );
  if (!rows.length) return '(паметта за този клиент е празна)';
  const parts = [];
  for (const k of KINDS) {
    const items = rows.filter((r) => r.kind === k);
    if (!items.length) continue;
    parts.push(`### ${KIND_LABELS[k]}`);
    // По-новото е по-важно — затова датата стои до всяко нещо.
    for (const r of items.slice(0, 80)) {
      const d = new Date(r.created_at).toISOString().slice(0, 10);
      parts.push(`- (${d}) ${String(r.text).slice(0, 2500)}`);
    }
  }
  return parts.join('\n');
}

async function profilesText(clientId) {
  await ensureSchema();
  const rows = await query('SELECT platform, url, handle, label, role FROM ca_profiles WHERE client_id = $1 AND active = TRUE', [clientId]);
  if (!rows.length) return '(няма въведени профили)';
  const roleBg = { own: 'собствен', competitor: 'конкурент', inspiration: 'вдъхновение' };
  return rows.map((r) => `- ${r.platform} · ${roleBg[r.role] || r.role} · ${r.label || r.handle || ''} ${r.url || ''}`.trim()).join('\n');
}

// Последните заглавия, които сме предлагали — за да не се повтаряме.
async function recentIdeaTitles(clientId, limit = 60) {
  await ensureSchema();
  const rows = await query(
    `SELECT result FROM ca_runs WHERE client_id = $1 AND status = 'done' AND result IS NOT NULL
      ORDER BY created_at DESC LIMIT 10`,
    [clientId]
  );
  const out = [];
  for (const r of rows) {
    for (const s of ((r.result && r.result.scripts) || [])) {
      if (s && s.title) out.push(s.title);
    }
  }
  return out.slice(0, limit);
}

module.exports = {
  ensureSchema, loadSettings, saveSetting, getClient, clientGroups, mergeDuplicates, nameKey,
  memoryText, profilesText, recentIdeaTitles,
  KIND_LABELS, KINDS, DEFAULT_ACTORS, SETTING_KEYS,
};
