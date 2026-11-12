// Контент стратегия агент — Фаза 1 (Венци, 12.11.2026).
//
// Човек пуска агента от #/strategy за клиентски проект → агентът събира всичко от
// Basecamp проекта + картата на клиента → 3 стъпки, всяка ЕКСПЕРТ + ПРОВЕРИТЕЛ
// (същата машинка като Content агента, през AI опашката към компютъра с абонамента):
//   1. Анализатор на материала — фактите за бизнеса, какво е казал клиентът, обем съдържание
//   2. Пазарен анализатор      — успешните видеа в нишата (библиотеката на Content агента)
//   3. Контент стратег         — самата стратегия + въпросите за срещата с клиента
// → документ „Контент стратегия — <клиент>" в Video Production → Docs & Files →
//   Клиентски карти → папката на клиента. НЕ в проекта на клиента (Венци: „не искам
//   да го правиш ти").
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { query, queryOne, execute } = require('../../db/pool');
const bc = require('../basecamp');
const { getServiceAuth } = require('../basecamp-token');
const kpArchive = require('../kp-archive');
const caStore = require('../content-agent/store');
const scout = require('../content-agent/scout');
const discover = require('../content-agent/discover');
const { runStep, block, TEAM } = require('../content-agent/agents');
const store = require('./store');
const { gatherProject } = require('./gather');

const KNOW_DIR = path.join(__dirname, '..', 'content-agent', 'knowledge');
const RRS = fs.readFileSync(path.join(KNOW_DIR, 'rrs-framework.md'), 'utf8');
const HUMAN = fs.readFileSync(path.join(KNOW_DIR, 'humanizer-bg.md'), 'utf8');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CHECKER_FORMAT = `Отговори с JSON:
{"ok": true|false, "score": 1-10, "issues": [{"n": null, "problem": "какво не е наред", "fix": "какво точно да се промени"}]}
"ok": true само ако резултатът може да отиде при екипа и клиента без срам. Бъди строг, но конкретен — всяка забележка трябва да може да се поправи. Не пренаписвай сам.`;

const materialBlock = (ctx) => ctx.sections.map((s) => block(s.title.replace(/[^a-zа-я0-9]+/gi, '_').toLowerCase(), s.text)).join('\n\n');
const baseInfo = (ctx) => [
  block('клиент', ctx.clientName),
  block('basecamp_проект', ctx.projectName),
  block('пакет_от_името_на_проекта', ctx.plan),
  ctx.kpClient ? block('от_КП_автоматизация', { videos_per_month: ctx.kpClient.videos_per_month, notes: ctx.kpClient.notes || '' }) : '',
  ctx.notes ? block('бележки_от_екипа_за_това_пускане', ctx.notes) : '',
  ctx.memory ? block('памет_на_клиента_от_content_агента', ctx.memory) : '',
].filter(Boolean).join('\n\n');

