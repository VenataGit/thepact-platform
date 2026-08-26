// КП → mini-tasks bridge. Reads a Pre-Production content-plan card, parses its
// "Видео N - Заглавие" sections, and creates one card per video in the chosen
// board's "Разпределение" column. Acts AS the logged-in user (their Basecamp token).
//
// Preview-before-create safety: /preview only parses (no writes); /create writes.
// Carries: title + text copy + publish date (→ card due date + computed step dates) +
// media (images/videos) re-uploaded into the new card. Links inside text are kept as text.
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const config = require('../config');
const bc = require('../services/basecamp');
const { getUserAuth } = require('../services/basecamp-token');
const { subtractWorkingDays } = require('../services/workdays');
const kpPlan = require('../services/kp-plan');
const { parsePlan, parsePublishDate, planHtml } = kpPlan;
const fp = require('../services/folder-paths');
const fq = require('../services/folder-queue');
const bch = require('../services/bc-html');
const kpArchive = require('../services/kp-archive');

const MAX_VIDEOS = 30; // hard safety cap so a malformed plan can't flood the board
const MAX_ATTACH_BYTES = 200 * 1024 * 1024; // skip media larger than this

// Стъпките и отмесванията идват от services/steps.js — същият списък, който ползват
// инструментът за задачи и авто-синхронът, за да не се разминават датите. От 16.08.2026
// всяка разбита задача получава и стъпката за сценарий (16 работни дни), която досега
// я имаше само инструментът „Създаване на задачи".
const prodSteps = require('../services/steps');
const VIDEO_STEPS = prodSteps.STEPS;

const escAttr = (s) => (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// --- parsing (attachment-aware) ---
// Самото парсване живее в services/kp-plan.js (споделено с kp-results.js).

// Attachment indices a section references (placeholders are whole lines).
function attachmentIdxs(sectionText) {
  const out = [];
  sectionText.split('\n').forEach((line) => {
    const m = line.trim().match(/^A(\d+)$/);
    if (m) out.push(parseInt(m[1], 10));
  });
  return out;
}

// Редовете на една секция → елементи за описанието: обикновените редове стават inline
// части (services/bc-html.js — escape + оцветените заглавия), а placeholder-ите за медия
// стават самостоятелни <bc-attachment> елементи (attachMap: idx -> tag HTML, '' когато
// медията не е могла да се пренесе — тогава редът просто отпада).
function sectionItems(sectionText, attachMap) {
  if (!sectionText) return [];
  const out = [];
  for (const raw of sectionText.split('\n')) {
    const t = raw.trim();
    const pm = t.match(/^A(\d+)$/);
    if (pm) {
      const tag = attachMap[pm[1]];
      if (tag) out.push({ attachment: tag });
      continue;
    }
    out.push(bch.line(t));
  }
  return out;
}

// Елементите → готовия HTML: последователните редове влизат в ЕДИН Trix блок (иначе
// празните редове изчезват при първата редакция), а всяко прикачено файлче остава
// самостоятелен елемент между блоковете — точно както Trix ги пази.
function itemsToHtml(items) {
  const out = [];
  let run = [];
  const flush = () => { const b = bch.block(run); if (b) out.push(b); run = []; };
  for (const it of items) {
    if (it && it.attachment) { flush(); out.push(it.attachment); }
    else run.push(it);
  }
  flush();
  return out.join('');
}

function snippetOf(sectionText) {
  return sectionText.split('\n').filter((l) => !/^A\d+$/.test(l.trim())).slice(1).join(' ').trim().slice(0, 180);
}

// Целият текст, който ще влезе в описанието на новата карта — точно както го
// сглобява /create, само че в четим вид: placeholder-ите за медия стават
// „📎 име-на-файла", а блокът с локациите се показва на мястото си.
// Ползва се от бутона „Преглед" в модала (Венци, 21.08.2026).
function previewBody(sectionText, attachments, title) {
  const named = (text) => String(text || '').split('\n').map((l) => {
    const m = l.trim().match(/^A(\d+)$/);
    if (!m) return l;
    const a = attachments[parseInt(m[1], 10)];
    return '📎 ' + ((a && a.filename) || 'файл');
  });
  const split = fp.splitForLocation(sectionText);
  const paths = fp.pathsForTitle(title);
  const loc = paths ? [
    'Локация на файлове:',
    'Windows: ' + paths.files.win,
    'Mac: ' + paths.files.mac,
    'Локация на експортираното видео:',
    'Windows: ' + paths.exported.win,
    'Mac: ' + paths.exported.mac,
  ] : [];
  const groups = [named(split.before), loc, split.after ? named(split.after) : []];
  return groups.filter((g) => g.some((l) => String(l).trim() !== '')).map((g) => g.join('\n')).join('\n\n');
}

// Стъпките, които картата ще получи, с изчислените дати (работни дни + БГ празници).
function stepsFor(publishDate) {
  return VIDEO_STEPS.map((s) => ({
    title: s.title,
    due_on: publishDate ? subtractWorkingDays(publishDate, s.offset) : null,
  }));
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// { "3": "2026-09-08" } → чист обект само с валидните двойки.
function cleanDateOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const n = parseInt(k, 10);
    if (!Number.isFinite(n)) continue;
    if (typeof v !== 'string' || !ISO_RE.test(v)) continue;
    out[n] = v;
  }
  return out;
}

