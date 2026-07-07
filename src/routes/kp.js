const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { query, queryOne, execute } = require('../db/pool');
const kpc = require('../services/kp-create');
const agg = require('../services/bc-aggregate');
const { getUserAuth, getServiceAuth } = require('../services/basecamp-token');

// Resolve a Basecamp auth for КП operations: the logged-in user's token first
// (Венци: инструментите действат като човека), the ThePactAlerts bot as fallback
// so the page still works for profiles without a Basecamp connection.
async function kpAuth(userId, preferBot) {
  if (!preferBot && userId) {
    try { return await getUserAuth(userId); }
    catch (e) { if (e.code !== 'NO_USER_TOKEN') throw e; }
  }
  return getServiceAuth();
}

function addWorkingDays(date, days) {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

const subtractWorkingDays = kpc.subtractWorkingDaysSimple;
const toDateStr = kpc.toDateStr;
const toBgDate = kpc.toBgDate;

// Parses "Видео N - Title" sections from HTML/plain card content
function parseVideoSectionsFromHtml(htmlContent) {
  if (!htmlContent) return [];
  const text = htmlContent
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const sections = [];
  const lines = text.split('\n').map(l => l.trim());
  let currentSection = null;
  let currentLines = [];

  for (const line of lines) {
    const match = line.match(/^Видео\s+(\d+)\s*[-–—]\s*(.+)$/);
    if (match) {
      if (currentSection) sections.push({ ...currentSection, sectionText: currentLines.join('\n') });
      currentSection = { videoNumber: parseInt(match[1]), title: match[2].trim() };
      currentLines = [line];
    } else if (currentSection) {
      currentLines.push(line);
    }
  }
  if (currentSection) sections.push({ ...currentSection, sectionText: currentLines.join('\n') });
  return sections;
}

// Extracts "Дата за публикуване: DD.MM.YYYY" from a section's text
function parsePublishDateFromSection(sectionText) {
  if (!sectionText) return null;
  const match = sectionText.match(/Дата за публикуване\s*:\s*(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (!match) return null;
  const day = parseInt(match[1]), month = parseInt(match[2]) - 1, year = parseInt(match[3]);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return new Date(year, month, day);
}

// KP video card steps — tied to production date fields
const VIDEO_CARD_STEPS = [
  { title: 'Видеограф - Приключен запис', dateField: 'filming' },
  { title: 'Монтажист - Приключен монтаж', dateField: 'editing' },
  { title: 'Акаунт - Обратна връзка от клиент', dateField: 'editing' },
  { title: 'Монтажист - Корекции / финализиране монтаж', dateField: 'upload' },
  { title: 'Акаунт - Изпращане / Качване', dateField: 'upload' },
];

/**
 * Load KP production day offsets from settings
 * Returns { brainstorm: 10, filming: 7, editing: 5, upload: 1 }
 */
async function loadKpDayOffsets() {
  const defaults = { brainstorm: 10, filming: 7, editing: 5, upload: 1 };
  try {
    const rows = await query("SELECT key, value FROM settings WHERE key LIKE 'kp_days_%'");
    for (const r of rows) {
      const field = r.key.replace('kp_days_', '');
      if (defaults.hasOwnProperty(field)) {
        defaults[field] = parseInt(r.value) || defaults[field];
      }
    }
  } catch (err) { /* use defaults */ }
  return defaults;
}

/**
 * Calculate production dates from publish date + offsets
 */
function calcProductionDates(publishDate, offsets) {
  return {
    brainstorm_date: subtractWorkingDays(publishDate, offsets.brainstorm).toISOString().split('T')[0],
    filming_date: subtractWorkingDays(publishDate, offsets.filming).toISOString().split('T')[0],
    editing_date: subtractWorkingDays(publishDate, offsets.editing).toISOString().split('T')[0],
    upload_date: subtractWorkingDays(publishDate, offsets.upload).toISOString().split('T')[0],
    publish_date: publishDate.toISOString().split('T')[0],
  };
}

// GET /api/kp/clients — clients + does each have an active КП card.
// With kp_bc_enabled the check runs against the Basecamp destination column
// (ONE cached board fetch for all clients); otherwise against the local kanban.
// Response: { clients: [...], bc: { enabled, boardTitle?, columnTitle?, error? } }
router.get('/clients', requireAuth, async (req, res) => {
  try {
    const clients = await query('SELECT * FROM kp_clients WHERE active = true ORDER BY name');
    const cfg = await kpc.loadKpConfig();

    // Auto-create date: X working days before next KP's first video (info column).
    const withAutoDate = clients.map((client) => {
      let auto_create_date = null;
      if (client.next_kp_date) {
        const nkd = new Date(toDateStr(client.next_kp_date) + 'T12:00:00');
        if (!isNaN(nkd.getTime())) {
          auto_create_date = toDateStr(subtractWorkingDays(nkd, cfg.daysBeforeNextKp));
        }
      }
      return { ...client, auto_create_date };
    });

    let bcMeta = { enabled: cfg.bcEnabled };
    let enriched;

    if (cfg.bcEnabled) {
      try {
        const auth = await kpAuth(req.user.userId);
        const dest = await kpc.resolveKpDestination(auth, cfg);
        const existing = await kpc.findExistingKpCards(auth, cfg, dest, withAutoDate);
        bcMeta = { enabled: true, boardTitle: dest.boardTitle, columnTitle: dest.columnTitle };
        enriched = withAutoDate.map((c) => {
          const hit = existing.get((c.name || '').toLowerCase());
          return { ...c, has_kp_card: !!hit, kp_card_id: null, kp_card_url: hit ? hit.url : null };
        });
      } catch (err) {
        console.error('[kp clients] Basecamp check failed:', err.message);
        bcMeta = { enabled: true, error: err.message };
        enriched = withAutoDate.map((c) => ({ ...c, has_kp_card: null, kp_card_id: null, kp_card_url: null }));
      }
    } else {
      enriched = await Promise.all(withAutoDate.map(async (client) => {
        let card;
        if (cfg.localColumnId) {
          card = await queryOne(
            `SELECT id FROM cards WHERE column_id = $1 AND archived_at IS NULL AND completed_at IS NULL AND title ILIKE $2 LIMIT 1`,
            [cfg.localColumnId, `%${client.name}%`]
          );
        } else {
          card = await queryOne(
            `SELECT c.id FROM cards c JOIN columns col ON c.column_id = col.id
             WHERE col.title ILIKE 'Измисляне' AND c.archived_at IS NULL AND c.completed_at IS NULL
               AND c.title ILIKE $1 LIMIT 1`,
            [`%${client.name}%`]
          );
        }
        return { ...client, has_kp_card: !!card, kp_card_id: card?.id || null, kp_card_url: null };
      }));
    }

    res.json({ clients: enriched, bc: bcMeta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kp/clients
router.post('/clients', requireAuth, async (req, res) => {
  try {
    const { name, videos_per_month, current_kp_number, first_publish_date, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const cfg = await kpc.loadKpConfig();
    const vidCount = videos_per_month || cfg.defaultVideos;
    let computedInterval = null, computedLast = null, computedNext = null;

    // Auto-compute dates if first_publish_date provided
    if (first_publish_date) {
      const dist = kpc.distributePublishDates(first_publish_date, vidCount, cfg.calendarWindow);
      computedInterval = Math.round(dist.interval);
      computedLast = toDateStr(dist.lastVideoDate);
      computedNext = toDateStr(dist.nextKpFirstDate);
    }

    const client = await queryOne(
      `INSERT INTO kp_clients (name, videos_per_month, publish_interval_days, current_kp_number, first_publish_date, last_video_date, next_kp_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, vidCount, computedInterval, current_kp_number || 1,
       first_publish_date || null, computedLast, computedNext, notes || null]
    );
    await execute(
      'INSERT INTO kp_audit_log (user_name, action, client_name, details) VALUES ($1,$2,$3,$4)',
      [req.user.name || 'Unknown', 'create_client', name, JSON.stringify(req.body)]
    );
    res.status(201).json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/kp/clients/:id
router.put('/clients/:id', requireAuth, async (req, res) => {
  try {
    const fields = ['name','videos_per_month','publish_interval_days','current_kp_number','first_publish_date','last_video_date','next_kp_date','notes'];
    const setClauses = ['updated_at = NOW()'];
    const params = [];
    let i = 1;
    for (const f of fields) {
      if (f in req.body) { setClauses.push(`${f} = $${i++}`); params.push(req.body[f] || null); }
    }
    params.push(req.params.id);
    const client = await queryOne(
      `UPDATE kp_clients SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`, params
    );
    if (!client) return res.status(404).json({ error: 'Not found' });
    await execute(
      'INSERT INTO kp_audit_log (user_name, action, client_name, details) VALUES ($1,$2,$3,$4)',
      [req.user.name || 'Unknown', 'update_client', client.name, JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/kp/clients/:id
router.delete('/clients/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const client = await queryOne('SELECT * FROM kp_clients WHERE id = $1', [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Not found' });
    await execute('UPDATE kp_clients SET active = false WHERE id = $1', [req.params.id]);
    await execute(
      'INSERT INTO kp_audit_log (user_name, action, client_name, details) VALUES ($1,$2,$3,$4)',
      [req.user.name || 'Unknown', 'delete_client', client.name, `id=${req.params.id}`]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kp/preview-dates?firstDate=YYYY-MM-DD&videoCount=N
router.get('/preview-dates', requireAuth, async (req, res) => {
  try {
    const { firstDate, videoCount } = req.query;
    if (!firstDate) return res.status(400).json({ error: 'firstDate required' });
    const cfg = await kpc.loadKpConfig();
    const count = parseInt(videoCount) || cfg.defaultVideos;
    const dist = kpc.distributePublishDates(firstDate, count, cfg.calendarWindow);
    res.json({
      dates: dist.dates.map(d => toDateStr(d)),
      datesBg: dist.dates.map(d => toBgDate(d)),
      interval: dist.interval,
      lastVideoDate: toDateStr(dist.lastVideoDate),
      nextKpFirstDate: toDateStr(dist.nextKpFirstDate),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kp/template
router.get('/template', requireAuth, async (req, res) => {
  try {
    const main = await queryOne('SELECT value FROM app_settings WHERE key = $1', ['kp_template']);
    const video = await queryOne('SELECT value FROM app_settings WHERE key = $1', ['kp_video_section_template']);
    res.json({
      template: main?.value || kpc.KP_DEFAULT_TEMPLATE,
      videoSection: video?.value || kpc.KP_VIDEO_SECTION_TEMPLATE
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/kp/template
router.put('/template', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.body.template) {
      await execute(
        'INSERT INTO app_settings (key, value, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
        ['kp_template', req.body.template]
      );
    }
    if (req.body.videoSection) {
      await execute(
        'INSERT INTO app_settings (key, value, updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
        ['kp_video_section_template', req.body.videoSection]
      );
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/kp/bc-options — admin: Basecamp boards + columns for the destination
// dropdowns in Админ → КП-Автоматизация (live from Basecamp, cached ~60s).
router.get('/bc-options', requireAuth, requireAdmin, async (req, res) => {
  try {
    const auth = await kpAuth(req.user.userId);
    const struct = await agg.loadStructure(auth.token, auth.account);
    res.json({
      boards: (struct.boards || []).map((b) => ({
        id: String(b.id),
        title: b.title,
        columns: (b.columns || []).map((c) => ({ id: String(c.id), title: c.title, isDone: !!c.isDone })),
      })),
    });
  } catch (err) {
    console.error('[kp bc-options]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/kp/bc-test — admin: resolve the configured destination and report it
// (no card is created — safe "провери връзката" button).
router.post('/bc-test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const cfg = await kpc.loadKpConfig();
    const auth = await kpAuth(req.user.userId, cfg.actor === 'bot');
    const dest = await kpc.resolveKpDestination(auth, cfg);
    res.json({
      ok: true,
      board: dest.boardTitle,
      column: dest.columnTitle,
      titleExample: kpc.renderKpTitle(cfg, 'Клиент', 5),
      dueDays: cfg.dueDays,
    });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
});

// POST /api/kp/create-card/:clientId — create the next КП card for the client.
// Destination (Basecamp / local) and all texts come from the admin settings.
router.post('/create-card/:clientId', requireAuth, async (req, res) => {
  try {
    const client = await queryOne('SELECT * FROM kp_clients WHERE id = $1', [req.params.clientId]);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const rawDate = req.body.firstPublishDate || client.next_kp_date || client.first_publish_date;
    if (!rawDate) return res.status(400).json({ error: 'Няма зададена дата за публикуване' });
    // Normalize: pg DATE columns return as JS Date objects; stringify + strip time part
    const firstPublishDate = (rawDate instanceof Date ? rawDate.toISOString() : String(rawDate)).split('T')[0];

    const cfg = await kpc.loadKpConfig();
    let auth = null;
    if (cfg.bcEnabled) auth = await kpAuth(req.user.userId, cfg.actor === 'bot');

    const result = await kpc.createKpForClient({
      client, firstPublishDate, cfg, auth, creatorId: req.user.userId,
    });

    await execute(
      'INSERT INTO kp_audit_log (user_name, action, client_name, details) VALUES ($1,$2,$3,$4)',
      [req.user.name || 'Unknown', 'create_kp_card', client.name,
       result.basecamp
         ? `Basecamp карта: ${result.title} → ${result.board} / ${result.column} (${result.url})`
         : `Card id=${result.cardId}: ${result.title}`]
    );

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('KP create-card error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kp/generate-video-cards/:cardId — parse KP card content and create video task cards
router.post('/generate-video-cards/:cardId', requireAuth, async (req, res) => {
  try {
    const cardId = parseInt(req.params.cardId);
    const card = await queryOne('SELECT * FROM cards WHERE id = $1 AND archived_at IS NULL', [cardId]);
    if (!card) return res.status(404).json({ error: 'Card not found' });

    // Parse video sections from card HTML content
    const videoSections = parseVideoSectionsFromHtml(card.content || '');
    if (videoSections.length === 0) {
      return res.status(400).json({ error: 'Няма намерени видео секции. Форматирайте ги като "Видео 1 - Заглавие" в съдържанието на картата.' });
    }

    // Find target column: setting (by ID) first, then fall back to name search
    let targetCol = null;
    const razpredelenieSetting = await queryOne("SELECT value FROM settings WHERE key = 'kp_razpredelenie_column_id'");
    const razpredelenieColId = razpredelenieSetting?.value ? parseInt(razpredelenieSetting.value) : null;
    if (razpredelenieColId) {
      targetCol = await queryOne('SELECT id, board_id FROM columns WHERE id = $1', [razpredelenieColId]);
    }
    if (!targetCol) {
      targetCol = await queryOne(
        `SELECT col.id, col.board_id FROM columns col WHERE col.title ILIKE 'Разпределение' AND col.board_id = $1 LIMIT 1`,
        [card.board_id]
      );
    }
    if (!targetCol) {
      targetCol = await queryOne(
        `SELECT col.id, col.board_id FROM columns col WHERE col.title ILIKE 'Разпределение' LIMIT 1`
      );
    }
    if (!targetCol) {
      return res.status(400).json({ error: 'Не е намерена целева колона. Настройте я в Администрация → Настройки → КП Автоматизация.' });
    }

    const { broadcast } = require('../ws/broadcast');
    const createdCards = [];

    // Load configurable day offsets from admin settings
    const offsets = await loadKpDayOffsets();

    for (const section of videoSections) {
      const publishDate = parsePublishDateFromSection(section.sectionText);
      const videoCardTitle = `${card.client_name || card.title} КП-${card.kp_number || '?'} - Видео ${section.videoNumber} - ${section.title}`;

      // Calculate all production dates from publish date
      const prodDates = publishDate ? calcProductionDates(publishDate, offsets) : {};

      const maxPos = await queryOne(
        'SELECT COALESCE(MAX(position), -1) + 1 as pos FROM cards WHERE column_id = $1',
        [targetCol.id]
      );

      // KP cards: NO due_on, only production dates
      const videoCard = await queryOne(
        `INSERT INTO cards (board_id, column_id, title, content, publish_date, brainstorm_date, filming_date, editing_date, upload_date, creator_id, client_name, kp_number, video_number, video_title, parent_id, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
        [
          targetCol.board_id, targetCol.id, videoCardTitle,
          section.sectionText ? kpc.textToHtml(section.sectionText) : null,
          prodDates.publish_date || null,
          prodDates.brainstorm_date || null,
          prodDates.filming_date || null,
          prodDates.editing_date || null,
          prodDates.upload_date || null,
          req.user.userId,
          card.client_name, card.kp_number, section.videoNumber, section.title,
          cardId, maxPos.pos
        ]
      );

      // Create 5 steps (no due dates on steps)
      for (let i = 0; i < VIDEO_CARD_STEPS.length; i++) {
        await execute(
          'INSERT INTO card_steps (card_id, title, position) VALUES ($1, $2, $3)',
          [videoCard.id, VIDEO_CARD_STEPS[i].title, i]
        );
      }

      createdCards.push(videoCard);
      broadcast({ type: 'card:created', card: videoCard });
    }

    await execute(
      'INSERT INTO kp_audit_log (user_name, action, client_name, details) VALUES ($1,$2,$3,$4)',
      [req.user.name || 'Unknown', 'generate_video_cards', card.client_name || card.title,
       `${createdCards.length} video cards from card ${cardId} (${card.title})`]
    );

    res.json({ ok: true, count: createdCards.length, cards: createdCards.map(c => ({ id: c.id, title: c.title })) });
  } catch (err) {
    console.error('Generate video cards error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kp/audit
router.get('/audit', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await query('SELECT * FROM kp_audit_log ORDER BY created_at DESC LIMIT 100');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
