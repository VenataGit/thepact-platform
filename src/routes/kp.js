const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { query, queryOne, execute } = require('../db/pool');

const KP_VIDEO_SECTION_TEMPLATE = `Видео {N} - ХХХ
/Участници - ХХХ/
/Локация - ХХХ/
/Необходими ресурси - ХХХ/

Описание:
ХХХ


Копи: ХХХ
Дата за публикуване: ХХХ
Контент криейтър: ХХХ`;

const KP_DEFAULT_TEMPLATE = `Дата за публикуване на първо видео: {first_publish_date}

Допълнителна информация от акаунт – ХХХ

{video_sections}`;

// Convert plain-text (with \n) to Trix-compatible HTML so card content renders properly.
// Lines matching "Видео N - ..." are marked with "Злато" highlight (background-color)
// using the same marking system as the Trix editor color picker.
function textToHtml(text) {
  if (!text) return '';
  return text.split('\n').map(line => {
    const esc = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if (esc === '') return '<div><br></div>';
    if (/^Видео\s+\d+\s*[-–—]/.test(line)) {
      return `<div><strong><span style="background-color:#9B7D44;color:#fff">` + esc + `</span></strong></div>`;
    }
    return `<div>${esc}</div>`;
  }).join('');
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

function subtractWorkingDays(date, days) {
  const result = new Date(date);
  let subtracted = 0;
  while (subtracted < days) {
    result.setDate(result.getDate() - 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) subtracted++;
  }
  return result;
}

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

/**
 * Load KP schedule settings from DB
 */
async function loadKpScheduleSettings() {
  const defaults = { calendarWindow: 30, daysBeforeNextKp: 15 };
  try {
    const rows = await query("SELECT key, value FROM settings WHERE key IN ('kp_calendar_window', 'kp_days_before_next_kp')");
    for (const r of rows) {
      if (r.key === 'kp_calendar_window') defaults.calendarWindow = parseInt(r.value) || 30;
      if (r.key === 'kp_days_before_next_kp') defaults.daysBeforeNextKp = parseInt(r.value) || 15;
    }
  } catch (err) { /* use defaults */ }
  return defaults;
}

/**
 * Distribute N videos evenly across a calendar window.
 * Returns { dates[], interval, lastVideoDate, nextKpFirstDate }
 */
function distributePublishDates(firstDateStr, videoCount, calendarWindow) {
  const first = new Date(firstDateStr + 'T12:00:00');
  if (videoCount <= 1) {
    return {
      dates: [first],
      interval: calendarWindow,
      lastVideoDate: first,
      nextKpFirstDate: new Date(first.getTime() + calendarWindow * 86400000),
    };
  }
  const gap = calendarWindow / (videoCount - 1);
  const dates = [];
  for (let i = 0; i < videoCount; i++) {
    const d = new Date(first);
    d.setDate(d.getDate() + Math.round(i * gap));
    dates.push(d);
  }
  const lastVideoDate = dates[dates.length - 1];
  const nextKpFirst = new Date(lastVideoDate);
  nextKpFirst.setDate(nextKpFirst.getDate() + Math.round(gap));
  return { dates, interval: Math.round(gap * 10) / 10, lastVideoDate, nextKpFirstDate: nextKpFirst };
}

function toDateStr(d) {
  return d instanceof Date ? d.toISOString().split('T')[0] : String(d).split('T')[0];
}
function toBgDate(d) {
  return d.toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// GET /api/kp/clients
router.get('/clients', requireAuth, async (req, res) => {
  try {
    const clients = await query('SELECT * FROM kp_clients WHERE active = true ORDER BY name');
    const schedSettings = await loadKpScheduleSettings();

    // Resolve target column by setting (ID) or fall back to name search
    const izmislianeColIdSetting = await queryOne("SELECT value FROM settings WHERE key = 'kp_izmislyane_column_id'");
    const izmislianeColId = izmislianeColIdSetting?.value ? parseInt(izmislianeColIdSetting.value) : null;

    const enriched = await Promise.all(clients.map(async (client) => {
      let card;
      if (izmislianeColId) {
        card = await queryOne(
          `SELECT id FROM cards WHERE column_id = $1 AND archived_at IS NULL AND completed_at IS NULL AND title ILIKE $2 LIMIT 1`,
          [izmislianeColId, `%${client.name}%`]
        );
      } else {
        card = await queryOne(
          `SELECT c.id FROM cards c JOIN columns col ON c.column_id = col.id
           WHERE col.title ILIKE 'Измисляне' AND c.archived_at IS NULL AND c.completed_at IS NULL
             AND c.title ILIKE $1 LIMIT 1`,
          [`%${client.name}%`]
        );
      }
      // Compute auto-create date: X working days before next KP's first video
      let auto_create_date = null;
      if (client.next_kp_date) {
        const nkd = new Date(toDateStr(client.next_kp_date) + 'T12:00:00');
        if (!isNaN(nkd.getTime())) {
          auto_create_date = toDateStr(subtractWorkingDays(nkd, schedSettings.daysBeforeNextKp));
        }
      }
      return { ...client, has_kp_card: !!card, kp_card_id: card?.id || null, auto_create_date };
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kp/clients
router.post('/clients', requireAuth, async (req, res) => {
  try {
    const { name, videos_per_month, current_kp_number, first_publish_date, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const vidCount = videos_per_month || 10;
    let computedInterval = null, computedLast = null, computedNext = null;

    // Auto-compute dates if first_publish_date provided
    if (first_publish_date) {
      const schedSettings = await loadKpScheduleSettings();
      const dist = distributePublishDates(first_publish_date, vidCount, schedSettings.calendarWindow);
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
    const count = parseInt(videoCount) || 10;
    const schedSettings = await loadKpScheduleSettings();
    const dist = distributePublishDates(firstDate, count, schedSettings.calendarWindow);
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
      template: main?.value || KP_DEFAULT_TEMPLATE,
      videoSection: video?.value || KP_VIDEO_SECTION_TEMPLATE
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

// POST /api/kp/create-card/:clientId — create KP card in the platform
router.post('/create-card/:clientId', requireAuth, async (req, res) => {
  try {
    const client = await queryOne('SELECT * FROM kp_clients WHERE id = $1', [req.params.clientId]);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const rawDate = req.body.firstPublishDate || client.next_kp_date || client.first_publish_date;
    if (!rawDate) return res.status(400).json({ error: 'Няма зададена дата за публикуване' });
    // Normalize: pg DATE columns return as JS Date objects; stringify + strip time part
    const firstPublishDate = (rawDate instanceof Date ? rawDate.toISOString() : String(rawDate)).split('T')[0];

    const videoCount = client.videos_per_month || 10;
    const kpNumber = client.current_kp_number || 1;

    // Distribute publish dates evenly across calendar window
    const schedSettings = await loadKpScheduleSettings();
    const dist = distributePublishDates(firstPublishDate, videoCount, schedSettings.calendarWindow);
    const publishDates = dist.dates.map(d => toBgDate(d));

    // Get templates
    const mainTplRow = await queryOne('SELECT value FROM app_settings WHERE key = $1', ['kp_template']);
    const videoTplRow = await queryOne('SELECT value FROM app_settings WHERE key = $1', ['kp_video_section_template']);
    const mainTemplate = mainTplRow?.value || KP_DEFAULT_TEMPLATE;
    const videoSectionTpl = videoTplRow?.value || KP_VIDEO_SECTION_TEMPLATE;

    // Build video sections
    const videoSections = [];
    for (let i = 1; i <= videoCount; i++) {
      videoSections.push(videoSectionTpl.replace(/\{N\}/g, i));
    }

    // Build content
    let content = mainTemplate
      .replace('{first_publish_date}', publishDates[0] || '')
      .replace('{video_sections}', videoSections.join('\n\n\n'));

    // Add publish schedule
    const scheduleLines = publishDates.join('\n');
    content = content.replace(
      /Дата за публикуване на първо видео:.*$/m,
      `Дата за публикуване на първо видео: ${publishDates[0] || ''}\n\nДати за публикуване на видеа:\n${scheduleLines}`
    );

    const title = `${client.name} КП-${kpNumber}`;

    // Calculate brainstorm_date from the first publish date so the KP card
    // shows up with the correct "Дати Измисляне" deadline in the board.
    const offsets = await loadKpDayOffsets();
    const firstPubDate = new Date(firstPublishDate + 'T12:00:00');
    const brainstormDate = subtractWorkingDays(firstPubDate, offsets.brainstorm).toISOString().split('T')[0];

    // Find target column: setting (by ID) first, then fall back to name search
    let izmislianeCol = null;
    const izmislianeColIdSetting = await queryOne("SELECT value FROM settings WHERE key = 'kp_izmislyane_column_id'");
    const izmislianeColId = izmislianeColIdSetting?.value ? parseInt(izmislianeColIdSetting.value) : null;
    if (izmislianeColId) {
      izmislianeCol = await queryOne('SELECT id, board_id FROM columns WHERE id = $1', [izmislianeColId]);
    }
    if (!izmislianeCol) {
      izmislianeCol = await queryOne(
        `SELECT col.id, col.board_id FROM columns col WHERE col.title ILIKE 'Измисляне' LIMIT 1`
      );
    }
    if (!izmislianeCol) return res.status(400).json({ error: 'Не е намерена целева колона. Настройте я в Администрация → Настройки → КП Автоматизация.' });

    // Get max position
    const maxPos = await queryOne(
      'SELECT COALESCE(MAX(position), -1) + 1 as pos FROM cards WHERE column_id = $1',
      [izmislianeCol.id]
    );

    // Create the card with brainstorm_date so it shows in "Дати Измисляне"
    const card = await queryOne(
      `INSERT INTO cards (board_id, column_id, title, content, creator_id, client_name, kp_number, position, brainstorm_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [izmislianeCol.board_id, izmislianeCol.id, title, textToHtml(content),
       req.user.userId, client.name, kpNumber, maxPos.pos, brainstormDate]
    );

    // Update client: increment KP number, update dates from distribution
    await execute(
      `UPDATE kp_clients SET current_kp_number = $1, first_publish_date = $2, last_video_date = $3, next_kp_date = $4, publish_interval_days = $5, updated_at = NOW()
       WHERE id = $6`,
      [kpNumber + 1, toDateStr(dist.nextKpFirstDate),
       toDateStr(dist.lastVideoDate), toDateStr(dist.nextKpFirstDate), Math.round(dist.interval), client.id]
    );

    await execute(
      'INSERT INTO kp_audit_log (user_name, action, client_name, details) VALUES ($1,$2,$3,$4)',
      [req.user.name || 'Unknown', 'create_kp_card', client.name, `Card id=${card.id}: ${title}`]
    );

    res.json({ ok: true, cardId: card.id, title });
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
          section.sectionText ? textToHtml(section.sectionText) : null,
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