const STEPS = {
  facts: {
    title: 'Анализатор на материала',
    expert: {
      role: 'Анализатор на материала',
      system: `${TEAM}

Ти си АНАЛИЗАТОРЪТ НА МАТЕРИАЛА. Получаваш всичко от Basecamp проекта на нов клиент (съобщения, коментари, документи, файлове, задачи, чат) и картата му. Извади фактите, на които ще стъпи контент стратегията. Само това, което пише в материала — нищо измислено.
Обемът съдържание: колко видеа/статични поста/реклами на месец — от картата, от пакета в името на проекта („SMM 10" = 10 видеа, „Static 2" = 2 статични поста, „Performance" = и реклами) и от КП-Автоматизация. Ако се разминават — кажи го.
Отговори с JSON:
{"business": {"what_they_sell": "", "offers": [""], "locations": "", "price_level": "", "differentiators": [""]},
 "goals": [""], "audience_hints": [""], "client_said": [{"fact": "какво е казал/поискал клиентът", "source": "откъде (съобщение/документ/дата)"}],
 "likes": [""], "dislikes_and_bans": [""], "tone_hints": [""], "existing_channels": [""],
 "content_volume": {"videos_per_month": число_или_null, "static_per_month": число_или_null, "ads": "", "source": "откъде е", "conflicts": ""},
 "gaps": ["важна информация, която липсва и трябва да питаме клиента"]}`,
    },
    checker: {
      role: 'Проверител на фактите',
      system: `${TEAM}

Провери извадката на анализатора срещу материала: всеки факт има ли го наистина в материала (нищо измислено); пропуснато ли е нещо важно, което клиентът е казал или поискал; вярен ли е обемът съдържание (виж пакета в името на проекта и картата); посочени ли са реалните пропуски.
${CHECKER_FORMAT}`,
    },
    input: (ctx) => `${baseInfo(ctx)}\n\n${materialBlock(ctx)}`,
  },

  market: {
    title: 'Пазарен анализатор',
    expert: {
      role: 'Пазарен анализатор',
      system: `${TEAM}

Ти си ПАЗАРНИЯТ АНАЛИЗАТОР. Получаваш фактите за клиента и най-успешните видеа в нишата му (outliers — гледания спрямо медианата на профила, с анализ на самото видео, ако го има) и профилите на конкурентите. Кажи какво работи в нишата в момента и какво от това пасва на ТОЗИ клиент. Само по данните — не си измисляй примери.
Отговори с JSON:
{"patterns": [{"name": "", "why_it_works": "", "how_for_client": "", "evidence": ["url"]}],
 "competitors": [{"name": "", "what_they_do": "", "gap_for_us": ""}],
 "opportunities": [""], "avoid": [""]}`,
    },
    checker: {
      role: 'Проверител на пазарния анализ',
      system: `${TEAM}

Провери пазарния анализ: всеки модел подкрепен ли е от реални видеа от данните (evidence с техни url); пасва ли на клиента; няма ли общи приказки, които важат за всеки бизнес.
${CHECKER_FORMAT}`,
    },
    input: (ctx) => [block('факти', ctx.out.facts), block('успешни_видеа', ctx.outliers), ctx.profiles ? block('профили', ctx.profiles) : ''].filter(Boolean).join('\n\n'),
  },

  strategy: {
    title: 'Контент стратег',
    expert: {
      role: 'Контент стратег',
      system: `${TEAM}

Ти си КОНТЕНТ СТРАТЕГЪТ на The Pact. Пишеш контент стратегията за клиента, която ще представим на ПЪРВАТА СРЕЩА с него. След срещата ще пишем концепции, после конкретни идеи — затова сега е посоката, не готови видеа.
Стратегията е конкретна за този бизнес (не важи за всеки), стъпва на фактите и на пазарния анализ, съобразена е с обема съдържание от пакета (колко видеа/статични поста/реклами на месец). Където липсва информация — допускане, ясно отбелязано, и въпрос към клиента.
Нашата методика за видеата (ползвай я за стълбовете и форматите):
${RRS}

Пиши като човек, не като AI:
${HUMAN}

Отговори с JSON:
{"summary": "3-5 изречения: посоката накратко",
 "goals": [{"goal": "", "how_we_measure": ""}],
 "audience": [{"segment": "", "pains": [""], "desires": [""], "where": "платформи/кога гледат"}],
 "positioning": "как искаме да ги възприемат и с какво се отличават",
 "pillars": [{"name": "", "why": "", "share_pct": число, "topics": ["примерни теми"], "formats": [""]}],
 "content_mix": {"videos_per_month": число, "static_per_month": число_или_0, "ads": "", "split": [{"type": "", "count": число, "purpose": ""}]},
 "platforms": [{"platform": "", "role": "", "frequency": ""}],
 "tone": {"voice": "", "do": [""], "dont": [""]},
 "formats": [{"name": "", "description": "", "example": ""}],
 "first_month": ["с какво започваме първия месец и защо"],
 "kpis": [{"metric": "", "target_or_note": ""}],
 "risks": [""],
 "assumptions": ["допускане, което клиентът трябва да потвърди"],
 "questions_for_meeting": ["конкретен въпрос към клиента на срещата"]}`,
    },
    checker: {
      role: 'Проверител на стратегията',
      system: `${TEAM}

Провери стратегията като старши стратег, преди да отиде на среща с клиента: конкретна ли е за ТОЗИ бизнес; стъпва ли на фактите (нищо измислено за клиента); стълбовете различни ли са един от друг и сборът на share_pct = 100; content_mix съвпада ли с обема от фактите; спазени ли са забраните и „не харесва"; покриват ли въпросите за срещата пропуските и допусканията; звучи ли като човек.
${CHECKER_FORMAT}`,
    },
    input: (ctx) => [baseInfo(ctx), block('факти', ctx.out.facts), block('пазар', ctx.out.market || '(няма данни за нишата)')].join('\n\n'),
  },
};

// ---------- опашка (по едно пускане — всяко е десетки AI заявки) ----------

const queue = [];
let active = false;

function enqueue(runId) {
  if (!queue.includes(runId)) queue.push(runId);
  setImmediate(drain);
}

async function drain() {
  if (active) return;
  const id = queue.shift();
  if (!id) return;
  active = true;
  try { await executeRun(id); } catch (e) { console.error(`[strategy-agent] пускане ${id}:`, e.message); }
  finally { active = false; setImmediate(drain); }
}

