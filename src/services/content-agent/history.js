// Content агент — история на промените в паметта и профилите.
//
// Всяко добавяне, редакция, одобрение/отказ и триене се записва с „преди" и „след"
// (целия ред), кой и кога. Админ вижда историята и може да върне състоянието ПРЕДИ
// която и да е промяна: изтрит запис се връща със същото id, редактиран се връща
// към стария текст, добавен се маха. Самото връщане също се записва в историята.
const { query, queryOne, execute } = require('../../db/pool');

// Колоните, които се пазят и връщат (stats/last_scraped_at на профила се пресмятат пак от Скаута).
const COLS = {
  memory: ['id', 'client_id', 'kind', 'text', 'source', 'status', 'created_by', 'reviewed_by', 'created_at', 'updated_at'],
  profile: ['id', 'client_id', 'platform', 'url', 'handle', 'label', 'role', 'active', 'created_by', 'created_at'],
};
const TABLE = { memory: 'ca_memory', profile: 'ca_profiles' };

function pick(entity, row) {
  if (!row) return null;
  const out = {};
  for (const c of COLS[entity]) if (row[c] !== undefined) out[c] = row[c];
  return out;
}

const userOf = (req) => ({ name: (req && req.user && req.user.name) || '', id: (req && req.user && req.user.userId) || null });

/** Записва една промяна. Никога не хвърля — историята не бива да спира самата работа. */
async function log(entity, action, before, after, by) {
  try {
    const b = pick(entity, before);
    const a = pick(entity, after);
    const ref = a || b;
    if (!ref) return;
    await execute(
      `INSERT INTO ca_history (client_id, entity, entity_id, action, before, after, by_name, by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ref.client_id, entity, ref.id, action, b ? JSON.stringify(b) : null, a ? JSON.stringify(a) : null,
       (by && by.name) || '', (by && by.id) || null]
    );
  } catch (e) {
    console.warn('[content-agent history]', e.message);
  }
}

async function list(clientId, limit = 300) {
  return query(
    `SELECT id, entity, entity_id, action, before, after, by_name, created_at
       FROM ca_history WHERE client_id = $1 ORDER BY id DESC LIMIT $2`,
    [clientId, limit]
  );
}

/** Връща реда в състоянието му ПРЕДИ дадената промяна. */
async function restore(historyId, by) {
  const h = await queryOne('SELECT * FROM ca_history WHERE id = $1', [historyId]);
  if (!h) throw Object.assign(new Error('Записът в историята не е намерен.'), { status: 404 });
  const table = TABLE[h.entity];
  const current = await queryOne(`SELECT * FROM ${table} WHERE id = $1`, [h.entity_id]);
  const target = h.before;

  let after = null;
  if (!target) {
    // Промяната е било добавяне → връщането маха реда.
    if (!current) throw Object.assign(new Error('Записът вече го няма.'), { status: 400 });
    if (h.entity === 'profile') await execute('DELETE FROM ca_videos WHERE profile_id = $1', [h.entity_id]);
    await execute(`DELETE FROM ${table} WHERE id = $1`, [h.entity_id]);
  } else {
    const cols = COLS[h.entity].filter((c) => target[c] !== undefined);
    const vals = cols.map((c) => target[c]);
    const sets = cols.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`);
    if (h.entity === 'memory') sets.push('updated_at = NOW()');
    after = await queryOne(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       ON CONFLICT (id) DO UPDATE SET ${sets.join(', ')} RETURNING *`,
      vals
    );
  }
  await log(h.entity, 'restore', current, after, by);
  return { ok: true, entity: h.entity, entity_id: h.entity_id, removed: !target };
}

module.exports = { log, list, restore, userOf };
