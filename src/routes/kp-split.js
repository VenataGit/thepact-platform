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

const MAX_VIDEOS = 30; // hard safety cap so a malformed plan can't flood the board
const MAX_ATTACH_BYTES = 200 * 1024 * 1024; // skip media larger than this

// The 3 milestone steps + working days BEFORE the publish date (same offsets as
// bc-date-sync.js, so dates stay consistent and the webhook re-sync is idempotent).
const STEP_OFFSETS = {
  'Видеограф - Насрочване на снимачен ден': 11,
  'Монтажист - Приключен монтаж': 6,
  'PM - Насрочване/Качване в социални мрежи': 1,
};
const VIDEO_STEPS = Object.keys(STEP_OFFSETS);

const escAttr = (s) => (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// --- parsing (attachment-aware) ---
// Media is pulled out as whole-line placeholder tokens ("A<idx>") so each can be
// re-uploaded and re-embedded in place; text is preserved. Headings ("Видео N - …")
// may sit mid-paragraph (Basecamp <br>-separates them), so splitting is line-based
// after a tag→text pass. Placeholders are matched LINE-ANCHORED to avoid collisions.
const ATTACH_RE = /<bc-attachment\b[^>]*>[\s\S]*?<\/bc-attachment>/gi;

function attrOf(html, name) {
  const m = html.match(new RegExp('\\b' + name + '="([^"]*)"', 'i'));
  return m ? m[1] : '';
}
function parseAttachment(html) {
  return {
    sgid: attrOf(html, 'sgid'),
    href: attrOf(html, 'href') || attrOf(html, 'url'), // href = the real download URL (in `description`)
    contentType: attrOf(html, 'content-type'),
    filename: attrOf(html, 'filename') || attrOf(html, 'alt') || 'file',
    caption: attrOf(html, 'caption'),
    filesize: parseInt(attrOf(html, 'filesize') || '0', 10),
  };
}
function htmlToText(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// Returns { sections:[{videoNumber,title,sectionText}], attachments:[{href,...}] }.
function parsePlan(html) {
  const attachments = [];
  const withPlaceholders = (html || '').replace(ATTACH_RE, (m) => {
    const i = attachments.length;
    attachments.push(parseAttachment(m));
    return '\nA' + i + '\n';
  });
  const sections = [];
  let cur = null, curLines = [];
  for (const raw of htmlToText(withPlaceholders).split('\n')) {
    const line = raw.trim();
    const m = line.match(/^Видео\s+(\d+)\s*[-–—]\s*(.+)$/);
    if (m) {
      if (cur) sections.push({ ...cur, sectionText: curLines.join('\n') });
      cur = { videoNumber: parseInt(m[1], 10), title: m[2].trim() };
      curLines = [line];
    } else if (cur) { curLines.push(raw); }
  }
  if (cur) sections.push({ ...cur, sectionText: curLines.join('\n') });
  return { sections, attachments };
}

// Attachment indices a section references (placeholders are whole lines).
function attachmentIdxs(sectionText) {
  const out = [];
  sectionText.split('\n').forEach((line) => {
    const m = line.trim().match(/^A(\d+)$/);
    if (m) out.push(parseInt(m[1], 10));
  });
  return out;
}

// Build a card's content HTML, swapping each placeholder line for its re-uploaded
// <bc-attachment> tag (attachMap: idx -> tag HTML, '' when the media couldn't be carried).
function buildContent(sectionText, attachMap) {
  return sectionText.split('\n').map((line) => {
    const t = line.trim();
    const pm = t.match(/^A(\d+)$/);
    if (pm) return attachMap[pm[1]] || '';
    if (t === '') return '<div><br></div>';
    const e = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (/^Видео\s+\d+\s*[-–—]/.test(t)) return '<div><strong>' + e + '</strong></div>';
    return '<div>' + e + '</div>';
  }).join('');
}

function snippetOf(sectionText) {
  return sectionText.split('\n').filter((l) => !/^A\d+$/.test(l.trim())).slice(1).join(' ').trim().slice(0, 180);
}

// "Дата на/за публикуване - DD.MM.YYYY" → YYYY-MM-DD.
function parsePublishDate(text) {
  if (!text) return null;
  const m = text.match(/Дата\s+(?:на|за)\s+публикуване\s*[-–—:]?\s*(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/i);
  if (!m) return null;
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
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
function planHtml(card) { return card.description || card.content || ''; }

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
    let { sections } = parsePlan(planHtml(card));
    const truncated = sections.length > MAX_VIDEOS;
    if (truncated) sections = sections.slice(0, MAX_VIDEOS);
    const videos = sections.map((s) => ({
      videoNumber: s.videoNumber,
      cardTitle: prefix + ' - Видео ' + s.videoNumber + ' - ' + s.title,
      publishDate: parsePublishDate(s.sectionText),
      mediaCount: attachmentIdxs(s.sectionText).length,
      snippet: snippetOf(s.sectionText),
    }));
    res.json({ planTitle: card.title, count: videos.length, truncated, videos });
  } catch (err) {
    console.error('[kp-split preview]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/kp-split/create { cardId, destBoardId } — create the cards + steps + media.
router.post('/create', requireAuth, async (req, res) => {
  try {
    const { cardId, destBoardId } = req.body || {};
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
    let { sections, attachments } = parsePlan(planHtml(card));
    if (!sections.length) return res.status(400).json({ error: 'Няма разпознати „Видео N - …" секции в плана.' });
    const truncated = sections.length > MAX_VIDEOS;
    if (truncated) sections = sections.slice(0, MAX_VIDEOS);

    // Find the "Разпределение" (Triage) column in the destination board.
    const destTable = await bc.getCardTable(token, account, projectId, destBoardId);
    const target = (destTable.lists || []).find((l) => /разпределение/i.test(l.title || ''))
      || (destTable.lists || []).find((l) => /Triage/i.test(l.type || ''));
    if (!target) return res.status(400).json({ error: 'Не намерих колона „Разпределение" в избраната дъска.' });

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
      const publishDate = parsePublishDate(s.sectionText);
      const idxs = attachmentIdxs(s.sectionText);
      try {
        const attachMap = {};
        for (const idx of idxs) attachMap[idx] = await attachTagFor(idx);
        const content = buildContent(s.sectionText, attachMap);
        const newCard = await bc.createCard(token, account, projectId, target.id, { title, content, due_on: publishDate || undefined });
        for (const stepTitle of VIDEO_STEPS) {
          const stepDate = publishDate ? subtractWorkingDays(publishDate, STEP_OFFSETS[stepTitle]) : undefined;
          try { await bc.createStep(token, account, projectId, newCard.id, { title: stepTitle, due_on: stepDate }); }
          catch (e) { console.warn('[kp-split] step failed', stepTitle, e.message); }
        }
        created.push({ id: newCard.id, title: newCard.title, url: newCard.app_url, publishDate: publishDate || null, media: idxs.length });
      } catch (e) {
        errors.push({ title, error: e.message });
      }
    }
    res.json({ created, errors, skipped, truncated, mediaErrors, board: destTable.title, column: target.title });
  } catch (err) {
    console.error('[kp-split create]', err.message);
    res.status(502).json({ error: err.message });
  }
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