async function createRun({ projectId, notes = '', requestedBy = '' }) {
  await store.ensureSchema();
  const busy = await queryOne("SELECT id FROM cs_runs WHERE project_id = $1 AND status IN ('queued','running')", [projectId]);
  if (busy) return busy.id;
  const row = await queryOne(
    'INSERT INTO cs_runs (project_id, notes, requested_by) VALUES ($1, $2, $3) RETURNING id',
    [projectId, String(notes).slice(0, 20000), requestedBy]
  );
  enqueue(row.id);
  return row.id;
}

async function resumeAfterRestart() {
  await store.ensureSchema();
  await execute(
    `UPDATE cs_runs SET status = 'queued', steps = '[]'::jsonb,
            usage = usage || jsonb_build_object('restarts', COALESCE((usage->>'restarts')::int, 0) + 1)
      WHERE status = 'running' AND COALESCE((usage->>'restarts')::int, 0) < 2`
  );
  await execute("UPDATE cs_runs SET status = 'error', error = 'Прекъснато от рестарт на сървъра — пусни отново.', finished_at = NOW() WHERE status = 'running'");
  (await query("SELECT id FROM cs_runs WHERE status = 'queued' ORDER BY id")).forEach((r) => enqueue(r.id));
}

async function logStep(runId, entry) {
  await execute('UPDATE cs_runs SET steps = steps || $2::jsonb WHERE id = $1',
    [runId, JSON.stringify([{ at: new Date().toISOString(), ...entry }])]);
}

function reviewSummary(reviews) {
  const last = reviews[reviews.length - 1] || {};
  return { rounds: reviews.length, ok: !!last.ok, score: last.score || null,
    open_issues: Array.isArray(last.issues) && !last.ok ? last.issues.slice(0, 8) : [] };
}

// Успешните видеа от Content агента (ако клиентът го има в КП-Автоматизация).
async function marketData(kpClient, usage) {
  if (!kpClient) return { outliers: [], profiles: '', memory: '', note: 'клиентът го няма в КП-Автоматизация' };
  await caStore.ensureSchema();
  const client = await caStore.getClient(kpClient.id);
  const cfg = await caStore.loadSettings();
  let note = '';
  let lib = [];
  if (cfg.apifyToken || cfg.youtubeKey) {
    try {
      await discover.ensureTerms(client, { usage });
      lib = await discover.libraryOutliers(client.id);
      const bg = await discover.discoverInBackground(client.id);
      if (bg && bg.started) note = 'ново търсене в нишата тръгна фоново';
    } catch (e) { note = `търсенето: ${String(e.message || e).slice(0, 150)}`; }
  } else note = 'няма Apify/YouTube ключ';
  const own = await scout.topOutliers(client.id).catch(() => []);
  const outliers = own.concat(lib).slice(0, 40).map((v) => ({
    platform: v.platform, profile: v.label || v.handle || '', role: v.role, url: v.url,
    outlier_score: Number(v.outlier_score), views: Number(v.views),
    caption: String(v.caption || '').slice(0, 400),
    analysis: v.analysis ? { hook: v.analysis.hook, format: v.analysis.format, why_it_works: v.analysis.why_it_works } : null,
  }));
  return { outliers, profiles: await caStore.profilesText(client.id), memory: await caStore.memoryText(client.id), note };
}

