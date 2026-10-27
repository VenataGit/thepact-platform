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
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'db', 'migrations', '059_content_agent.sql'), 'utf8');
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
];

const DEFAULT_ACTORS = {
  tiktok: 'clockworks~tiktok-scraper',
  instagram: 'apify~instagram-reel-scraper',
  facebook: 'apify~facebook-reels-scraper',
};

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
  ensureSchema, loadSettings, saveSetting, getClient,
  memoryText, profilesText, recentIdeaTitles,
  KIND_LABELS, KINDS, DEFAULT_ACTORS, SETTING_KEYS,
};