// Кои от подготвените дати в главата на плана остават без видео.
function unusedPlanDates(planDates, videoDates) {
  const used = new Set(videoDates.filter(Boolean));
  return (planDates || []).filter((d) => !used.has(d));
}

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Колоната Done на Pre-Production — там отива планът, след като е разбит.
// Разпознаването живее в services/basecamp.js (pickDoneColumn). Тук освен колоната
// връщаме и списъка с всички колони, за да го каже съобщението за грешка, вместо да
// остане глухо „не намерих Done".
async function doneColumnOfPre(token, tools) {
  const preTool = findTool(tools, /pre[\s-]*produc|предпрод/i);
  if (!preTool) return { column: null, columns: [], board: null };
  const table = (await bc.authedGet(preTool.url, token)).json;
  const lists = table.lists || [];
  const done = bc.pickDoneColumn(lists);
  return {
    column: done ? { id: done.id, title: done.title } : null,
    columns: lists.map((l) => l.title || '?'),
    board: preTool.title || table.title || 'Pre-Production',
  };
}

// Card-title prefix from the plan card's title (strip "контент план" tails).
function planPrefix(title) {
  let t = (title || '').trim();
  t = t.replace(/[-–—\s]*(контент(?:\s|-)?план|content\s*plan|план)\s*$/i, '').trim();
  t = t.replace(/[-–—\s]+$/, '').trim();
  t = t.replace(/^Видео\s+\d+\s*[-–—]\s*/i, '').trim(); // don't double a "Видео N" prefix
  return t || (title || '').trim();
}

const findTool = (tools, re) => tools.find((t) => re.test(t.title || ''));
async function dock(token, account) {
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  const project = await bc.getProject(token, account, projectId);
  const tools = (project.dock || []).filter((t) => t.enabled && /kanban|card/i.test(t.name));
  return { projectId, tools };
}

// The only allowed destinations: Production + Post-Production card tables.
async function resolveDestinations(token, tools) {
  const prodTool = tools.find((t) => /produc/i.test(t.title || '') && !/pre|post|пост|пред/i.test(t.title || ''));
  const postTool = findTool(tools, /post[\s-]*produc|пост/i);
  const out = [];
  for (const t of [prodTool, postTool]) {
    if (!t) continue;
    const table = (await bc.authedGet(t.url, token)).json;
    out.push({ id: table.id, title: t.title || table.title });
  }
  return out;
}

// Plans come from the `description` field (it carries the attachments' download `href`).

// GET /api/kp-split/init — content-plan cards to pick + the destination boards.
router.get('/init', requireAuth, async (req, res) => {
  try {
    const { token, account } = await getUserAuth(req.user.userId);
    const { projectId, tools } = await dock(token, account);

    const preTool = findTool(tools, /pre[\s-]*produc|предпрод/i);
    const destinations = await resolveDestinations(token, tools);

    // Plans = only the cards in Pre-Production's "В продукция" column (ready to split).
    const plans = [];
    if (preTool) {
      const table = (await bc.authedGet(preTool.url, token)).json;
      const list = (table.lists || []).find((l) => /в\s*продукция/i.test(l.title || ''));
      if (list && list.cards_count) {
        const cards = await bc.getColumnCards(token, account, projectId, list.id);
        cards.forEach((c) => plans.push({ id: c.id, title: c.title, column: list.title }));
      }
    }
    res.json({ destinations, plans });
  } catch (err) {
    console.error('[kp-split init]', err.message);
    res.status(err.code === 'NO_USER_TOKEN' ? 401 : 502).json({ error: err.message });
  }
});