async function executeRun(runId) {
  const run = await queryOne('SELECT * FROM cs_runs WHERE id = $1', [runId]);
  if (!run || run.status !== 'queued') return;
  await execute("UPDATE cs_runs SET status = 'running' WHERE id = $1", [runId]);
  const usage = {};
  const progress = (t) => logStep(runId, { key: 'progress', title: t }).catch(() => {});
  try {
    const p = await store.getProject(run.project_id);
    if (!p) throw new Error('проектът не е намерен');
    const auth = await getServiceAuth();

    const g = await gatherProject(auth, p.project_id, { clientName: p.client, projectName: p.name, onProgress: progress });
    const s = g.stats;
    await logStep(runId, {
      key: 'gather', title: 'Събиране от Basecamp проекта',
      note: `${s.messages} съобщения, ${s.comments} коментара, ${s.docs} документа, ${s.files} файла, ${s.todos} задачи, ${s.chat} реда чат` +
        (g.clientCard ? ` · карта на клиента: ${g.clientCard.title} (${s.card_docs} док.)` : ' · няма папка в „Клиентски карти"'),
      errors: g.errors.slice(0, 5),
    });
    if (!g.sections.length && !run.notes.trim()) throw new Error('в проекта няма никакъв материал — качи бриф/карта или напиши бележки при пускането');

    const kpRows = await query('SELECT id, name, bc_project_id, videos_per_month, notes, is_active FROM kp_clients');
    const kpClient = store.matchKpClient(kpRows, p.project_id, p.client);
    const md = await marketData(kpClient, usage);
    await logStep(runId, { key: 'library', title: 'Успешни видеа в нишата', outliers: md.outliers.length, note: md.note,
      errors: md.note && /^(търсенето|няма)/.test(md.note) ? [md.note] : [] });

    const ctx = {
      clientName: p.client, projectName: g.projectName, plan: store.planFromProject(g.projectName),
      kpClient, notes: run.notes, memory: md.memory, profiles: md.profiles, outliers: md.outliers,
      sections: g.sections, out: {},
    };
    const reviews = {};
    const doStep = async (key) => {
      const r = await runStep(STEPS[key], ctx, null, usage, progress);
      ctx.out[key] = r.output;
      reviews[key] = reviewSummary(r.reviews);
      await logStep(runId, { key, title: STEPS[key].title, ...reviews[key] });
    };
    await doStep('facts');
    if (ctx.outliers.length) await doStep('market');
    await doStep('strategy');

    // Документът в Клиентски карти / <клиент>.
    progress('Качвам стратегията в „Клиентски карти"…');
    const team = config.BASECAMP_TEAM_PROJECT_ID;
    const vault = config.BASECAMP_CLIENT_CARDS_VAULT_ID;
    let folder = g.clientCard;
    if (!folder) {
      const made = await bc.createVaultFolder(auth.token, auth.account, team, vault, p.client);
      folder = { id: made.id, title: made.title, url: bc.normalizeAppUrl(made.app_url), created: true };
    }
    const title = `Контент стратегия — ${p.client}`;
    const doc = await kpArchive.upsertDocument(auth, team, folder.id, title,
      strategyDocHtml({ clientName: p.client, projectName: g.projectName, facts: ctx.out.facts, market: ctx.out.market, strategy: ctx.out.strategy, stats: s }));

    const result = { client: p.client, project_name: g.projectName, plan: ctx.plan, kp_client_id: kpClient ? kpClient.id : null,
      folder, doc: { ...doc, title }, stats: s, facts: ctx.out.facts, market: ctx.out.market || null, strategy: ctx.out.strategy, reviews };
    await execute("UPDATE cs_runs SET status = 'done', result = $2, usage = usage || $3::jsonb, finished_at = NOW() WHERE id = $1",
      [runId, JSON.stringify(result), JSON.stringify(usage)]);
    await execute("UPDATE cs_projects SET status = 'done', doc_url = $2, updated_at = NOW() WHERE project_id = $1", [p.project_id, doc.url || '']);
    console.log(`[strategy-agent] пускане ${runId} (${p.client}) готово · ${usage.calls || 0} AI заявки`);
  } catch (e) {
    const msg = String(e.message || e).slice(0, 1000);
    console.error(`[strategy-agent] пускане ${runId} се провали:`, msg);
    await execute("UPDATE cs_runs SET status = 'error', error = $2, usage = usage || $3::jsonb, finished_at = NOW() WHERE id = $1",
      [runId, msg, JSON.stringify(usage)]).catch(() => {});
  }
}

// ---------- документът (Basecamp rich text) ----------

const ul = (arr, fn = (x) => esc(x)) => {
  const items = (Array.isArray(arr) ? arr : []).filter((x) => x != null && x !== '');
  return items.length ? `<ul>${items.map((x) => `<li>${fn(x)}</li>`).join('')}</ul>` : '';
};
const h = (t) => `<h1>${esc(t)}</h1>`;
const p = (t) => (t ? `<div>${esc(t)}</div>` : '');

