// Content агент — оркестраторът.
//
// Едно пускане (ca_runs) минава през екипа агенти, всеки с отделен проверител:
//   Пазител на паметта (учи от обратната връзка) → Скаут (дърпа профилите) →
//   Стратег (бриф) → Анализатор на outlier видеа → Идеатор (RRS) → Кукички →
//   Сценарист → Humanizer BG → Главен редактор → коментар под задачата в Basecamp.
//
// Пусканията вървят едно по едно (опашка в процеса) — всяко е десетки AI заявки.
// Basecamp-ът се пипа като ThePactAlerts (сервизният акаунт).
const config = require('../../config');
const { query, queryOne, execute } = require('../../db/pool');
const bc = require('../basecamp');
const { getServiceAuth } = require('../basecamp-token');
const kpComment = require('../kp-comment');
const store = require('./store');
const scout = require('./scout');
const { STEPS, runStep } = require('./agents');

const CHUNK = 5;               // по колко видеа наведнъж за кукички/скриптове/humanizer
const MAX_COMMENT_CHARS = 45000;
const PLATFORM_URL = 'https://thepact.pro';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (html, max) => kpComment.plainText(html, max);

// ---------- опашка ----------

const queue = [];
let busy = false;

function enqueue(runId) {
  if (!queue.includes(runId)) queue.push(runId);
  setImmediate(drain);
}

async function drain() {
  if (busy) return;
  const id = queue.shift();
  if (!id) return;
  busy = true;
  try {
    await executeRun(id);
  } catch (e) {
    console.error(`[content-agent] пускане ${id}:`, e.message);
  } finally {
    busy = false;
    setImmediate(drain);
  }
}

/** Ново пускане. Връща id или null, ако коментарът-заявка вече е обработен. */
async function createRun({ clientId, trigger, request = '', requestedBy = '', bcProjectId = null, bcParentId = null, bcCommentId = null, requester = null, kpNumber = null, parentType = '' }) {
  await store.ensureSchema();
  const row = await queryOne(
    `INSERT INTO ca_runs (client_id, trigger, request, requested_by, bc_project_id, bc_parent_id, bc_comment_id, steps, result)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'[]'::jsonb,$8)
     ON CONFLICT (bc_comment_id) DO NOTHING RETURNING id`,
    [clientId, trigger, String(request).slice(0, 20000), requestedBy, bcProjectId, bcParentId, bcCommentId,
     JSON.stringify({ meta: { requester, kpNumber, parentType } })]
  );
  if (!row) return null;
  enqueue(row.id);
  return row.id;
}

// При старт: прекъснатите от рестарт → грешка, чакащите → обратно в опашката.
async function resumeAfterRestart() {
  await store.ensureSchema();
  await execute("UPDATE ca_runs SET status = 'error', error = 'Прекъснато от рестарт на сървъра — пусни отново.', finished_at = NOW() WHERE status = 'running'");
  const rows = await query("SELECT id FROM ca_runs WHERE status = 'queued' ORDER BY id");
  rows.forEach((r) => enqueue(r.id));
}

// ---------- журнал на стъпките ----------

async function logStep(runId, entry) {
  await execute(
    `UPDATE ca_runs SET steps = steps || $2::jsonb WHERE id = $1`,
    [runId, JSON.stringify([{ at: new Date().toISOString(), ...entry }])]
  );
}

function reviewSummary(reviews) {
  const last = reviews[reviews.length - 1] || {};
  return {
    rounds: reviews.length,
    ok: !!last.ok,
    score: last.score || null,
    open_issues: Array.isArray(last.issues) && !last.ok ? last.issues.slice(0, 8) : [],
  };
}

// ---------- контекст ----------

