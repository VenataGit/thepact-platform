// CRM (#/crm) — придобиването на нови клиенти.
//
// Достъпът е поименен, не по роля: пълните админи влизат по право, всички останали
// само ако някой ги е пуснал (`crm_access`). Пуснатият може да пуска нататък, а
// отнемането маха и хората под него. Затова тук НЯМА requireAuth-only маршрут —
// всичко минава през requireCrm.
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { query, queryOne, execute } = require('../db/pool');
const crm = require('../services/crm');
const { broadcast } = require('../ws/broadcast');
const { sendPushToUser } = require('../services/push');

// ---------- достъп ----------

async function requireCrm(req, res, next) {
  try {
    const acc = await crm.getAccess(req.user);
    if (!acc.access) return res.status(403).json({ error: 'Нямаш достъп до CRM. Поискай го от Венци или от някой с достъп.' });
    req.crm = acc;
    next();
  } catch (err) {
    console.error('[crm access]', err.message);
    res.status(500).json({ error: 'Проверката на достъпа не мина.' });
  }
}

// GET /api/crm/me — фронтендът пита само това, за да реши дали да показва инструмента.
router.get('/me', requireAuth, async (req, res) => {
  try {
    res.json(await crm.getAccess(req.user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- четене ----------

const STAGE_COLS = 'id, title, position, kind, probability, rot_days, color, exit_rule';
const DEAL_COLS = `d.*, u.name AS owner_name, u.avatar_url AS owner_avatar`;

async function loadStages() {
  return query(`SELECT ${STAGE_COLS} FROM crm_stages ORDER BY position ASC, id ASC`);
}

async function loadDeals(includeArchived) {
  return query(
    `SELECT ${DEAL_COLS} FROM crm_deals d
       LEFT JOIN users u ON u.id = d.owner_id
      ${includeArchived ? '' : 'WHERE d.archived = FALSE'}
      ORDER BY d.updated_at DESC`
  );
}

// GET /api/crm/board — всичко за екрана наведнъж (етапи, сделки, показатели, хора).
router.get('/board', requireAuth, requireCrm, async (req, res) => {
  try {
    const includeArchived = req.query.archived === '1';
    const [stages, deals, users] = await Promise.all([
      loadStages(),
      loadDeals(includeArchived),
      query('SELECT id, name, avatar_url FROM users WHERE is_active IS NOT FALSE ORDER BY name'),
    ]);
    res.json({
      stages, deals, users,
      metrics: crm.computeMetrics(deals, stages),
      funnel: crm.funnel(stages, deals),
      access: req.crm,
    });
  } catch (err) {
    console.error('[crm board]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/deals/:id — сделката + цялата ѝ хронология.
router.get('/deals/:id', requireAuth, requireCrm, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deal = await queryOne(
      `SELECT ${DEAL_COLS} FROM crm_deals d LEFT JOIN users u ON u.id = d.owner_id WHERE d.id = $1`,
      [id]
    );
    if (!deal) return res.status(404).json({ error: 'Сделката не е намерена.' });
    const events = await query(
      `SELECT e.*, u.avatar_url FROM crm_events e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.deal_id = $1 ORDER BY e.created_at DESC LIMIT 200`,
      [id]
    );
    res.json({ deal, events });
  } catch (err) {
    console.error('[crm deal]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- запис ----------

async function logEvent(dealId, req, kind, body, fromStage, toStage) {
  try {
    await execute(
      `INSERT INTO crm_events (deal_id, user_id, user_name, kind, body, from_stage, to_stage)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [dealId, req.user.userId, req.user.name || '', kind, body || '', fromStage || '', toStage || '']
    );
  } catch (e) {
    // Хронологията не бива да събаря самата промяна.
    console.error('[crm event]', e.message);
  }
}

// Известие към отговорника (в платформата + push). Никога към самия себе си.
function notifyOwner(ownerId, req, title, body, dealId) {
  if (!ownerId || ownerId === req.user.userId) return;
  execute(
    `INSERT INTO notifications (user_id, type, title, body, reference_type, reference_id, sender_name)
     VALUES ($1, 'crm', $2, $3, 'crm', $4, $5)`,
    [ownerId, title, body || '', dealId, req.user.name || '']
  ).catch((e) => console.error('[crm notify]', e.message));
  sendPushToUser(ownerId, { title, body: body || '', tag: `crm-${dealId}`, url: `/#/crm?deal=${dealId}` });
}

const statusForStage = (stage) => (stage && (stage.kind === 'won' || stage.kind === 'lost') ? stage.kind : 'open');

// POST /api/crm/deals — нова сделка.
router.post('/deals', requireAuth, requireCrm, async (req, res) => {
  try {
    const f = crm.normalizeDeal(req.body, false);
    const stage = await queryOne(`SELECT ${STAGE_COLS} FROM crm_stages WHERE id = $1`, [f.stage_id]);
    if (!stage) return res.status(400).json({ error: 'Непознат етап.' });
    const status = statusForStage(stage);

    const deal = await queryOne(
      `INSERT INTO crm_deals
        (title, company, contact_name, contact_email, contact_phone, source, stage_id, owner_id,
         value, recurring, next_step, next_step_at, notes, status, created_by, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        f.title, f.company, f.contact_name, f.contact_email, f.contact_phone, f.source,
        f.stage_id, f.owner_id, f.value, f.recurring, f.next_step, f.next_step_at, f.notes,
        status, req.user.userId, status === 'open' ? null : new Date(),
      ]
    );
    await logEvent(deal.id, req, 'created', deal.title, '', stage.title);
    notifyOwner(f.owner_id, req, `${req.user.name} ти даде сделка в CRM`, deal.title, deal.id);
    broadcast({ type: 'crm:changed', dealId: deal.id });
    res.status(201).json(deal);
  } catch (err) {
    console.error('[crm create]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/crm/deals/:id — редакция на полетата (без смяна на етап — тя е отделно).
router.put('/deals/:id', requireAuth, requireCrm, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const before = await queryOne('SELECT * FROM crm_deals WHERE id = $1', [id]);
    if (!before) return res.status(404).json({ error: 'Сделката не е намерена.' });

    const body = { ...req.body };
    delete body.stage_id; // етапът се сменя само през /move, за да върви със stage_since
    const f = crm.normalizeDeal(body, true);
    const keys = Object.keys(f);
    if (!keys.length) return res.json(before);

    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    const deal = await queryOne(
      `UPDATE crm_deals SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...keys.map((k) => f[k])]
    );

    if (keys.includes('owner_id') && f.owner_id !== before.owner_id) {
      notifyOwner(f.owner_id, req, `${req.user.name} ти даде сделка в CRM`, deal.title, id);
    }
    // „Следваща стъпка" е сърцето на CRM-а — затова смяната ѝ остава в хронологията.
    if (keys.includes('next_step') && f.next_step && f.next_step !== before.next_step) {
      await logEvent(id, req, 'note', `Следваща стъпка: ${f.next_step}` + (deal.next_step_at ? ` (${String(deal.next_step_at).slice(0, 10)})` : ''));
    }
    broadcast({ type: 'crm:changed', dealId: id });
    res.json(deal);
  } catch (err) {
    console.error('[crm update]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/crm/deals/:id/move { stageId, lost_reason } — смяна на етап.
router.post('/deals/:id/move', requireAuth, requireCrm, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const stageId = parseInt(req.body?.stageId, 10);
    const before = await queryOne('SELECT * FROM crm_deals WHERE id = $1', [id]);
    if (!before) return res.status(404).json({ error: 'Сделката не е намерена.' });
    const stage = await queryOne(`SELECT ${STAGE_COLS} FROM crm_stages WHERE id = $1`, [stageId]);
    if (!stage) return res.status(400).json({ error: 'Непознат етап.' });
    if (Number(before.stage_id) === stageId) return res.json(before);

    const fromStage = await queryOne('SELECT title FROM crm_stages WHERE id = $1', [before.stage_id]);
    const status = statusForStage(stage);
    const lostReason = status === 'lost' ? crm.clean(req.body?.lost_reason, crm.MAX_TEXT) : before.lost_reason;

    const deal = await queryOne(
      `UPDATE crm_deals
          SET stage_id = $2, status = $3, stage_since = NOW(), updated_at = NOW(),
              closed_at = CASE WHEN $3 = 'open' THEN NULL ELSE COALESCE(closed_at, NOW()) END,
              lost_reason = $4,
              next_step = CASE WHEN $3 = 'open' THEN next_step ELSE '' END,
              next_step_at = CASE WHEN $3 = 'open' THEN next_step_at ELSE NULL END
        WHERE id = $1 RETURNING *`,
      [id, stageId, status, lostReason]
    );

    await logEvent(id, req, status === 'won' ? 'won' : status === 'lost' ? 'lost' : 'stage',
      lostReason, (fromStage && fromStage.title) || '', stage.title);

    if (before.owner_id) {
      notifyOwner(before.owner_id, req, `Сделка → ${stage.title}`, deal.title, id);
    }
    broadcast({ type: 'crm:changed', dealId: id });
    res.json(deal);
  } catch (err) {
    console.error('[crm move]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/crm/deals/:id/events { kind, body } — бележка / обаждане / среща / имейл.
router.post('/deals/:id/events', requireAuth, requireCrm, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const kind = String(req.body?.kind || 'note');
    if (!crm.DEAL_KINDS.includes(kind)) return res.status(400).json({ error: 'Непознат вид запис.' });
    const body = crm.clean(req.body?.body, crm.MAX_LONG);
    if (!body) return res.status(400).json({ error: 'Напиши какво се случи.' });
    const deal = await queryOne('SELECT id, title, owner_id FROM crm_deals WHERE id = $1', [id]);
    if (!deal) return res.status(404).json({ error: 'Сделката не е намерена.' });

    await logEvent(id, req, kind, body);
    await execute('UPDATE crm_deals SET updated_at = NOW() WHERE id = $1', [id]);
    notifyOwner(deal.owner_id, req, `${req.user.name} писа по сделка`, `${deal.title}: ${body.slice(0, 120)}`, id);
    broadcast({ type: 'crm:changed', dealId: id });
    res.json({ ok: true });
  } catch (err) {
    console.error('[crm event add]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/crm/deals/:id — архивиране (сделките не се трият, за да не изчезне историята).
router.delete('/deals/:id', requireAuth, requireCrm, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const restore = req.query.restore === '1';
    const deal = await queryOne(
      'UPDATE crm_deals SET archived = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id, !restore]
    );
    if (!deal) return res.status(404).json({ error: 'Сделката не е намерена.' });
    broadcast({ type: 'crm:changed', dealId: id });
    res.json(deal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Basecamp мост ----------

// GET /api/crm/basecamp/targets — дъските/колоните, в които може да отиде картата.
router.get('/basecamp/targets', requireAuth, requireCrm, async (req, res) => {
  try {
    const { getServiceAuth } = require('../services/basecamp-token');
    const agg = require('../services/bc-aggregate');
    const auth = await getServiceAuth();
    const struct = await agg.loadStructure(auth.token, auth.account);
    res.json({
      boards: (struct.boards || []).map((b) => ({
        id: String(b.id),
        title: b.title,
        columns: (b.columns || []).map((c) => ({ id: String(c.id), title: c.title, isDone: !!c.isDone })),
      })),
    });
  } catch (err) {
    console.error('[crm bc targets]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/crm/deals/:id/basecamp { boardId, columnId, dueOn }
// Мостът към Basecamp: спечелената сделка става карта в реалния проект. Картата се
// прави от бот профила ThePactAlerts (както при „Създаване на задачи"), а линкът
// се пази при сделката, за да не се създаде втори път.
router.post('/deals/:id/basecamp', requireAuth, requireCrm, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deal = await queryOne('SELECT * FROM crm_deals WHERE id = $1', [id]);
    if (!deal) return res.status(404).json({ error: 'Сделката не е намерена.' });
    if (deal.bc_card_id) return res.status(400).json({ error: 'За тази сделка вече има карта в Basecamp.' });

    const boardId = String(req.body?.boardId || '');
    const columnId = String(req.body?.columnId || '');
    if (!boardId || !columnId) return res.status(400).json({ error: 'Избери дъска и колона.' });
    const dueOn = req.body?.dueOn ? String(req.body.dueOn).slice(0, 10) : null;
    if (dueOn && !crm.isDate(dueOn)) return res.status(400).json({ error: 'Невалиден краен срок.' });

    const bc = require('../services/basecamp');
    const kpc = require('../services/kp-create');
    const { getServiceAuth } = require('../services/basecamp-token');
    const agg = require('../services/bc-aggregate');
    const auth = await getServiceAuth();
    const struct = await agg.loadStructure(auth.token, auth.account);

    const board = (struct.boards || []).find((b) => String(b.id) === boardId);
    if (!board) return res.status(400).json({ error: 'Непозната дъска.' });
    const column = (board.columns || []).find((c) => String(c.id) === columnId);
    if (!column) return res.status(400).json({ error: 'Колоната не е от избраната дъска.' });

    const lines = [
      `Нов клиент от CRM: ${deal.title}`,
      deal.company ? `Фирма: ${deal.company}` : '',
      deal.contact_name ? `Контакт: ${deal.contact_name}` : '',
      deal.contact_email ? `Имейл: ${deal.contact_email}` : '',
      deal.contact_phone ? `Телефон: ${deal.contact_phone}` : '',
      Number(deal.value) ? `Стойност: ${deal.value} лв.${deal.recurring ? ' / месец' : ''}` : '',
      deal.source ? `Източник: ${deal.source}` : '',
      '',
      deal.notes || '',
    ].filter((l) => l !== null);

    const card = await bc.createCard(auth.token, auth.account, struct.projectId, column.id, {
      title: deal.company ? `${deal.company} — ${deal.title}` : deal.title,
      content: kpc.textToBcHtml(lines.join('\n').trim()),
      due_on: dueOn || undefined,
    });
    agg.invalidateBoard(board.id);

    const url = bc.normalizeAppUrl(card.app_url);
    const updated = await queryOne(
      'UPDATE crm_deals SET bc_card_id = $2, bc_card_url = $3, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id, card.id, url || '']
    );
    await logEvent(id, req, 'basecamp', `Карта в ${board.title} → ${column.title}`);
    broadcast({ type: 'crm:changed', dealId: id });
    res.json({ ok: true, url, board: board.title, column: column.title, deal: updated });
  } catch (err) {
    console.error('[crm basecamp]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------- управление на достъпа ----------

// GET /api/crm/access — кой има достъп и кой го е дал.
router.get('/access', requireAuth, requireCrm, async (req, res) => {
  try {
    const [rows, users] = await Promise.all([
      crm.listAccess(),
      query('SELECT id, name, email, avatar_url, role FROM users WHERE is_active IS NOT FALSE ORDER BY name'),
    ]);
    res.json({ access: rows, users, me: req.crm, myId: req.user.userId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/access { userId, canGrant } — даване на достъп.
router.post('/access', requireAuth, requireCrm, async (req, res) => {
  try {
    if (!req.crm.canGrant) return res.status(403).json({ error: 'Ти можеш да ползваш CRM, но не и да даваш достъп.' });
    const userId = parseInt(req.body?.userId, 10);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Избери човек.' });
    const user = await queryOne('SELECT id, name, role FROM users WHERE id = $1 AND is_active IS NOT FALSE', [userId]);
    if (!user) return res.status(404).json({ error: 'Няма такъв активен потребител.' });
    if (user.role === 'admin') return res.status(400).json({ error: 'Пълните админи и без това имат достъп.' });

    await crm.grantAccess(userId, req.user.userId, req.body?.canGrant !== false);
    execute(
      `INSERT INTO notifications (user_id, type, title, body, reference_type, sender_name)
       VALUES ($1, 'crm', $2, $3, 'crm', $4)`,
      [userId, `${req.user.name} ти даде достъп до CRM`, 'Инструментът е в More → CRM.', req.user.name || '']
    ).catch(() => {});
    sendPushToUser(userId, { title: 'Достъп до CRM', body: `${req.user.name} ти даде достъп.`, tag: 'crm-access', url: '/#/crm' });
    res.json({ ok: true, access: await crm.listAccess() });
  } catch (err) {
    console.error('[crm grant]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/crm/access/:userId — отнемане.
// Админ маха всеки; останалите — само хора, които самите те са пуснали. Заедно с
// човека падат и всички, пуснати от него (нататък по веригата).
router.delete('/access/:userId', requireAuth, requireCrm, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const row = await queryOne('SELECT user_id, granted_by FROM crm_access WHERE user_id = $1', [userId]);
    if (!row) return res.status(404).json({ error: 'Този човек и без това няма достъп.' });
    if (!req.crm.isAdmin && row.granted_by !== req.user.userId) {
      return res.status(403).json({ error: 'Можеш да отнемаш достъп само на хора, на които ти си го дал.' });
    }
    const removed = await crm.revokeAccess(userId);
    res.json({ ok: true, removed, access: await crm.listAccess() });
  } catch (err) {
    console.error('[crm revoke]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ---------- етапи (само пълен админ) ----------

// PUT /api/crm/stages { stages: [{id?, title, kind, probability, rot_days, color, exit_rule}] }
// Празен списък не се приема — фунията без етапи е безполезна.
router.put('/stages', requireAuth, requireAdmin, async (req, res) => {
  try {
    const arr = Array.isArray(req.body?.stages) ? req.body.stages : [];
    const cleaned = arr.map((s, i) => ({
      id: parseInt(s?.id, 10) || null,
      title: crm.clean(s?.title, 120),
      kind: ['open', 'won', 'lost'].includes(s?.kind) ? s.kind : 'open',
      probability: Math.min(100, Math.max(0, parseInt(s?.probability, 10) || 0)),
      rot_days: Math.min(365, Math.max(0, parseInt(s?.rot_days, 10) || 0)),
      color: crm.clean(s?.color, 20),
      exit_rule: crm.clean(s?.exit_rule, 300),
      position: i + 1,
    })).filter((s) => s.title);
    if (!cleaned.length) return res.status(400).json({ error: 'Трябва поне един етап.' });
    if (cleaned.length > 20) return res.status(400).json({ error: 'Максимум 20 етапа.' });

    const existing = (await query('SELECT id FROM crm_stages')).map((r) => Number(r.id));
    const keptIds = cleaned.filter((s) => s.id).map((s) => s.id);
    const goneIds = existing.filter((id) => !keptIds.includes(id));

    // Етап с останали в него сделки не се трие — сделките биха останали без етап.
    if (goneIds.length) {
      const orphaned = await query(
        `SELECT s.id, s.title, COUNT(d.id)::int AS n FROM crm_stages s
           LEFT JOIN crm_deals d ON d.stage_id = s.id
          WHERE s.id = ANY($1::int[]) GROUP BY s.id, s.title HAVING COUNT(d.id) > 0`,
        [goneIds]
      );
      if (orphaned.length) {
        return res.status(400).json({ error: `Не мога да махна етап със сделки в него: ${orphaned.map((o) => o.title).join(', ')}. Първо ги премести.` });
      }
    }

    for (const s of cleaned) {
      if (s.id) {
        await execute(
          `UPDATE crm_stages SET title=$2, kind=$3, probability=$4, rot_days=$5, color=$6, exit_rule=$7, position=$8 WHERE id=$1`,
          [s.id, s.title, s.kind, s.probability, s.rot_days, s.color, s.exit_rule, s.position]
        );
      } else {
        await execute(
          `INSERT INTO crm_stages (title, kind, probability, rot_days, color, exit_rule, position) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [s.title, s.kind, s.probability, s.rot_days, s.color, s.exit_rule, s.position]
        );
      }
    }
    if (goneIds.length) await execute('DELETE FROM crm_stages WHERE id = ANY($1::int[])', [goneIds]);
    broadcast({ type: 'crm:changed' });
    res.json({ ok: true, stages: await loadStages() });
  } catch (err) {
    console.error('[crm stages]', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
