// „Резултати за клиент" — известие, когато всички видеа по един контент план са публикувани.
//
// Веднъж дневно (Админ → Резултати; default 09:30 Europe/Sofia) минаваме през живите
// Basecamp карти (същия агрегат като Dashboard/Клиенти — bc-aggregate) и за всеки
// клиент + КП смятаме отчетния период:
//
//   начало = датата на публикуване на ПЪРВОТО видео по плана
//   край   = датата на публикуване на ПОСЛЕДНОТО видео + 3 КАЛЕНДАРНИ дни (настройка)
//
// Известието излиза на датата „край" — тогава последното видео вече е било качено преди
// 3 дни и има данни за резултати. Затова тригерът е ДАТАТА на качване, а не чекването на
// стъпката „PM - Насрочване/Качване…" (решение на Венци: стъпката се чеква по-рано, тя е
// времето за реакция преди публикуването).
//
// Датата на публикуване на видео = собственият Due на картата (kp-split я слага от плана;
// стъпките са −11/−6/−1 работни дни от нея). Видеата се броят от ВСИЧКИ дъски — едно видео
// може да е още в заснемане, монтаж или вече към клиент.
//
// Пълнота: четем и самата Pre-Production карта (тя може вече да е в Done) и броим „Видео N"
// секциите. Ако за видео още няма карта, датата му се взима от плана — така планът не се
// обявява по-рано заради несъздадени карти.
const cron = require('node-cron');
const config = require('../config');
const { query, queryOne, execute } = require('../db/pool');
const bc = require('./basecamp');
const agg = require('./bc-aggregate');
const { getServiceAuth } = require('./basecamp-token');
const { refreshBcPeople, mentionOf } = require('./gcal-alerts');
const { parsePlan, parsePublishDate, planHtml } = require('./kp-plan');
const { addWorkingDays } = require('./workdays');

const PROJECT_ID = config.BASECAMP_TEAM_PROJECT_ID;
const CHANGE_WINDOW_DAYS = 60; // след толкова дни спираме да следим за промени по обявен КП

let task = null;
let running = false;

// ---------- настройки ----------

async function loadConfig() {
  const rows = await query("SELECT key, value FROM settings WHERE key LIKE 'kp_results_%'");
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  const daysAfter = parseInt(s.kp_results_days_after, 10);
  return {
    enabled: s.kp_results_enabled === 'true',
    time: /^\d{1,2}:\d{2}$/.test(s.kp_results_time || '') ? s.kp_results_time : '09:30',
    daysAfter: Number.isFinite(daysAfter) ? daysAfter : 3,
    since: /^\d{4}-\d{2}-\d{2}$/.test(s.kp_results_since || '') ? s.kp_results_since : null,
    cardEnabled: s.kp_results_card_enabled !== 'false',
    cardWorkdays: parseInt(s.kp_results_card_workdays, 10) || 2,
    cardTitle: s.kp_results_card_title || '{клиент} КП-{номер} - Резултати',
    boardUrl: s.kp_results_bc_board_url || '',
    project: parseInt(s.kp_results_bc_project, 10) || null,
    board: parseInt(s.kp_results_bc_board, 10) || null,
    cardBoardId: parseInt(s.kp_results_card_board_id, 10) || null,
    cardColumnId: parseInt(s.kp_results_card_column_id, 10) || null,
  };
}

function initKpResults() {
  loadConfig().then((cfg) => {
    if (task) { task.stop(); task = null; }
    if (!cfg.enabled) { console.log('  KP results alerts: disabled (kp_results_enabled=false)'); return; }
    const m = cfg.time.match(/^(\d{1,2}):(\d{2})$/);
    const hour = Math.min(23, parseInt(m[1], 10));
    const minute = Math.min(59, parseInt(m[2], 10));
    task = cron.schedule(`${minute} ${hour} * * *`, () => {
      runResultsCheck().catch((err) => console.error('[kp-results] error:', err.message));
    }, { timezone: 'Europe/Sofia' });
    console.log(`  KP results alerts: active (всеки ден ${cfg.time} BG)`);
  }).catch((err) => console.log('  KP results alerts: skipped —', err.message));
}