async function loadBasecampContext(run, auth, client) {
  const out = { card: '', thread: '', bcContext: '', parentTitle: '' };
  const meta = (run.result && run.result.meta) || {};
  if (auth && run.bc_project_id && run.bc_parent_id) {
    try {
      if (/card/i.test(meta.parentType || 'Kanban::Card')) {
        const card = await bc.getCard(auth.token, auth.account, run.bc_project_id, run.bc_parent_id);
        out.parentTitle = card.title || '';
        out.card = `${card.title || ''}\n${plain(card.content, 8000)}`;
      } else if (/todo/i.test(meta.parentType)) {
        const { json } = await bc.authedGet(`${bc.API_BASE}/${auth.account}/buckets/${run.bc_project_id}/todos/${run.bc_parent_id}.json`, auth.token);
        out.parentTitle = json.title || json.content || '';
        out.card = `${plain(json.content, 500)}\n${plain(json.description, 6000)}`;
      }
    } catch (e) {
      console.warn('[content-agent] задачата не се прочете:', e.message);
    }
    try {
      const comments = await bc.getComments(auth.token, auth.account, run.bc_project_id, run.bc_parent_id);
      const botEmail = config.BASECAMP_SERVICE_EMAIL;
      out.thread = comments
        .filter((c) => String(c.creator?.email_address || '').toLowerCase() !== botEmail)
        .slice(-30)
        .map((c) => `[${String(c.created_at || '').slice(0, 10)}] ${c.creator?.name || ''}: ${plain(c.content, 1500)}`)
        .join('\n');
    } catch (e) {
      console.warn('[content-agent] коментарите не се прочетоха:', e.message);
    }
  }
  try {
    const project = await kpComment.resolveClientProject(client);
    if (project) {
      const ctx = await kpComment.gatherClientContext(project.project_id, 60);
      if (!kpComment.contextIsEmpty(ctx)) out.bcContext = kpComment.contextToPrompt(ctx, client.name, 60);
    }
  } catch (e) {
    console.warn('[content-agent] проектът на клиента:', e.message);
  }
  return out;
}

function outliersForPrompt(rows) {
  const roleBg = { own: 'СОБСТВЕН профил на клиента', competitor: 'конкурент', inspiration: 'вдъхновение' };
  return rows.map((v) => ({
    platform: v.platform,
    profile: `${v.label || v.handle || ''} (${roleBg[v.role] || v.role})`,
    url: v.url,
    outlier_score: Number(v.outlier_score),
    views: Number(v.views), profile_median: v.profile_median ? Math.round(Number(v.profile_median)) : null,
    likes: v.likes == null ? null : Number(v.likes), comments: v.comments == null ? null : Number(v.comments),
    shares: v.shares == null ? null : Number(v.shares), saves: v.saves == null ? null : Number(v.saves),
    duration_sec: v.duration_sec, published: v.published_at ? new Date(v.published_at).toISOString().slice(0, 10) : null,
    caption: String(v.caption || '').slice(0, 600),
  }));
}

