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
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
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

const VIDEO_CARD_STEPS = [
  { title: 'Сценарий и концепция', daysBeforePublish: 10 },
  { title: 'Одобрение на концепция', daysBeforePublish: 9 },
  { title: 'Подготовка за снимане', daysBeforePublish: 8 },
  { title: 'Снимане', daysBeforePublish: 7 },
  { title: 'Преглед на суров материал', daysBeforePublish: 6 },
  { title: 'Груб монтаж', daysBeforePublish: 6 },
  { title: 'Финален монтаж', daysBeforePublish: 5 },
  { title: 'Вътрешен преглед', daysBeforePublish: 5 },
  { title: 'Корекции след вътрешен преглед', daysBeforePublish: 4 },
  { title: 'Клиентски преглед', daysBeforePublish: 3 },
  { title: 'Корекции след клиент', daysBeforePublish: 3 },
  { title: 'Финално одобрение', daysBeforePublish: 2 },
  { title: 'Озвучаване / Музика', daysBeforePublish: 2 },
  { title: 'Субтитри и текст', daysBeforePublish: 1 },
  { title: 'Export и форматиране', daysBeforePublish: 1 },
  { title: 'Качване в платформата', daysBeforePublish: 1 },
  { title: 'Публикуване', daysBeforePublish: 0 },
];

// GET /api/kp/clients
router.get('/clients', requireAuth, async (req, res) => {
  try {
    const clients = await query('SELECT * FROM kp_clients WHERE active = true ORDER BY name');

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
      return { ...client, has_kp_card: !!card };
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kp/clients
router.post('/clients', requireAuth, async (req, res) => {
  try {
    const { name, videos_per_month, publish_interval_days, current_kp_number, first_publish_date, last_video_date, next_kp_date, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const client = await queryOne(
      `INSERT INTO kp_clients (name, videos_per_month, publish_interval_days, current_kp_number, first_publish_date, last_video_date, next_kp_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, videos_per_month || 10, publish_interval_days || 3, current_kp_number || 1,
       first_publish_date || null, last_video_date || null, next_kp_date || null, notes || null]
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
    const interval = client.publish_interval_days || 3;
    const kpNumber = client.current_kp_number || 1;

    // Generate publish dates
    const publishDates = [];
    for (let i = 0; i < videoCount; i++) {
      const d = new Date(firstPublishDate + 'T12:00:00');
      d.setDate(d.getDate() + i * interval);
      publishDates.push(d.toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' }));
    }

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

    // Due date: 14 days before first publish
    const dueDate = new Date(firstPublishDate + 'T12:00:00');
    dueDate.setDate(dueDate.getDate() - 14);
    const dueDateStr = dueDate.toISOString().split('T')[0];

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

    // Create the card
    const card = await queryOne(
      `INSERT INTO cards (board_id, column_id, title, content, due_on, creator_id, client_name, kp_number, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [izmislianeCol.board_id, izmislianeCol.id, title, content, dueDateStr,
       req.user.userId, client.name, kpNumber, maxPos.pos]
    );

    // Update client: increment KP number, update dates
    const lastVideoDate = new Date(firstPublishDate + 'T12:00:00');
    lastVideoDate.setDate(lastVideoDate.getDate() + (videoCount - 1) * interval);
    const nextKpFirst = new Date(lastVideoDate);
    nextKpFirst.setDate(nextKpFirst.getDate() + interval);

    await execute(
      `UPDATE kp_clients SET current_kp_number = $1, first_publish_date = $2, last_video_date = $3, next_kp_date = $4, updated_at = NOW()
       WHERE id = $5`,
      [kpNumber + 1, nextKpFirst.toISOString().split('T')[0],
       lastVideoDate.toISOString().split('T')[0], nextKpFirst.toISOString().split('T')[0], client.id]
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

    for (const section of videoSections) {
      const publishDate = parsePublishDateFromSection(section.sectionText);
      const videoCardTitle = `${card.client_name || card.title} КП-${card.kp_number || '?'} - Видео ${section.videoNumber} - ${section.title}`;

      const maxPos = await queryOne(
        'SELECT COALESCE(MAX(position), -1) + 1 as pos FROM cards WHERE column_id = $1',
        [targetCol.id]
      );

      const videoCard = await queryOne(
        `INSERT INTO cards (board_id, column_id, title, content, due_on, publish_date, creator_id, client_name, kp_number, video_number, video_title, parent_id, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [
          targetCol.board_id, targetCol.id, videoCardTitle,
          section.sectionText || null,
          publishDate ? publishDate.toISOString().split('T')[0] : null,
          publishDate ? publishDate.toISOString().split('T')[0] : null,
          req.user.userId,
          card.client_name, card.kp_number, section.videoNumber, section.title,
          cardId, maxPos.pos
        ]
      );

      // Create steps with calculated due dates
      for (let i = 0; i < VIDEO_CARD_STEPS.length; i++) {
        const stepDef = VIDEO_CARD_STEPS[i];
        let stepDueDate = null;
        if (publishDate !== null) {
          if (stepDef.daysBeforePublish === 0) {
            stepDueDate = publishDate.toISOString().split('T')[0];
          } else {
            const d = subtractWorkingDays(publishDate, stepDef.daysBeforePublish);
            stepDueDate = d.toISOString().split('T')[0];
          }
        }
        await execute(
          'INSERT INTO card_steps (card_id, title, due_on, position) VALUES ($1, $2, $3, $4)',
          [videoCard.id, stepDef.title, stepDueDate, i]
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
