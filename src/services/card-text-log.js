// Дневник на текста по Basecamp картите — какъв е бил и с какво е заменен.
//
// Basecamp не пази версии на текста на картата: отвориш ли я, виждаш само сегашния
// вариант. Затова при всеки снапшот (pm-agent/snapshot.js, на 15 минути) сравняваме
// новия текст със записания и при разлика оставяме ред тук.
//
// Пазим САМО текста. Снимките и видеата от картата не се пазят — на тяхно място
// остава бележка „[снимка]" / „[видео]", колкото да се вижда, че ги е имало.
//
// Сравнението е върху изчистения текст, не върху суровия HTML: така смяна само на
// форматирането или на вътрешния идентификатор на прикачен файл не поражда запис.
const { query, execute } = require('../db/pool');
const bc = require('./basecamp');

// Таванът пази един много дълъг КП текст от това да надуе дневника.
const MAX_TEXT = 20000;

// Таблицата се създава и в движение, не само от миграцията — дневникът трябва да
// проработи и ако някой ден миграциите изостанат от кода (същият подход като при
// дневника на производствения календар).
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = execute(`
      CREATE TABLE IF NOT EXISTS bc_card_text_log (
        id            BIGSERIAL PRIMARY KEY,
        card_id       BIGINT NOT NULL,
        project_id    BIGINT,
        card_title    TEXT NOT NULL DEFAULT '',
        board_title   TEXT NOT NULL DEFAULT '',
        app_url       TEXT NOT NULL DEFAULT '',
        field         TEXT NOT NULL DEFAULT 'content',
        old_text      TEXT NOT NULL DEFAULT '',
        new_text      TEXT NOT NULL DEFAULT '',
        who_id        BIGINT,
        who_name      TEXT NOT NULL DEFAULT '',
        bc_updated_at TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`)
      .then(() => Promise.all([
        execute('CREATE INDEX IF NOT EXISTS idx_bc_card_text_log_created ON bc_card_text_log (created_at DESC)'),
        execute('CREATE INDEX IF NOT EXISTS idx_bc_card_text_log_card ON bc_card_text_log (card_id, created_at DESC)'),
      ]))
      .catch((err) => {
        schemaReady = null; // да опита пак при следващото писане
        throw err;
      });
  }
  return schemaReady;
}

// ---------------------------------------------------------------- изчистване

const ATTACH_WORD = { image: 'снимка', video: 'видео', audio: 'аудио' };

function attachmentLabel(tag) {
  const ct = /content-type="([^"]*)"/i.exec(tag);
  const kind = ct ? String(ct[1]).split('/')[0].toLowerCase() : '';
  const name = /filename="([^"]*)"/i.exec(tag);
  return `[${ATTACH_WORD[kind] || 'файл'}${name && name[1] ? ' ' + name[1] : ''}]`;
}

// Rich HTML от Basecamp → четим текст. Целта не е красив рендер, а стабилно
// сравнение: един и същи текст трябва да дава един и същи низ всеки път.
function plainText(html) {
  let s = String(html == null ? '' : html);
  s = s.replace(/<bc-attachment\b[^>]*>[\s\S]*?<\/bc-attachment>/gi, (m) => ` ${attachmentLabel(m)} `);
  s = s.replace(/<bc-attachment\b[^>]*\/?>/gi, (m) => ` ${attachmentLabel(m)} `);
  s = s.replace(/<img\b[^>]*>/gi, ' [снимка] ');
  s = s.replace(/<li\b[^>]*>/gi, '\n• ');
  s = s.replace(/<(?:br|\/div|\/p|\/li|\/h[1-6]|\/tr|\/blockquote)\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/gi, ' ')
       .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
       .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
       .replace(/&amp;/gi, '&'); // &amp; последно, иначе разваля другите
  s = s.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/[ \t]+\n/g, '\n');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

// ------------------------------------------------------------------- авторът

// Basecamp не казва в самата карта кой я е редактирал — това стои в събитията ѝ.
// Взима се събитието най-близко по време до новото `updated_at`; ако нищо не
// съвпадне, най-новото. Провали ли се заявката, записът пак се прави — само без име.
async function findEditor(auth, projectId, cardId, updatedAt) {
  try {
    const events = await bc.getRecordingEvents(auth.token, auth.account, projectId, cardId);
    const withCreator = events.filter((e) => e && e.creator && e.created_at);
    if (!withCreator.length) return null;
    const target = updatedAt ? new Date(updatedAt).getTime() : NaN;
    const sorted = withCreator.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const best = Number.isNaN(target)
      ? sorted[0]
      : sorted.reduce((acc, e) => {
        const d = Math.abs(new Date(e.created_at).getTime() - target);
        return !acc || d < acc.d ? { e, d } : acc;
      }, null).e;
    return { id: best.creator.id || null, name: best.creator.name || '' };
  } catch (err) {
    console.warn('[card-text-log] events failed for card', cardId, '—', err.message);
    return null;
  }
}

// -------------------------------------------------------------------- записът

/**
 * Сравнява предишния снапшот на картата с прясно изтеглената и записва разликите.
 *
 * @param auth   Basecamp токен (същият, с който върви снапшотът)
 * @param card   пълната карта от getCard
 * @param prev   редът от bc_cards_snap отпреди upsert-а ({ title, content }) или null
 * @param meta   { projectId, boardTitle }
 * @returns брой записани реда
 */
async function logCardTextChange(auth, card, prev, meta) {
  if (!prev) return 0; // нова карта — няма „предишен текст", който да е заменен

  const changes = [];

  const oldBody = plainText(prev.content);
  const newBody = plainText(card.content);
  if (oldBody !== newBody) changes.push({ field: 'content', old: oldBody, new: newBody });

  const oldTitle = String(prev.title || '').trim();
  const newTitle = String(card.title || '').trim();
  if (oldTitle !== newTitle) changes.push({ field: 'title', old: oldTitle, new: newTitle });

  if (!changes.length) return 0;

  await ensureSchema();
  // Едно питане за автора, дори когато и заглавието, и текстът са пипнати.
  const who = await findEditor(auth, meta.projectId, card.id, card.updated_at);

  for (const ch of changes) {
    await execute(
      `INSERT INTO bc_card_text_log
         (card_id, project_id, card_title, board_title, app_url, field,
          old_text, new_text, who_id, who_name, bc_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        card.id, meta.projectId || null, newTitle, meta.boardTitle || '',
        bc.normalizeAppUrl(card.app_url || ''), ch.field,
        ch.old.slice(0, MAX_TEXT), ch.new.slice(0, MAX_TEXT),
        who ? who.id : null, who ? who.name : '',
        card.updated_at || null,
      ]
    );
  }
  return changes.length;
}

// Списъкът за админ панела. `withText: false` връща само резюмето — обединеният
// таб на „История" не бива да мъкне мегабайти стар текст.
async function recentTextChanges(limit, withText) {
  await ensureSchema();
  return query(
    `SELECT id, created_at, card_id, card_title, board_title, app_url, field,
            who_name, bc_updated_at,
            ${withText ? 'old_text, new_text,' : ''}
            LENGTH(old_text) AS old_len, LENGTH(new_text) AS new_len
       FROM bc_card_text_log ORDER BY id DESC LIMIT $1`,
    [limit]
  );
}

module.exports = { plainText, logCardTextChange, recentTextChanges, ensureSchema, MAX_TEXT };