// Предишният пакет под същата задача — при втори таг заявката обикновено е
// обратна връзка по него („видео 3 е скучно, смени кукичките").
async function previousPackage(run) {
  if (!run.bc_parent_id) return null;
  const prev = await queryOne(
    `SELECT result FROM ca_runs WHERE bc_parent_id = $1 AND id <> $2 AND status = 'done' AND result IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
    [run.bc_parent_id, run.id]
  );
  if (!prev || !prev.result || !Array.isArray(prev.result.scripts)) return null;
  return prev.result.scripts.map((s) => ({
    n: s.n, title: s.title, type: s.type,
    hook: typeof s.hook === 'string' ? s.hook : (s.hook && s.hook.text) || '',
    body: String(s.body || '').slice(0, 1500),
  }));
}

// ---------- изпълнение ----------

async function executeRun(runId) {
  const run = await queryOne('SELECT * FROM ca_runs WHERE id = $1', [runId]);
  if (!run || run.status !== 'queued') return;
  await execute("UPDATE ca_runs SET status = 'running' WHERE id = $1", [runId]);
  const meta = (run.result && run.result.meta) || {};
  const usage = {};
  let auth = null;
  try { auth = await getServiceAuth(); } catch (e) { console.warn('[content-agent] няма Basecamp бот:', e.message); }
  const progress = (text) => logStep(runId, { key: 'progress', title: text }).catch(() => {});

  const client = await store.getClient(run.client_id);
  const canComment = !!(auth && run.bc_project_id && run.bc_parent_id);
  const who = meta.requester && meta.requester.sgid
    ? `<bc-attachment sgid="${esc(meta.requester.sgid)}"></bc-attachment>`
    : (run.requested_by ? `<strong>${esc(run.requested_by)}</strong>` : '');

  try {
    if (!client) throw new Error('клиентът не е намерен');
    if (!config.ANTHROPIC_API_KEY) throw new Error('няма ANTHROPIC_API_KEY');

    if (canComment) {
      await bc.createComment(auth.token, auth.account, run.bc_project_id, run.bc_parent_id,
        `<div>${who ? who + ' ' : ''}🤖 Започвам проучване и идеи за <strong>${esc(client.name)}</strong>. ` +
        `Работят 9 агента, всеки с отделен проверител — ще пиша тук, когато са готови (обикновено 20-40 мин).</div>`)
        .catch((e) => console.warn('[content-agent] стартов коментар:', e.message));
    }

    const bcx = await loadBasecampContext(run, auth, client);
    const kpFromTitle = (bcx.parentTitle.match(/КП\s*-?\s*(\d+)/i) || [])[1];
    const ctx = {
      client,
      kpNumber: meta.kpNumber || (kpFromTitle ? Number(kpFromTitle) : null),
      request: run.request,
      card: bcx.card, thread: bcx.thread, bcContext: bcx.bcContext,
      memory: await store.memoryText(client.id),
      profiles: await store.profilesText(client.id),
      recentTitles: await store.recentIdeaTitles(client.id),
      previous: await previousPackage(run),
      out: {},
      reviewNotes: {},
    };
    // Видеата от предишния пакет под същата задача не са „повторение" — може да се запазят.
    if (ctx.previous) {
      const keep = new Set(ctx.previous.map((p) => p.title));
      ctx.recentTitles = ctx.recentTitles.filter((t) => !keep.has(t));
    }
    const record = async (key, title, reviews, extra = {}) => {
      const r = reviewSummary(reviews);
      ctx.reviewNotes[key] = r;
      await logStep(runId, { key, title, ...r, ...extra });
    };

    // 1) Учене от обратната връзка → нови записи в паметта (чакат одобрение).
    let learned = [];
    if (run.trigger !== 'kp_auto' && ((run.request || '').trim() || bcx.thread)) {
      const { output, reviews } = await runStep('learn', ctx, null, usage, progress);
      const items = (output.items || []).filter((i) => i && store.KINDS.includes(i.kind) && String(i.text || '').trim());
      for (const it of items.slice(0, 15)) {
        const row = await queryOne(
          `INSERT INTO ca_memory (client_id, kind, text, source, status, created_by)
           SELECT $1,$2,$3,$4,'pending','Content агент'
            WHERE NOT EXISTS (SELECT 1 FROM ca_memory WHERE client_id = $1 AND lower(text) = lower($3))
           RETURNING id, kind, text`,
          [client.id, it.kind, String(it.text).trim().slice(0, 2000), `Basecamp: ${(it.evidence || '').slice(0, 300)}`]
        );
        if (row) learned.push(row);
      }
      await record('learn', STEPS.learn.title, reviews, { learned: learned.length });
    }

    // 2) Скаут — обновява профилите (ако има ключове) и взима най-успешните видеа.
    let outliers = [];
    if (await scout.hasProfiles(client.id)) {
      const res = await scout.refreshClient(client.id).catch((e) => [{ ok: false, error: e.message }]);
      outliers = await scout.topOutliers(client.id);
      await logStep(runId, {
        key: 'scout', title: 'Скаут (профили)',
        refreshed: res.filter((r) => r.ok).length, errors: res.filter((r) => !r.ok).map((r) => r.error).slice(0, 5),
        outliers: outliers.length,
      });
    }
    ctx.outliers = outliersForPrompt(outliers);

    // 3) Бриф.
    {
      const { output, reviews } = await runStep('brief', ctx, null, usage, progress);
      ctx.out.brief = output;
      await record('brief', STEPS.brief.title, reviews);
    }
    const count = Math.max(1, Math.min(20, Number(ctx.out.brief.video_count) || Number(client.videos_per_month) || 10));
    ctx.out.brief.video_count = count;

    // 4) Анализ на успешните видеа.
    if (ctx.outliers.length) {
      const { output, reviews } = await runStep('research', ctx, null, usage, progress);
      ctx.out.research = output;
      await record('research', STEPS.research.title, reviews);
    }

    // 5) Идеи.
    {
      const { output, reviews } = await runStep('ideas', ctx, null, usage, progress);
      ctx.out.ideas = (output.ideas || []).map((i, idx) => ({ ...i, n: Number(i.n) || idx + 1 })).slice(0, count);
      await record('ideas', STEPS.ideas.title, reviews, { count: ctx.out.ideas.length });
    }
    if (!ctx.out.ideas.length) throw new Error('идеаторът не върна идеи');

    // 6-8) Кукички → скриптове → humanizer, на парчета по CHUNK видеа.
    const hooks = {};
    const scripts = {};
    for (let i = 0; i < ctx.out.ideas.length; i += CHUNK) {
      const ideas = ctx.out.ideas.slice(i, i + CHUNK);
      const label = `видеа ${ideas[0].n}-${ideas[ideas.length - 1].n}`;

      const h = await runStep('hooks', ctx, { ideas }, usage, progress);
      for (const x of (h.output.hooks || [])) hooks[Number(x.n)] = x;
      await record(`hooks_${i}`, `${STEPS.hooks.title} (${label})`, h.reviews);

      const hookFor = (n) => {
        const x = hooks[Number(n)];
        if (!x || !Array.isArray(x.options) || !x.options.length) return null;
        return x.options[Number(x.best) || 0] || x.options[0];
      };
      const s = await runStep('scripts', ctx, { ideas, hookFor }, usage, progress);
      const drafted = (s.output.scripts || []).map((x) => ({ ...x, n: Number(x.n) }));
      await record(`scripts_${i}`, `${STEPS.scripts.title} (${label})`, s.reviews);

      const hz = await runStep('humanize', ctx, { scripts: drafted }, usage, progress);
      const human = {};
      for (const x of (hz.output.scripts || [])) human[Number(x.n)] = x;
      for (const d of drafted) scripts[d.n] = { ...d, ...(human[d.n] || {}), n: d.n };
      await record(`humanize_${i}`, `${STEPS.humanize.title} (${label})`, hz.reviews);
    }
    ctx.out.scripts = ctx.out.ideas.map((idea) => {
      const s = scripts[idea.n] || {};
      return { ...s, n: idea.n, title: s.title || idea.title, type: s.type || idea.type,
        reference_url: s.reference_url || idea.reference_url || '', human_input: s.human_input || idea.human_input || '',
        hook_options: (hooks[idea.n] && hooks[idea.n].options) || [] };
    });

    // 9) Главен редактор.
    {
      const { output, reviews } = await runStep('editor', ctx, null, usage, progress);
      ctx.out.editor = output;
      await record('editor', STEPS.editor.title, reviews);
    }

    const result = {
      meta, brief: ctx.out.brief, research: ctx.out.research || null, ideas: ctx.out.ideas,
      scripts: ctx.out.scripts, intro: ctx.out.editor.intro || '', to_check: ctx.out.editor.to_check || [],
      learned, reviews: ctx.reviewNotes,
    };

    if (canComment) {
      for (const html of buildCommentHtml({ client, result, who })) {
        await bc.createComment(auth.token, auth.account, run.bc_project_id, run.bc_parent_id, html);
      }
    }
    await execute(
      "UPDATE ca_runs SET status = 'done', result = $2, usage = $3, finished_at = NOW() WHERE id = $1",
      [runId, JSON.stringify(result), JSON.stringify(usage)]
    );
    console.log(`[content-agent] пускане ${runId} (${client.name}) готово · ${usage.calls || 0} AI заявки · ${usage.input || 0}/${usage.output || 0} токена`);
  } catch (e) {
    const msg = String(e.message || e).slice(0, 1000);
    console.error(`[content-agent] пускане ${runId} се провали:`, msg);
    await execute("UPDATE ca_runs SET status = 'error', error = $2, usage = $3, finished_at = NOW() WHERE id = $1",
      [runId, msg, JSON.stringify(usage)]).catch(() => {});
    if (canComment) {
      await bc.createComment(auth.token, auth.account, run.bc_project_id, run.bc_parent_id,
        `<div>${who ? who + ' ' : ''}⚠️ Не успях да довърша идеите${client ? ` за <strong>${esc(client.name)}</strong>` : ''}: ${esc(msg.slice(0, 300))}. Тагни ме пак, за да опитам отново.</div>`)
        .catch(() => {});
    }
  }
}

// ---------- коментарът в Basecamp ----------

function textToHtml(t) {
  return esc(String(t || '').trim()).replace(/\r?\n/g, '<br>');
}

function scriptHtml(s) {
  const head = [];
  head.push(`<strong>Видео ${esc(s.n)}: ${esc(s.title || '')}</strong>` +
    (s.type || s.duration_sec ? ` <em>(${esc([s.type, s.duration_sec ? `~${s.duration_sec} сек` : ''].filter(Boolean).join(' · '))})</em>` : ''));
  if (s.hook) head.push(`<strong>Кукичка:</strong> ${esc(typeof s.hook === 'string' ? s.hook : s.hook.text || '')}`);
  head.push('');
  head.push(`/Участници във видеото - ${esc(s.participants || '')}/`);
  head.push(`/Локация - ${esc(s.location || '')}/`);
  head.push(`/Необходими продукти-ресурси - ${esc(s.resources || '')}/`);
  head.push('');
  head.push(textToHtml(s.body));
  head.push('');
  if (s.caption) head.push(`Описание (Caption): ${esc(s.caption)}`);
  const alt = (s.hook_options || []).map((o) => o && o.text).filter((t) => t && t !== (s.hook && (s.hook.text || s.hook)));
  if (alt.length) head.push(`<em>Други кукички: ${alt.map(esc).join(' | ')}</em>`);
  if (s.human_input) head.push(`<em>Човек да допълни: ${esc(s.human_input)}</em>`);
  if (/^https?:\/\//i.test(s.reference_url || '')) head.push(`Референция (само за екипа): <a href="${esc(s.reference_url)}">${esc(s.reference_url)}</a>`);
  return `<div>${head.join('<br>')}</div>`;
}

function buildCommentHtml({ client, result, who }) {
  const top = [];
  top.push(`<div>${who ? who + ' ' : ''}✅ Готово — <strong>${result.scripts.length}</strong> идеи със скриптове за <strong>${esc(client.name)}</strong>.</div>`);
  if (result.intro) top.push(`<div><br>${esc(result.intro)}</div>`);
  if (result.to_check && result.to_check.length) {
    top.push('<div><br><strong>Провери преди да продължиш:</strong></div>');
    top.push(`<ul>${result.to_check.slice(0, 8).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
  }
  if (result.research && Array.isArray(result.research.patterns) && result.research.patterns.length) {
    top.push('<div><strong>Какво работи в момента (по успешните видеа):</strong></div>');
    top.push(`<ul>${result.research.patterns.slice(0, 6).map((p) => {
      const ev = (p.evidence || []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 2)
        .map((u, i) => `<a href="${esc(u)}">пример ${i + 1}</a>`).join(', ');
      return `<li><strong>${esc(p.name)}</strong> — ${esc(p.how_for_client || p.why_it_works || '')}${ev ? ` (${ev})` : ''}</li>`;
    }).join('')}</ul>`);
  }

  const bottom = [];
  if (result.learned && result.learned.length) {
    bottom.push('<div><br><strong>Научих нови неща за клиента (чакат одобрение):</strong></div>');
    bottom.push(`<ul>${result.learned.map((m) => `<li>${esc(m.text)}</li>`).join('')}</ul>`);
    bottom.push(`<div>Одобри ги или ги откажи в <a href="${PLATFORM_URL}/#/content/${client.id}">паметта на клиента</a> — едва тогава влизат в бъдещите идеи.</div>`);
  }
  bottom.push(`<div><br><em>Направено от екип агенти: стратег, анализатор, идеатор, кукички, сценарист, humanizer и редактор — всеки проверен от отделен проверител. За промени ми отговори тук с таг. Всичко за клиента: <a href="${PLATFORM_URL}/#/content/${client.id}">thepact.pro</a>.</em></div>`);

  // Дълъг пакет → няколко поредни коментара (Basecamp не обича огромни).
  const blocks = [...top, ...result.scripts.map((s) => `<div><br></div>${scriptHtml(s)}`), ...bottom];
  const out = [];
  let cur = '';
  for (const b of blocks) {
    if (cur && cur.length + b.length > MAX_COMMENT_CHARS) { out.push(cur); cur = ''; }
    cur += b;
  }
  if (cur) out.push(cur);
  return out;
}

module.exports = { createRun, enqueue, resumeAfterRestart, buildCommentHtml, executeRun };
