// КП → mini-tasks bridge. Reads a Pre-Production content-plan card, parses its
// "Видео N - Заглавие" sections, and creates one card per video in the chosen
// board's "Разпределение" column. Acts AS the logged-in user (their Basecamp token).
//
// Preview-before-create safety: /preview only parses (no writes); /create writes.
// Phase 1: title + text copy + the 3 milestone steps (no dates — the date-sync fills
// them once a Due date is set). Media (images/videos) come in Phase 2.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const config = require('../config');
const bc = require('../services/basecamp');
const { getUserAuth } = require('../services/basecamp-token');
const { subtractWorkingDays } = require('../services/workdays');

const MAX_VIDEOS = 30; // hard safety cap so a malformed plan can't flood the board

// The 3 milestone steps + working days BEFORE the publish date (same offsets as
// bc-date-sync.js, so dates stay consistent and the webhook re-sync is idempotent).
const STEP_OFFSETS = {
  'Видеограф - Насрочване на снимачен ден': 11,
  'Монтажист - Приключен монтаж': 6,
  'PM - Насрочване/Качване в социални мрежи': 1,
};
const VIDEO_STEPS = Object.keys(STEP_OFFSETS);

// --- parsing (ported from routes/kp.js) ---
function parseVideoSections(htmlContent) {
  if (!htmlContent) return [];
  const text = htmlContent
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const sections = [];
  const lines = text.split('\n').map((l) => l.trim());
  let cur = null, curLines = [];
  for (const line of lines) {
    const m = line.match(/^Видео\s+(\d+)\s*[-–—]\s*(.+)$/);
    if (m) {
      if (cur) sections.push({ ...cur, sectionText: curLines.join('\n') });
      cur = { videoNumber: parseInt(m[1], 10), title: m[2].trim() };
      curLines = [line];
    } else if (cur) { curLines.push(line); }
  }
  if (cur) sections.push({ ...cur, sectionText: curLines.join('\n') });
  return sections;
}

// Extract the publish date from a video section. Matches "Дата на/за публикуване"
// followed by DD.MM.YYYY (slashes/dashes around it are ignored). Returns YYYY-MM-DD.
function parsePublishDate(text) {
  if (!text) return null;
  const m = text.match(/Дата\s+(?:на|за)\s+публикуване\s*[-–—:]?\s*(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/i);
  if (!m) return null;
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function textToHtml(text) {
  if (!text) return '';
  return text.split('\n').map((line) => {
    const e = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (e === '') return '<div><br></div>';
    if (/^Видео\s+\d+\s*[-–—]/.test(line)) return '<div><strong>' + e + '</strong></div>';
    return '<div>' + e + '</div>';
  }).join('');
}

// Build the card-title prefix from the plan card's title (strip "контент план" tails).
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
    let sections = parseVideoSections(card.content || card.description || '');
    const truncated = sections.length > MAX_VIDEOS;
    if (truncated) sections = sections.slice(0, MAX_VIDEOS);
    const videos = sections.map((s) => ({
      videoNumber: s.videoNumber,
      cardTitle: prefix + ' - Видео ' + s.videoNumber + ' - ' + s.title,
      publishDate: parsePublishDate(s.sectionText), // YYYY-MM-DD or null
      snippet: s.sectionText.split('\n').slice(1).join(' ').trim().slice(0, 180),
    }));
    res.json({ planTitle: card.title, count: videos.length, truncated, videos });
  } catch (err) {
    console.error('[kp-split preview]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/kp-split/create { cardId, destBoardId } — create the cards + steps.
router.post('/create', requireAuth, async (req, res) => {
  try {
    const { cardId, destBoardId } = req.body || {};
    if (!cardId || !destBoardId) return res.status(400).json({ error: 'cardId and destBoardId required' });
    const { token, account } = await getUserAuth(req.user.userId);
    const { projectId, tools } = await dock(token, account);

    // Only allow the destinations /init offered (Production / Post-Production) — guard
    // against a tampered/stale destBoardId landing cards in the wrong card table.
    const allowed = await resolveDestinations(token, tools);
    if (!allowed.some((d) => String(d.id) === String(destBoardId))) {
      return res.status(400).json({ error: 'Невалидна дестинация — избери Production или Post-Production.' });
    }

    const card = await bc.getCard(token, account, projectId, cardId);
    const prefix = planPrefix(card.title);
    let sections = parseVideoSections(card.content || card.description || '');
    if (!sections.length) return res.status(400).json({ error: 'Няма разпознати „Видео N - …" секции в плана.' });
    const truncated = sections.length > MAX_VIDEOS;
    if (truncated) sections = sections.slice(0, MAX_VIDEOS);

    // Find the "Разпределение" (Triage) column in the destination board.
    const destTable = await bc.getCardTable(token, account, projectId, destBoardId);
    const target = (destTable.lists || []).find((l) => /разпределение/i.test(l.title || ''))
      || (destTable.lists || []).find((l) => /Triage/i.test(l.type || ''));
    if (!target) return res.status(400).json({ error: 'Не намерих колона „Разпределение" в избраната дъска.' });

    // Idempotency: skip any card whose title already exists in the target column
    // (protects against re-splitting the same plan or repeated "Видео N" lines).
    const existing = await bc.getColumnCards(token, account, projectId, target.id);
    const seen = new Set(existing.map((c) => (c.title || '').trim()));

    const created = [], errors = [], skipped = [];
    for (const s of sections) {
      const title = (prefix + ' - Видео ' + s.videoNumber + ' - ' + s.title).trim();
      if (seen.has(title)) { skipped.push(title); continue; }
      seen.add(title);
      const publishDate = parsePublishDate(s.sectionText); // YYYY-MM-DD or null
      try {
        const newCard = await bc.createCard(token, account, projectId, target.id, {
          title, content: textToHtml(s.sectionText), due_on: publishDate || undefined,
        });
        for (const stepTitle of VIDEO_STEPS) {
          const stepDate = publishDate ? subtractWorkingDays(publishDate, STEP_OFFSETS[stepTitle]) : undefined;
          try { await bc.createStep(token, account, projectId, newCard.id, { title: stepTitle, due_on: stepDate }); }
          catch (e) { console.warn('[kp-split] step failed', stepTitle, e.message); }
        }
        created.push({ id: newCard.id, title: newCard.title, url: newCard.app_url, publishDate: publishDate || null });
      } catch (e) {
        errors.push({ title, error: e.message });
      }
    }
    res.json({ created, errors, skipped, truncated, board: destTable.title, column: target.title });
  } catch (err) {
    console.error('[kp-split create]', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