function strategyDocHtml({ clientName, projectName, facts, market, strategy, stats }) {
  const st = strategy || {};
  const f = facts || {};
  const out = [];
  out.push(`<div><em>Чернова от Контент стратегия агента (${new Date().toLocaleDateString('bg-BG', { timeZone: 'Europe/Sofia' })}) за ${esc(clientName)} — проект „${esc(projectName)}". Прегледай и редактирай преди срещата с клиента.</em></div>`);
  out.push(h('Накратко'), p(st.summary));
  if (st.goals && st.goals.length) out.push(h('Цели'), ul(st.goals, (g) => `<strong>${esc(g.goal)}</strong>${g.how_we_measure ? ` — ${esc(g.how_we_measure)}` : ''}`));
  if (st.audience && st.audience.length) {
    out.push(h('Аудитория'), ul(st.audience, (a) => `<strong>${esc(a.segment)}</strong>` +
      (a.pains && a.pains.length ? `<br>Болки: ${esc(a.pains.join('; '))}` : '') +
      (a.desires && a.desires.length ? `<br>Иска: ${esc(a.desires.join('; '))}` : '') +
      (a.where ? `<br>Къде/кога: ${esc(a.where)}` : '')));
  }
  if (st.positioning) out.push(h('Позициониране'), p(st.positioning));
  if (st.pillars && st.pillars.length) {
    out.push(h('Стълбове на съдържанието'), ul(st.pillars, (x) => `<strong>${esc(x.name)}</strong>${x.share_pct ? ` (${esc(x.share_pct)}%)` : ''} — ${esc(x.why || '')}` +
      (x.topics && x.topics.length ? `<br>Теми: ${esc(x.topics.join('; '))}` : '') +
      (x.formats && x.formats.length ? `<br>Формати: ${esc(x.formats.join(', '))}` : '')));
  }
  const mix = st.content_mix || {};
  if (mix.videos_per_month || (mix.split && mix.split.length)) {
    out.push(h('Обем и микс на месец'),
      p([mix.videos_per_month ? `${mix.videos_per_month} видеа` : '', mix.static_per_month ? `${mix.static_per_month} статични поста` : '', mix.ads ? `реклами: ${mix.ads}` : ''].filter(Boolean).join(' · ')),
      ul(mix.split, (x) => `<strong>${esc(x.type)}</strong> × ${esc(x.count)} — ${esc(x.purpose || '')}`));
  }
  if (st.platforms && st.platforms.length) out.push(h('Платформи'), ul(st.platforms, (x) => `<strong>${esc(x.platform)}</strong> — ${esc(x.role || '')}${x.frequency ? ` (${esc(x.frequency)})` : ''}`));
  if (st.tone) {
    out.push(h('Тон'), p(st.tone.voice));
    if (st.tone.do && st.tone.do.length) out.push(`<div><strong>Да:</strong></div>`, ul(st.tone.do));
    if (st.tone.dont && st.tone.dont.length) out.push(`<div><strong>Не:</strong></div>`, ul(st.tone.dont));
  }
  if (st.formats && st.formats.length) out.push(h('Формати'), ul(st.formats, (x) => `<strong>${esc(x.name)}</strong> — ${esc(x.description || '')}${x.example ? `<br><em>Пример: ${esc(x.example)}</em>` : ''}`));
  if (st.first_month && st.first_month.length) out.push(h('Първият месец'), ul(st.first_month));
  if (st.kpis && st.kpis.length) out.push(h('Как мерим успеха'), ul(st.kpis, (x) => `<strong>${esc(x.metric)}</strong>${x.target_or_note ? ` — ${esc(x.target_or_note)}` : ''}`));
  if (market && market.patterns && market.patterns.length) {
    out.push(h('Какво работи в нишата'), ul(market.patterns, (x) => `<strong>${esc(x.name)}</strong> — ${esc(x.how_for_client || x.why_it_works || '')}` +
      ((x.evidence || []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 2).map((u, i) => ` <a href="${esc(u)}">пример ${i + 1}</a>`).join(''))));
  }
  if (market && market.competitors && market.competitors.length) out.push(h('Конкуренти'), ul(market.competitors, (x) => `<strong>${esc(x.name)}</strong> — ${esc(x.what_they_do || '')}${x.gap_for_us ? `<br>Нашият шанс: ${esc(x.gap_for_us)}` : ''}`));
  if (st.risks && st.risks.length) out.push(h('Рискове'), ul(st.risks));
  if (st.assumptions && st.assumptions.length) out.push(h('Допускания (да потвърди клиентът)'), ul(st.assumptions));
  if (st.questions_for_meeting && st.questions_for_meeting.length) out.push(h('Въпроси за срещата'), ul(st.questions_for_meeting));
  if (f.gaps && f.gaps.length) out.push(h('Липсва ни информация за'), ul(f.gaps));
  if (stats) {
    out.push(`<div><br><em>Източници: ${stats.messages} съобщения, ${stats.comments} коментара, ${stats.docs} документа, ${stats.files} файла, ${stats.todos} задачи, ${stats.chat} реда чат${stats.card_docs ? `, картата на клиента (${stats.card_docs} док.)` : ''}. Всяка стъпка е проверена от отделен проверител.</em></div>`);
  }
  return out.filter(Boolean).join('');
}

module.exports = { createRun, enqueue, resumeAfterRestart, executeRun, strategyDocHtml, STEPS };