// POST /api/kp-split/preview { cardId } — parse only, no writes.
router.post('/preview', requireAuth, async (req, res) => {
  try {
    const { cardId } = req.body || {};
    if (!cardId) return res.status(400).json({ error: 'cardId required' });
    const { token, account } = await getUserAuth(req.user.userId);
    const projectId = config.BASECAMP_TEAM_PROJECT_ID;
    const card = await bc.getCard(token, account, projectId, cardId);
    const prefix = planPrefix(card.title);
    let { sections, attachments, header } = parsePlan(planHtml(card));
    const truncated = sections.length > MAX_VIDEOS;
    if (truncated) sections = sections.slice(0, MAX_VIDEOS);
    const videos = sections.map((s) => {
      const cardTitle = prefix + ' - Видео ' + s.videoNumber + ' - ' + s.title;
      const publishDate = parsePublishDate(s.sectionText);
      return {
        videoNumber: s.videoNumber,
        cardTitle,
        publishDate,
        mediaCount: attachmentIdxs(s.sectionText).length,
        snippet: snippetOf(s.sectionText),
        body: previewBody(s.sectionText, attachments, cardTitle),
        steps: stepsFor(publishDate),
      };
    });
    const planDates = kpPlan.parsePlanDates(header);
    res.json({
      planTitle: card.title, count: videos.length, truncated, videos, planDates,
      unusedDates: unusedPlanDates(planDates, videos.map((v) => v.publishDate)),
    });
  } catch (err) {
    console.error('[kp-split preview]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/kp-split/create { cardId, destBoardId, dates? } — create the cards + steps + media.
// `dates` = { videoNumber: 'YYYY-MM-DD' } — датите, редактирани в прегледа. Всяка
// променена дата се записва И в самия контент план (Венци, 21.08.2026), за да не
// се разминават планът и разбитите задачи.
router.post('/create', requireAuth, async (req, res) => {
  try {
    const { cardId, destBoardId } = req.body || {};
    const overrides = cleanDateOverrides((req.body || {}).dates);
    if (!cardId || !destBoardId) return res.status(400).json({ error: 'cardId and destBoardId required' });
    const { token, account } = await getUserAuth(req.user.userId);
    const { projectId, tools } = await dock(token, account);

    // Only allow the destinations /init offered (Production / Post-Production).
    const allowed = await resolveDestinations(token, tools);
    if (!allowed.some((d) => String(d.id) === String(destBoardId))) {
      return res.status(400).json({ error: 'Невалидна дестинация — избери Production или Post-Production.' });
    }

    const card = await bc.getCard(token, account, projectId, cardId);
    const prefix = planPrefix(card.title);
    let { sections, attachments, header } = parsePlan(planHtml(card));
    if (!sections.length) return res.status(400).json({ error: 'Няма разпознати „Видео N - …" секции в плана.' });
    const truncated = sections.length > MAX_VIDEOS;
    if (truncated) sections = sections.slice(0, MAX_VIDEOS);

    // Find the "Разпределение" (Triage) column in the destination board.
    // ВАЖНО: намираме я ПРЕДИ да пипнем датите в плана — иначе при липсваща колона
    // планът щеше да остане пренаписан, без да е създадена нито една задача.
    const destTable = await bc.getCardTable(token, account, projectId, destBoardId);
    const target = (destTable.lists || []).find((l) => /разпределение/i.test(l.title || ''))
      || (destTable.lists || []).find((l) => /Triage/i.test(l.type || ''));
    if (!target) return res.status(400).json({ error: 'Не намерих колона „Разпределение" в избраната дъска.' });

    // --- сменените дати: първо в плана, после в новите карти ---
    // Датата на всяко видео СЛЕД редакциите (тя отива и в Due On, и в стъпките).
    const dateOf = {};
    const changed = [];
    for (const s of sections) {
      const was = parsePublishDate(s.sectionText);
      const now = overrides[s.videoNumber] || was;
      dateOf[s.videoNumber] = now || null;
      if (now && now !== was) changed.push({ videoNumber: s.videoNumber, from: was, to: now });
    }

    // Описанието на плана такова, каквото е СЕГА — след редакциите на датите. От него
    // се прави и архивът, за да не се архивира стара версия.
    let planNowHtml = planHtml(card);

    const planUpdate = { changed: changed.length, ok: false, failed: [] };
    if (changed.length) {
      let html = planNowHtml;
      for (const ch of changed) {
        const r = kpPlan.setPublishDateInHtml(html, ch.videoNumber, ch.to);
        if (r.ok) html = r.html;
        else planUpdate.failed.push({ videoNumber: ch.videoNumber, reason: r.reason });
        // Описанието на новата карта също трябва да носи новата дата.
        const sec = sections.find((s) => s.videoNumber === ch.videoNumber);
        if (sec) sec.sectionText = kpPlan.setPublishDateInText(sec.sectionText, ch.to);
      }
      if (planUpdate.failed.length < changed.length) {
        try {
          await bc.updateCard(token, account, projectId, card, { content: html });
          planUpdate.ok = true;
          planNowHtml = html;
        } catch (e) {
          console.error('[kp-split] plan card update failed:', e.message);
          planUpdate.error = e.message;
        }
      }
    }

    // Idempotency: skip any card whose title already exists in the target column.
    const existing = await bc.getColumnCards(token, account, projectId, target.id);
    const seen = new Set(existing.map((c) => (c.title || '').trim()));

    const mediaErrors = [];
    async function attachTagFor(idx) {
      const a = attachments[idx];
      if (!a || !a.sgid) { mediaErrors.push({ filename: a ? a.filename : ('#' + idx), error: 'no sgid' }); return ''; }
      // Reuse the plan's original attachment sgid directly — Basecamp's storage URLs
      // need a browser session, so server-side download isn't possible. If Basecamp
      // rejects reuse, the card is still created (media just absent).
      return '<bc-attachment sgid="' + a.sgid + '"' + (a.caption ? ' caption="' + escAttr(a.caption) + '"' : '') + '></bc-attachment>';
    }

    const created = [], errors = [], skipped = [];
    for (const s of sections) {
      const title = (prefix + ' - Видео ' + s.videoNumber + ' - ' + s.title).trim();
      if (seen.has(title)) { skipped.push(title); continue; }
      seen.add(title);
      const publishDate = dateOf[s.videoNumber];
      const idxs = attachmentIdxs(s.sectionText);
      try {
        const attachMap = {};
        for (const idx of idxs) attachMap[idx] = await attachTagFor(idx);
        // Локациите идват от заглавието на картата и стоят ГОРЕ — след водещите /…/
        // редове, преди „Описание:" (services/folder-paths.js).
        const split = fp.splitForLocation(s.sectionText);
        const content = itemsToHtml(bch.join([
          sectionItems(split.before, attachMap),
          fp.locationLines(title),
          sectionItems(split.after, attachMap),
        ]));
        const newCard = await bc.createCard(token, account, projectId, target.id, { title, content, due_on: publishDate || undefined });
        // Папките ги прави агентът в офиса — тук само записваме заявката (никога не хвърля).
        await fq.enqueue({ cardId: newCard.id, title });
        for (const step of VIDEO_STEPS) {
          const stepDate = publishDate ? subtractWorkingDays(publishDate, step.offset) : undefined;
          try { await bc.createStep(token, account, projectId, newCard.id, { title: step.title, due_on: stepDate }); }
          catch (e) { console.warn('[kp-split] step failed', step.title, e.message); }
        }
        created.push({ id: newCard.id, title: newCard.title, url: bc.normalizeAppUrl(newCard.app_url), publishDate: publishDate || null, media: idxs.length });
      } catch (e) {
        errors.push({ title, error: e.message });
      }
    }
    // --- планът си свърши работата: архивира се и отива в Done (Венци, 22.08.2026) ---
    // Условието е „планът е разбит ДОКРАЙ", а не „създадени са нови карти". Разликата
    // има значение при повторно пускане: тогава всички задачи вече съществуват, нищо
    // не се създава — и с предишното условие (created.length) планът си оставаше в
    // „В продукция", което Венци видя на живо. Пропаднала ли е поне една задача обаче,
    // планът НЕ се закрива — има какво да се доправи.
    // Двете стъпки са идемпотентни: архивният документ се презаписва, а местене в
    // колоната, в която картата вече стои, е без ефект.
    // Оригиналната карта НЕ се изпразва: архивът е копие, не преместване на текста.
    const fullySplit = sections.length > 0 && errors.length === 0;
    let archive = null, movedToDone = null;
    if (fullySplit) {
      try {
        archive = await kpArchive.archivePlan({
          auth: { token, account }, projectId,
          planTitle: card.title, planHtml: planNowHtml, archivedOn: todayIso(),
        });
      } catch (e) {
        console.error('[kp-split] archive failed:', e.message);
        archive = { basecampError: e.message };
      }
      try {
        const done = await doneColumnOfPre(token, tools);
        if (!done.column) {
          movedToDone = {
            ok: false,
            error: 'не намерих колона Done в „' + (done.board || 'Pre-Production') + '"'
              + (done.columns.length ? ' — колоните са: ' + done.columns.join(', ') : ''),
          };
        } else if (String((card.parent && card.parent.id) || '') === String(done.column.id)) {
          movedToDone = { ok: true, column: done.column.title, already: true };
        } else {
          // Без позиция — Basecamp сам решава къде в Done да сложи картата. Подадена
          // 0 връща 400 „Position out of bounds" (позициите се броят от 1).
          await bc.moveCardToColumn(token, account, projectId, cardId, done.column.id);
          movedToDone = { ok: true, column: done.column.title };
        }
      } catch (e) {
        console.error('[kp-split] move plan to Done failed:', e.message);
        movedToDone = { ok: false, error: e.message };
      }
    } else if (errors.length) {
      movedToDone = { ok: false, error: errors.length + ' задачи не се създадоха — планът остава отворен, докато не минат' };
    }

    const planDates = kpPlan.parsePlanDates(header);
    res.json({
      created, errors, skipped, truncated, mediaErrors,
      board: destTable.title, column: target.title,
      planUpdate,
      planDates,
      unusedDates: unusedPlanDates(planDates, sections.map((s) => dateOf[s.videoNumber])),
      archive, movedToDone,
    });
  } catch (err) {
    console.error('[kp-split create]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/kp-split/step-dates?date=YYYY-MM-DD — стъпките с преизчислени дати за
// новоизбрана дата на публикуване. Само сметка, без Basecamp — ползва се от
// прегледа, когато датата се смени преди създаването.
router.get('/step-dates', requireAuth, (req, res) => {
  const date = String(req.query.date || '');
  if (date && !ISO_RE.test(date)) return res.status(400).json({ error: 'bad date' });
  res.json({ steps: stepsFor(date || null) });
});

// GET /api/kp-split/test-download?card=<id> — admin diagnostic: try downloading the
// first attachment of a plan and report exactly what happens (status / error / bytes).
router.get('/test-download', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cardId = req.query.card;
    if (!cardId) return res.status(400).json({ error: 'card required' });
    const { token, account } = await getUserAuth(req.user.userId);
    const projectId = config.BASECAMP_TEAM_PROJECT_ID;
    const card = await bc.getCard(token, account, projectId, cardId);
    const descA = (parsePlan(card.description || '').attachments)[0] || {};
    const contA = (parsePlan(card.content || '').attachments)[0] || {};
    const tryDl = async (url, withAuth) => {
      if (!url) return { skipped: true };
      try {
        const headers = withAuth
          ? { 'User-Agent': config.BASECAMP_USER_AGENT, Accept: '*/*', Authorization: 'Bearer ' + token }
          : { 'User-Agent': config.BASECAMP_USER_AGENT, Accept: '*/*' };
        const r = await fetch(url, { headers, redirect: 'follow' });
        if (!r.ok) { const b = await r.text().catch(() => ''); return { ok: false, status: r.status, ct: r.headers.get('content-type'), body: b.slice(0, 60) }; }
        const buf = Buffer.from(await r.arrayBuffer());
        return { ok: true, bytes: buf.length, ct: r.headers.get('content-type') };
      } catch (e) { return { ok: false, error: e.message }; }
    };
    res.json({
      filename: descA.filename, contentType: descA.contentType, filesize: descA.filesize,
      hrefDownload_auth: { url: descA.href, ...(await tryDl(descA.href, true)) },
      signed_auth: { url: contA.href, ...(await tryDl(contA.href, true)) },
      signed_noauth: { url: contA.href, ...(await tryDl(contA.href, false)) },
    });
  } catch (err) {
    console.error('[kp-split test-download]', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
