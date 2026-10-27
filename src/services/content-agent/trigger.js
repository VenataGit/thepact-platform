// Content агент — кога се пуска.
//
// 1) Таг в Basecamp: content creator пише коментар под задачата (КП картата или
//    която и да е задача) и тагва ThePactAlerts (или пише #идеи). Всяка минута
//    четем новите коментари през recordings API; текстът на коментара е заявката
//    („искат 2 видеа за Коледа, без хумор…"), а клиентът се разпознава по проекта
//    или по името в заглавието на задачата/в коментара.
// 2) Нов контент план: kp-create вика onKpCardCreated → ако „Автоматично при нов КП"
//    е включено (Настройки → Content агент), агентите тръгват сами.
//
// Ботът игнорира собствените си коментари (иначе би си отговарял сам).
const cron = require('node-cron');
const config = require('../../config');
const { query } = require('../../db/pool');
const bc = require('../basecamp');
const { getServiceAuth } = require('../basecamp-token');
const kpComment = require('../kp-comment');
const store = require('./store');
const pipeline = require('./pipeline');

const KEYWORD_RE = /(^|\s)(#идеи|#ideas|@claude)(?=\s|$|[.,!?:])/i;
let polling = false;

function initContentAgent() {
  try {
    pipeline.resumeAfterRestart().catch((e) => console.warn('[content-agent] resume:', e.message));
    cron.schedule('* * * * *', () => {
      pollOnce().catch((e) => console.error('[content-agent] poll:', e.message));
    }, { timezone: 'Europe/Sofia' });
    console.log('  Content Agent: active (every minute)');
  } catch (e) {
    console.log('  Content Agent: skipped —', e.message);
  }
}

async function botSgid(auth, cfg) {
  if (cfg.botSgid) return cfg.botSgid;
  const me = await bc.getMyProfile(auth.token, auth.account);
  if (me && me.attachable_sgid) {
    await store.saveSetting('ca_bot_sgid', me.attachable_sgid);
    return me.attachable_sgid;
  }
  return '';
}

function isTrigger(content, sgid) {
  const html = String(content || '');
  if (sgid && html.includes(sgid)) return true;
  return KEYWORD_RE.test(kpComment.plainText(html, 5000));
}

// Текстът на заявката — без самия таг.
function requestText(content) {
  const html = String(content || '').replace(/<bc-attachment[^>]*content-type="application\/vnd\.basecamp\.mention"[\s\S]*?<\/bc-attachment>/gi, ' ');
  return kpComment.plainText(html, 20000).replace(KEYWORD_RE, ' ').trim();
}

/** Кой клиент: по проекта → по заглавието на задачата → по текста на коментара. */
async function resolveClient(projectId, parentTitle, text) {
  await store.ensureSchema();
  const clients = await query('SELECT id, name, bc_project_id, current_kp_number FROM kp_clients WHERE is_active IS NOT FALSE');
  const byProject = clients.find((c) => c.bc_project_id && String(c.bc_project_id) === String(projectId));
  if (byProject) return byProject;
  const norm = kpComment.normName;
  const find = (hay) => {
    const h = ` ${norm(hay)} `;
    const hits = clients.filter((c) => norm(c.name) && h.includes(` ${norm(c.name)} `));
    // По-дългото име печели („Aula.bg" пред „Aula"). При еднакви имена (дубликат в
    // КП-Автоматизация) — живият клиент: свързан с Basecamp проект, после по-високият КП.
    hits.sort((a, b) => (norm(b.name).length - norm(a.name).length)
      || ((b.bc_project_id ? 1 : 0) - (a.bc_project_id ? 1 : 0))
      || ((Number(b.current_kp_number) || 0) - (Number(a.current_kp_number) || 0)));
    return hits[0] || null;
  };
  return find(parentTitle) || find(text) || null;
}

async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    const cfg = await store.loadSettings();
    if (!cfg.enabled) return;
    const startedAt = new Date().toISOString();
    if (!cfg.lastCommentAt) { await store.saveSetting('ca_last_comment_at', startedAt); return; } // първи път = само baseline

    let auth;
    try { auth = await getServiceAuth(); } catch { return; }
    const sgid = await botSgid(auth, cfg).catch(() => '');
    // 2 мин застъпване — дедупът е по id на коментара (ca_runs.bc_comment_id).
    const since = new Date(new Date(cfg.lastCommentAt).getTime() - 120_000).toISOString();
    const comments = await bc.getRecordingsSince(auth.token, auth.account, 'Comment', since, 3);

    for (const c of comments.reverse()) {
      if (String(c.creator?.email_address || '').toLowerCase() === config.BASECAMP_SERVICE_EMAIL) continue;
      if (!isTrigger(c.content, sgid)) continue;
      const projectId = c.bucket && c.bucket.id;
      const parent = c.parent || {};
      const text = requestText(c.content);
      const client = await resolveClient(projectId, parent.title || '', text);
      if (!client) {
        await store.ensureSchema();
        // Пазим отказа като пускане-грешка, за да не отговаряме два пъти на същия коментар.
        const dup = await query('SELECT 1 FROM ca_runs WHERE bc_comment_id = $1', [c.id]);
        if (dup.length) continue;
        await query(
          `INSERT INTO ca_runs (client_id, trigger, request, requested_by, bc_project_id, bc_parent_id, bc_comment_id, status, error, finished_at)
           VALUES (0,'mention',$1,$2,$3,$4,$5,'error','клиентът не е разпознат',NOW()) ON CONFLICT (bc_comment_id) DO NOTHING`,
          [text, c.creator?.name || '', projectId, parent.id, c.id]
        );
        await bc.createComment(auth.token, auth.account, projectId, parent.id,
          `<div>${c.creator?.attachable_sgid ? `<bc-attachment sgid="${c.creator.attachable_sgid}"></bc-attachment> ` : ''}` +
          `Не разпознах за кой клиент е. Тагни ме пак и напиши името на клиента така, както е в КП-Автоматизация.</div>`).catch(() => {});
        continue;
      }
      const id = await pipeline.createRun({
        clientId: client.id, trigger: 'mention', request: text,
        requestedBy: c.creator?.name || '',
        requester: { name: c.creator?.name || '', sgid: c.creator?.attachable_sgid || '' },
        bcProjectId: projectId, bcParentId: parent.id, bcCommentId: c.id, parentType: parent.type || '',
      });
      if (id) console.log(`[content-agent] заявка от ${c.creator?.name} за ${client.name} → пускане ${id}`);
    }
    await store.saveSetting('ca_last_comment_at', startedAt);
  } finally {
    polling = false;
  }
}

/** Вика се от kp-create след създаване на КП картата в Basecamp. Никога не хвърля. */
function onKpCardCreated({ projectId, cardId, client, kpNumber, videoCount }) {
  setImmediate(async () => {
    try {
      const cfg = await store.loadSettings();
      if (!cfg.autoOnKp) return;
      const id = await pipeline.createRun({
        clientId: client.id, trigger: 'kp_auto', requestedBy: 'Нов КП',
        request: videoCount ? `Нов контент план КП-${kpNumber}: ${videoCount} видеа.` : '',
        bcProjectId: projectId, bcParentId: cardId, kpNumber, parentType: 'Kanban::Card',
      });
      console.log(`[content-agent] нов КП за ${client.name} → пускане ${id}`);
    } catch (e) {
      console.error('[content-agent] нов КП:', e.message);
    }
  });
}

module.exports = { initContentAgent, pollOnce, onKpCardCreated, isTrigger, requestText, resolveClient };