// Пре-armва cron-а след запис на настройките (вкл./изкл. или нов час).
async function restartKpResults() {
  initKpResults();
}

// ---------- дати ----------

// Днес в Europe/Sofia ('en-CA' дава YYYY-MM-DD) — сървърът върви на UTC.
function todayInSofia() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function addCalendarDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function bgDate(ymd) {
  if (!ymd) return '—';
  const [y, m, d] = String(ymd).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

// pg връща DATE като Date обект — нормализираме до 'YYYY-MM-DD'.
function dbYmd(v) {
  if (!v) return null;
  return (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- контент планът (за брой видеа + дати на още несъздадени карти) ----------

async function planInfo(auth, planCard, cache) {
  if (!planCard || !planCard.id) return null;
  const key = String(planCard.id);
  if (cache.has(key)) return cache.get(key);
  let info = null;
  try {
    const card = await bc.getCard(auth.token, auth.account, PROJECT_ID, planCard.id);
    const { sections } = parsePlan(planHtml(card));
    const dates = new Map();
    for (const s of sections) {
      const d = parsePublishDate(s.sectionText);
      if (d) dates.set(s.videoNumber, d);
    }
    info = { count: sections.length, dates };
  } catch (err) {
    console.warn(`[kp-results] планът ${planCard.id} не е прочетен: ${err.message}`);
  }
  cache.set(key, info);
  return info;
}

// ---------- периодът ----------

// Обединява датите от картите (водещи — те се обновяват) с датите от плана (за видеа
// без карта). Връща { status, start, end, lastPublish, videosCount, cardVideos, planVideos }.
function buildRange(plan, info, daysAfter) {
  const datesByNumber = new Map(); // videoNumber -> [публикационни дати от картите]
  for (const v of plan.videos || []) {
    if (v.videoNumber == null) continue;
    if (!datesByNumber.has(v.videoNumber)) datesByNumber.set(v.videoNumber, []);
    if (v.publishOn) datesByNumber.get(v.videoNumber).push(v.publishOn);
  }
  const numbers = new Set([...datesByNumber.keys(), ...(info ? info.dates.keys() : [])]);
  if (!numbers.size) return { status: 'no-videos' };

  const resolved = [];
  const missing = [];
  for (const n of numbers) {
    const fromCards = (datesByNumber.get(n) || []).sort();
    // При няколко карти за едно видео взимаме най-късната известна дата.
    const d = fromCards.length ? fromCards[fromCards.length - 1] : (info && info.dates.get(n)) || null;
    if (d) resolved.push(d); else missing.push(n);
  }
  const cardVideos = datesByNumber.size;
  const planVideos = info ? info.count : null;
  if (missing.length) {
    return { status: 'no-dates', missing: missing.sort((a, b) => a - b), cardVideos, planVideos };
  }

  resolved.sort();
  const start = resolved[0];
  const lastPublish = resolved[resolved.length - 1];
  const end = addCalendarDays(lastPublish, daysAfter);
  return {
    status: 'ok', start, end, lastPublish,
    videosCount: resolved.length, cardVideos, planVideos,
    // Предупреждаваме, когато по плана има видеа без създадена карта (датата им е
    // взета от плана, така че периодът е верен, но някой трябва да ги погледне).
    mismatch: planVideos != null && planVideos > cardVideos,
  };
}

const fpOf = (r) => `${r.start}|${r.end}|${r.videosCount}`;

// ---------- хора ----------

async function responsiblePeople() {
  const rows = await query(
    `SELECT p.person_id, p.name, p.attachable_sgid
     FROM kp_results_responsibles r JOIN bc_people p ON p.person_id = r.bc_person_id
     WHERE p.active = TRUE ORDER BY p.name`
  );
  return rows;
}

// Абонати = точно тагнатите. Празен списък → само ботът (иначе Basecamp известява ЦЕЛИЯ проект).
async function subscriberIds(auth, people) {
  const ids = [...new Set(people.filter((p) => p.person_id).map((p) => Number(p.person_id)))];
  if (ids.length) return ids;
  try {
    const me = await bc.getMyProfile(auth.token, auth.account);
    return me && me.id ? [me.id] : [];
  } catch { return []; }
}

// ---------- дестинация за картата „Резултати" ----------

async function resolveCardDest(auth, cfg) {
  if (cfg.cardBoardId && cfg.cardColumnId) {
    return { boardId: cfg.cardBoardId, columnId: cfg.cardColumnId, auto: false };
  }
  const struct = await agg.loadStructure(auth.token, auth.account);
  const board = (struct.boards || []).find((b) => /акаунт/i.test(b.title || ''));
  if (!board) return null;
  const col = (board.columns || []).find((c) => /разпределение/i.test(c.title || ''));
  if (!col) return null;
  return { boardId: board.id, columnId: col.id, boardTitle: board.title, columnTitle: col.title, auto: true };
}

async function createResultsCard(auth, cfg, client, plan, r) {
  const dest = await resolveCardDest(auth, cfg);
  if (!dest) throw new Error('Не намирам дъска „Акаунт Мениджмънт" → колона „Разпределение" (задай ги ръчно в настройките).');
  const title = cfg.cardTitle
    .replace(/\{клиент\}/g, client.name)
    .replace(/\{номер\}/g, String(plan.kp))
    .trim();

  // Идемпотентност: ако картата вече съществува в колоната, не правим втора.
  const existing = await bc.getColumnCards(auth.token, auth.account, PROJECT_ID, dest.columnId);
  const hit = (existing || []).find((c) => (c.title || '').trim() === title);
  if (hit) return { id: hit.id, url: bc.normalizeAppUrl(hit.app_url), title, existed: true };

  const due = addWorkingDays(r.end, cfg.cardWorkdays);
  const lines = [
    `<div>Резултати за <strong>${escHtml(client.name)} КП-${plan.kp}</strong> — период <strong>${bgDate(r.start)} – ${bgDate(r.end)}</strong> (${r.videosCount} видеа).</div>`,
    `<div>Срок: ${bgDate(due)} (${cfg.cardWorkdays} работни дни).</div>`,
  ];
  if (plan.planCard && plan.planCard.url) {
    lines.push(`<div><a href="${escHtml(plan.planCard.url)}">Контент план</a></div>`);
  }
  const card = await bc.createCard(auth.token, auth.account, PROJECT_ID, dest.columnId, {
    title, content: lines.join(''), due_on: due,
  });
  return { id: card.id, url: bc.normalizeAppUrl(card.app_url), title, due };
}

// ---------- известието ----------

async function announce(auth, cfg, client, plan, r, info) {
  const people = await responsiblePeople();

  let card = null;
  if (cfg.cardEnabled) {
    try {
      card = await createResultsCard(auth, cfg, client, plan, r);
    } catch (err) {
      console.error(`[kp-results] картата за ${client.name} КП-${plan.kp} не е създадена: ${err.message}`);
    }
  }

  const lines = [];
  lines.push(`🗓 <strong>Период за резултатите: ${bgDate(r.start)} – ${bgDate(r.end)}</strong>`);
  lines.push(`🎬 Видеа по плана: <strong>${r.videosCount}</strong> · последното е публикувано на ${bgDate(r.lastPublish)} (+${cfg.daysAfter} дни)`);
  if (r.mismatch) {
    lines.push(`⚠️ По контент плана има <strong>${r.planVideos}</strong> видеа, а карти намирам за <strong>${r.cardVideos}</strong> — провери дали всички са създадени.`);
  }
  if (!info) {
    lines.push('ℹ️ Контент планът не е намерен в Pre-Production (възможно е да е архивиран) — броят видеа не е сверен с него.');
  }
  if (plan.planCard && plan.planCard.url) {
    lines.push(`🔗 <a href="${escHtml(plan.planCard.url)}">Контент план</a>`);
  }
  if (card) {
    lines.push(`📋 Задача: <a href="${escHtml(card.url)}">${escHtml(card.title)}</a>${card.existed ? ' <em>(вече съществуваше)</em>' : ` — срок ${bgDate(card.due)}`}`);
  }
  if (people.length) {
    lines.push('');
    lines.push(`👥 ${people.map((p) => mentionOf(p, p.name)).join(' ')} — време е да подготвим резултатите.`);
  }

  const subject = `📊 Резултати: ${client.name} КП-${plan.kp} — ${bgDate(r.start)} – ${bgDate(r.end)}`;
  const message = await bc.createMessage(auth.token, auth.account, cfg.project, cfg.board, {
    subject,
    content: `<div>${lines.join('<br>')}</div>`,
    subscriptions: await subscriberIds(auth, people),
  });

  await execute(
    `INSERT INTO kp_results_alerts
       (client_key, client_name, kp, range_start, range_end, videos_count, plan_videos_count,
        fingerprint, bc_message_id, bc_project_id, bc_card_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (client_key, kp) DO UPDATE SET
       range_start = $4, range_end = $5, videos_count = $6, plan_videos_count = $7,
       fingerprint = $8, bc_message_id = $9, bc_project_id = $10, bc_card_id = $11, updated_at = NOW()`,
    [client.key, client.name, plan.kp, r.start, r.end, r.videosCount, r.planVideos,
     fpOf(r), message.id, cfg.project, card ? card.id : null]
  );

  console.log(`[kp-results] обявено: ${subject} (message ${message.id})`);
  return { client: client.name, kp: plan.kp, start: r.start, end: r.end, messageId: message.id, cardId: card ? card.id : null };
}

// Датите се промениха след обявяване → коментар под същото съобщение (не ново известие).
async function postChange(auth, cfg, client, plan, r, row) {
  const people = await responsiblePeople();
  const mentions = people.map((p) => mentionOf(p, p.name)).join(' ');
  const oldStart = dbYmd(row.range_start), oldEnd = dbYmd(row.range_end);
  const content =
    (mentions ? mentions + '<br>' : '') +
    `🔄 <strong>Периодът за резултатите на ${escHtml(client.name)} КП-${plan.kp} се промени:</strong> ` +
    `${bgDate(r.start)} – ${bgDate(r.end)} <em>(беше ${bgDate(oldStart)} – ${bgDate(oldEnd)})</em>`;
  await bc.createComment(auth.token, auth.account, row.bc_project_id || cfg.project, row.bc_message_id, `<div>${content}</div>`);
  await execute(
    `UPDATE kp_results_alerts SET range_start=$1, range_end=$2, videos_count=$3,
       plan_videos_count=$4, fingerprint=$5, updated_at=NOW() WHERE id=$6`,
    [r.start, r.end, r.videosCount, r.planVideos, fpOf(r), row.id]
  );
  console.log(`[kp-results] промяна по ${client.name} КП-${plan.kp} → коментар под ${row.bc_message_id}`);
}

// ---------- главният ход ----------

// dryRun = само пресмята и връща какво БИ се случило (бутон „Преглед" в админа).
async function runResultsCheck({ dryRun = false } = {}) {
  if (running && !dryRun) return { skipped: 'running' };
  if (!dryRun) running = true;
  try {
    const cfg = await loadConfig();
    if (!cfg.enabled && !dryRun) return { skipped: 'disabled' };
    if (!cfg.project || !cfg.board) {
      const msg = 'Няма зададен Message Board за известията.';
      if (dryRun) throw new Error(msg);
      console.warn('[kp-results]', msg);
      return { skipped: 'no-board' };
    }

    const auth = await getServiceAuth();
    const { clients } = await agg.aggregateAll(auth.token, auth.account);
    const today = todayInSofia();
    const cache = new Map();

    const rows = await query('SELECT * FROM kp_results_alerts');
    const byKey = new Map(rows.map((r) => [`${r.client_key}#${r.kp}`, r]));

    const announced = [], changed = [], items = [], errors = [];

    for (const client of clients) {
      for (const plan of client.plans || []) {
        const row = byKey.get(`${client.key}#${plan.kp}`) || null;
        try {
          const info = await planInfo(auth, plan.planCard, cache);
          const r = buildRange(plan, info, cfg.daysAfter);
          if (r.status === 'no-videos') continue;

          const item = {
            client: client.name, kp: plan.kp, status: r.status,
            start: r.start || null, end: r.end || null,
            videosCount: r.videosCount || 0, planVideos: r.planVideos,
            cardVideos: r.cardVideos, mismatch: !!r.mismatch,
            announcedAt: row ? row.announced_at : null,
            messageId: row ? String(row.bc_message_id || '') : null,
          };

          if (r.status === 'no-dates') {
            item.note = `видеа без дата: ${r.missing.join(', ')}`;
            items.push(item);
            continue;
          }

          if (row) {
            // Вече обявено — следим само за смяна на периода, и то ограничено във времето.
            const fresh = row.announced_at && (Date.now() - new Date(row.announced_at).getTime()) < CHANGE_WINDOW_DAYS * 86400_000;
            const moved = r.start !== dbYmd(row.range_start) || r.end !== dbYmd(row.range_end);
            item.action = fresh && moved && row.bc_message_id ? 'change' : 'announced';
            items.push(item);
            if (item.action === 'change' && !dryRun) {
              await postChange(auth, cfg, client, plan, r, row);
              changed.push({ client: client.name, kp: plan.kp });
            }
            continue;
          }

          if (r.end > today) { item.action = 'pending'; items.push(item); continue; }
          // Без backfill: при първо включване не заливаме борда със стари КП-та.
          if (cfg.since && r.end < cfg.since) { item.action = 'skipped-old'; items.push(item); continue; }

          item.action = 'announce';
          items.push(item);
          if (!dryRun) announced.push(await announce(auth, cfg, client, plan, r, info));
        } catch (err) {
          console.error(`[kp-results] ${client.name} КП-${plan.kp}:`, err.message);
          errors.push({ client: client.name, kp: plan.kp, error: err.message });
        }
      }
    }

    if (!dryRun && (announced.length || changed.length)) {
      console.log(`[kp-results] готово: ${announced.length} нови известия, ${changed.length} промени`);
    }
    items.sort((a, b) => String(a.end || '9999').localeCompare(String(b.end || '9999')));
    return { today, announced, changed, items, errors };
  } finally {
    if (!dryRun) running = false;
  }
}

// „Тест към Basecamp" — проверява, че ботът може да пише на зададения борд.
async function postTestMessage() {
  const cfg = await loadConfig();
  if (!cfg.project || !cfg.board) throw new Error('Първо задай линк към Message Board.');
  const auth = await getServiceAuth();
  const people = await responsiblePeople();
  const message = await bc.createMessage(auth.token, auth.account, cfg.project, cfg.board, {
    subject: '🔧 Тест: известия за резултати',
    content: '<div>Това е тестово съобщение от платформата — известията за подготовка на резултати работят. Може да го изтриеш.</div>',
    subscriptions: await subscriberIds(auth, people),
  });
  return { ok: true, url: bc.normalizeAppUrl(message.app_url) };
}

module.exports = {
  initKpResults, restartKpResults, runResultsCheck, postTestMessage,
  loadConfig, responsiblePeople, refreshBcPeople, resolveCardDest,
  buildRange, addCalendarDays, // exported for tests
};
