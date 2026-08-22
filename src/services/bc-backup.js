// Бекъп на проекта Video Production (Basecamp) — един самостоятелен HTML файл.
//
// Защо: ако утре Basecamp или платформата ги няма, задачите не бива да изчезнат с тях.
// Затова веднъж седмично целият проект се изтегля и се записва като ЕДИН файл, който
// се отваря с двоен клик в браузъра и се чете без интернет, без логин и без нас.
//
// Какво влиза:
//   * всички Kanban дъски (Pre-Production, Production, Post-Production, Project
//     Management) с всичките им колони — включително Not now, On hold и Done;
//   * всяка карта: описание, стъпки с датите и хората по тях, отговорници, коментари;
//   * to-do списъците на проекта (dock-а „Tasks" и „ThePact.pro / платформа");
//   * отчетеното през платформата време по всяка задача — това го няма в Basecamp
//     и е единственото място, където се пази.
//
// Какво НЕ влиза: прикачените файлове и снимките. Те си остават на сървърите на
// Basecamp — линковете в описанията водят към тях, докато акаунтът е жив.
//
// Работи с токена на бота ThePactAlerts (getServiceAuth), защото се вика от
// планирана задача на компютъра, зад която не стои влязъл човек.
const config = require('../config');
const bc = require('./basecamp');
const { getServiceAuth } = require('./basecamp-token');
const { mapLimit, sortBoards } = require('./bc-aggregate');
const { query } = require('../db/pool');

// Днешната дата по нашето време. Сървърът върви на UTC, а „просрочена" се мери
// спрямо календара в офиса — иначе всяка вечер след 21:00 датите се разминават.
function todaySofia() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Sofia' });
}

function pickPerson(p) {
  if (!p) return null;
  return { id: p.id, name: p.name || '', email: p.email_address || '' };
}

function mapCard(c, onHold) {
  return {
    kind: 'card',
    id: c.id,
    title: c.title || '',
    url: bc.normalizeAppUrl(c.app_url || c.url || ''),
    dueOn: c.due_on || null,
    completed: !!c.completed,
    onHold: !!onHold,
    createdAt: c.created_at || null,
    updatedAt: c.updated_at || null,
    creator: pickPerson(c.creator),
    assignees: (c.assignees || []).map(pickPerson).filter(Boolean),
    content: c.content || '',
    commentsCount: c.comments_count || c.comment_count || 0,
    steps: (c.steps || []).map((s) => ({
      id: s.id,
      title: s.title || '',
      dueOn: s.due_on || null,
      completed: !!s.completed,
      assignees: (s.assignees || []).map(pickPerson).filter(Boolean),
    })),
    comments: [],
  };
}

function mapTodo(t, groupTitle) {
  return {
    kind: 'todo',
    id: t.id,
    title: t.title || t.content || '',
    url: bc.normalizeAppUrl(t.app_url || t.url || ''),
    dueOn: t.due_on || null,
    completed: !!t.completed,
    onHold: false,
    createdAt: t.created_at || null,
    updatedAt: t.updated_at || null,
    creator: pickPerson(t.creator),
    assignees: (t.assignees || []).map(pickPerson).filter(Boolean),
    content: t.description || '',
    commentsCount: t.comments_count || 0,
    group: groupTitle || null,
    steps: [],
    comments: [],
  };
}

// ---------------------------------------------------------------------------
// Отчетено време — идва от платформата, не от Basecamp
// ---------------------------------------------------------------------------
// Времето се води по ЗАГЛАВИЕ (виж routes/time.js) — картата може да е създадена
// отново с ново id, а часовете по нея да са отчетени още по старото. Затова тук
// една задача събира и записите по своето id, и записите по своето заглавие,
// а групите се дедупликират по ключ, за да не се брои един запис два пъти.
function titleKey(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function loadTimeIndex() {
  const groups = new Map(); // key -> { seconds, entries, byUser: Map }
  const byCard = new Map(); // cardId -> [key]
  const byTitle = new Map(); // titleKey -> [key]
  try {
    const rows = await query(
      `SELECT lower(btrim(regexp_replace(e.title, '\\s+', ' ', 'g'))) AS title_key,
              e.bc_recording_id,
              COALESCE(u.name, '—') AS user_name,
              SUM(COALESCE(e.duration_seconds, 0))::bigint AS seconds,
              COUNT(*)::int AS entries
         FROM time_entries e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.ended_at IS NOT NULL AND COALESCE(e.duration_seconds, 0) > 0
        GROUP BY 1, 2, 3`
    );
    for (const r of rows) {
      const tk = r.title_key || '';
      const cid = r.bc_recording_id == null ? '' : String(r.bc_recording_id);
      const key = `${tk}|${cid}`;
      if (!groups.has(key)) {
        groups.set(key, { seconds: 0, entries: 0, byUser: new Map() });
        if (cid) {
          if (!byCard.has(cid)) byCard.set(cid, []);
          byCard.get(cid).push(key);
        }
        if (tk) {
          if (!byTitle.has(tk)) byTitle.set(tk, []);
          byTitle.get(tk).push(key);
        }
      }
      const g = groups.get(key);
      const sec = Number(r.seconds) || 0;
      g.seconds += sec;
      g.entries += Number(r.entries) || 0;
      g.byUser.set(r.user_name, (g.byUser.get(r.user_name) || 0) + sec);
    }
  } catch (e) {
    console.warn('[bc-backup] отчетеното време не е налично:', e.message);
    return null;
  }
  return { groups, byCard, byTitle };
}

function timeFor(index, item) {
  if (!index) return null;
  const keys = new Set([
    ...(index.byCard.get(String(item.id)) || []),
    ...(index.byTitle.get(titleKey(item.title)) || []),
  ]);
  if (!keys.size) return null;
  let seconds = 0;
  let entries = 0;
  const byUser = new Map();
  for (const k of keys) {
    const g = index.groups.get(k);
    if (!g) continue;
    seconds += g.seconds;
    entries += g.entries;
    for (const [u, s] of g.byUser) byUser.set(u, (byUser.get(u) || 0) + s);
  }
  if (!seconds) return null;
  return {
    seconds,
    entries,
    byUser: [...byUser.entries()]
      .map(([name, sec]) => ({ name, seconds: sec }))
      .sort((a, b) => b.seconds - a.seconds),
  };
}

// ---------------------------------------------------------------------------
// Събиране на данните
// ---------------------------------------------------------------------------
async function collectSnapshot(opts = {}) {
  const withComments = opts.comments !== false;
  const startedAt = Date.now();
  const warnings = [];
  const { token, account } = await getServiceAuth();
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  const project = await bc.getProject(token, account, projectId);
  const dock = (project.dock || []).filter((t) => t.enabled);

  // --- Kanban дъски ---
  const tables = dock.filter((t) => /kanban|card/i.test(t.name));
  let boards = await mapLimit(tables, 2, async (t) => {
    try {
      const table = (await bc.authedGet(t.url, token)).json;
      const columns = await mapLimit(table.lists || [], 3, async (list) => {
        const main = list.cards_count > 0
          ? await bc.getColumnCards(token, account, projectId, list.id) : [];
        // On hold картите живеят в отделна секция на колоната със свой списък.
        const held = (list.on_hold && list.on_hold.cards_count > 0)
          ? await bc.getColumnCards(token, account, projectId, list.on_hold.id) : [];
        return {
          id: list.id,
          title: list.title || '',
          isDone: /DoneColumn/i.test(list.type || ''),
          isNotNow: /NotNowColumn/i.test(list.type || ''),
          cards: [
            ...main.map((c) => mapCard(c, false)),
            ...held.map((c) => mapCard(c, true)),
          ],
        };
      });
      return { id: table.id, title: t.title || table.title || '', columns };
    } catch (e) {
      warnings.push(`Дъската „${t.title}" не се изтегли: ${e.message}`);
      return { id: t.id, title: t.title || '', columns: [], failed: true };
    }
  });
  boards = sortBoards(boards);

  // --- To-do списъци (dock-ът има по един todoset на списък) ---
  const todosets = dock.filter((t) => t.name === 'todoset');
  const todoLists = [];
  for (const t of todosets) {
    try {
      const set = (await bc.authedGet(t.url, token)).json;
      const lists = await bc.getTodoLists(token, account, projectId, set.id);
      for (const l of lists) {
        const open = await bc.getTodos(token, account, projectId, l.id, { completed: false });
        const done = await bc.getTodos(token, account, projectId, l.id, { completed: true });
        const items = [...open, ...done].map((x) => mapTodo(x, null));
        // Задачите в група не излизат от todos.json на родителския списък.
        const groups = await bc.getTodoGroups(token, account, projectId, l.id).catch(() => []);
        for (const g of groups) {
          const gOpen = await bc.getTodos(token, account, projectId, g.id, { completed: false });
          const gDone = await bc.getTodos(token, account, projectId, g.id, { completed: true });
          items.push(...[...gOpen, ...gDone].map((x) => mapTodo(x, g.title || g.name || '')));
        }
        todoLists.push({
          id: l.id,
          set: t.title || '',
          title: l.title || l.name || '',
          url: bc.normalizeAppUrl(l.app_url || l.url || ''),
          items,
        });
      }
    } catch (e) {
      warnings.push(`To-do списъкът „${t.title}" не се изтегли: ${e.message}`);
    }
  }

  // --- Коментари (само там, където има какво да се тегли) ---
  const allItems = [
    ...boards.flatMap((b) => b.columns.flatMap((c) => c.cards)),
    ...todoLists.flatMap((l) => l.items),
  ];
  if (withComments) {
    const needing = allItems.filter((i) => i.commentsCount > 0);
    await mapLimit(needing, 4, async (item) => {
      try {
        const list = await bc.getComments(token, account, projectId, item.id);
        item.comments = list.map((c) => ({
          id: c.id,
          author: (c.creator && c.creator.name) || '',
          createdAt: c.created_at || null,
          content: c.content || '',
        }));
      } catch (e) {
        warnings.push(`Коментарите по „${item.title}" не се изтеглиха: ${e.message}`);
      }
    });
  }

  // --- Отчетено време от платформата ---
  const timeIndex = await loadTimeIndex();
  if (!timeIndex) warnings.push('Отчетеното време не е налично (базата не отговори).');
  let totalSeconds = 0;
  for (const item of allItems) {
    const t = timeFor(timeIndex, item);
    if (t) { item.time = t; totalSeconds += t.seconds; }
  }

  // --- Обобщение ---
  const today = todaySofia();
  const isOpen = (i, col) => !i.completed && !(col && col.isDone);
  let cards = 0; let active = 0; let done = 0; let onHold = 0; let overdue = 0; let withDue = 0;
  for (const b of boards) {
    for (const col of b.columns) {
      for (const c of col.cards) {
        cards += 1;
        if (c.dueOn) withDue += 1;
        if (c.onHold) onHold += 1;
        if (c.completed || col.isDone) done += 1;
        else active += 1;
        if (c.dueOn && c.dueOn < today && isOpen(c, col) && !c.onHold) overdue += 1;
      }
    }
  }
  const todos = todoLists.reduce((s, l) => s + l.items.length, 0);
  const todosOpen = todoLists.reduce((s, l) => s + l.items.filter((i) => !i.completed).length, 0);

  return {
    generatedAt: new Date().toISOString(),
    generatedLocal: new Date().toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' }),
    today,
    tookMs: Date.now() - startedAt,
    account,
    project: {
      id: project.id,
      name: project.name || '',
      url: bc.normalizeAppUrl(project.app_url || project.url || ''),
    },
    boards,
    todoLists,
    stats: {
      boards: boards.length,
      cards,
      active,
      done,
      onHold,
      overdue,
      withDue,
      todoLists: todoLists.length,
      todos,
      todosOpen,
      comments: allItems.reduce((s, i) => s + i.comments.length, 0),
      timeSeconds: totalSeconds,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Рендериране
// ---------------------------------------------------------------------------
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Богатият текст на Basecamp се излива както си е, но файлът се отваря в браузър —
// затова изпълнимото се маха. (В нашите данни го няма; това е предпазител.)
function safeRich(html) {
  return String(html || '')
    .replace(/<\s*(script|style|iframe|object|embed)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, 'javascript-blocked:');
}

function fmtDate(d) {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(d);
}

function fmtDateTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', dateStyle: 'short', timeStyle: 'short' });
  } catch { return String(iso); }
}

function fmtHours(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

const STYLE = `
:root{--bg:#111a1e;--panel:rgba(255,255,255,.05);--line:rgba(255,255,255,.12);
--txt:#e6e6e6;--dim:#9bb0b8;--green:#46a374;--gold:#c9a227;--red:#d2695f;--purple:#a98cd8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.55 -apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:24px 18px 80px}
h1{font-size:26px;margin:0 0 4px}
h2{font-size:20px;margin:34px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:16px;margin:20px 0 8px;color:var(--dim);font-weight:600}
a{color:#7fc4e8}
.sub{color:var(--dim);font-size:13px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin:14px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.kpi{background:rgba(0,0,0,.22);border-radius:10px;padding:10px 12px}
.kpi b{display:block;font-size:22px;line-height:1.2}
.kpi span{color:var(--dim);font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:600}
.card{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--line);
border-radius:10px;padding:12px 14px;margin:10px 0}
.card.overdue{border-left-color:var(--red)}
.card.done{border-left-color:var(--green);opacity:.72}
.card.hold{border-left-color:var(--gold)}
.card>summary{cursor:pointer;list-style:none;outline:none}
.card>summary::-webkit-details-marker{display:none}
.ttl{font-weight:600;font-size:15px}
.meta{color:var(--dim);font-size:12.5px;margin-top:3px}
.tag{display:inline-block;border-radius:20px;padding:1px 9px;font-size:11.5px;margin-right:5px;
background:rgba(255,255,255,.09);color:var(--txt);white-space:nowrap}
.tag.red{background:rgba(210,105,95,.24);color:#f0a89f}
.tag.green{background:rgba(70,163,116,.22);color:#8fd9b4}
.tag.gold{background:rgba(201,162,39,.22);color:#e8cf7e}
.tag.purple{background:rgba(169,140,216,.22);color:#cdb8f0}
.body{margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)}
.rich{background:rgba(0,0,0,.22);border-radius:8px;padding:10px 12px;overflow-wrap:anywhere}
.rich img{max-width:100%;height:auto}
.rich p{margin:.4em 0}
.cmt{border-left:2px solid var(--line);padding:2px 0 2px 10px;margin:8px 0}
.cmt .who{color:var(--dim);font-size:12px;margin-bottom:2px}
.tools{position:sticky;top:0;background:var(--bg);padding:10px 0;z-index:5;border-bottom:1px solid var(--line)}
input[type=search]{width:100%;max-width:420px;padding:8px 12px;border-radius:8px;
border:1px solid var(--line);background:rgba(0,0,0,.3);color:var(--txt);font-size:14px}
button{background:var(--green);color:#fff;border:0;border-radius:20px;padding:7px 16px;
font-size:13px;font-weight:600;cursor:pointer;margin-left:6px}
.hidden{display:none!important}
.note{color:var(--dim);font-size:12.5px}
@media print{
 body{background:#fff;color:#000}
 .tools,button{display:none}
 .panel,.card,.rich,.kpi{background:#fff;border-color:#bbb;color:#000}
 .card{break-inside:avoid}
 a{color:#000;text-decoration:none}
 details{display:block}
}
`;

// Търсачката и бутоните — единственият скрипт във файла. Ако JavaScript е спрян,
// съдържанието пак се чете; губи се само филтрирането.
const SCRIPT = `
(function(){
 var box=document.getElementById('q');
 var cards=[].slice.call(document.querySelectorAll('.card'));
 function apply(){
  var q=(box.value||'').trim().toLowerCase();
  cards.forEach(function(c){
   c.classList.toggle('hidden', q && (c.dataset.s||'').indexOf(q)<0);
  });
  document.querySelectorAll('[data-group]').forEach(function(g){
   var any=g.querySelector('.card:not(.hidden)');
   g.classList.toggle('hidden', !!q && !any);
  });
 }
 box.addEventListener('input',apply);
 document.getElementById('open').onclick=function(){
  cards.forEach(function(c){c.open=true});
 };
 document.getElementById('close').onclick=function(){
  cards.forEach(function(c){c.open=false});
 };
})();
`;

function renderItem(item, ctx) {
  const today = ctx.today;
  const isDoneCol = !!ctx.isDone;
  const finished = item.completed || isDoneCol;
  const overdue = !!item.dueOn && item.dueOn < today && !finished && !item.onHold;
  const cls = ['card'];
  if (finished) cls.push('done');
  else if (overdue) cls.push('overdue');
  else if (item.onHold) cls.push('hold');

  const tags = [];
  if (finished) tags.push('<span class="tag green">завършена</span>');
  if (item.onHold) tags.push('<span class="tag gold">on hold</span>');
  if (overdue) tags.push(`<span class="tag red">просрочена (${esc(fmtDate(item.dueOn))})</span>`);
  else if (item.dueOn) tags.push(`<span class="tag">срок ${esc(fmtDate(item.dueOn))}</span>`);
  if (item.time) tags.push(`<span class="tag purple">${esc(fmtHours(item.time.seconds))}</span>`);

  const people = item.assignees.map((a) => a.name).filter(Boolean).join(', ');
  const meta = [];
  if (people) meta.push(`Отговорници: ${esc(people)}`);
  if (item.group) meta.push(`Група: ${esc(item.group)}`);
  if (item.creator && item.creator.name) meta.push(`Създал: ${esc(item.creator.name)}`);
  if (item.createdAt) meta.push(`Създадена: ${esc(fmtDateTime(item.createdAt))}`);
  if (item.updatedAt) meta.push(`Променена: ${esc(fmtDateTime(item.updatedAt))}`);
  meta.push(`ID ${item.id}`);

  const parts = [];
  if (item.content && item.content.trim()) {
    parts.push(`<h3>Описание</h3><div class="rich">${safeRich(item.content)}</div>`);
  }
  if (item.steps.length) {
    const rows = item.steps.map((s) => `<tr><td>${s.completed ? '✓' : '☐'}</td><td>${esc(s.title)}</td>`
      + `<td>${esc(fmtDate(s.dueOn))}</td>`
      + `<td>${esc(s.assignees.map((a) => a.name).join(', '))}</td></tr>`).join('');
    parts.push(`<h3>Стъпки (${item.steps.length})</h3><table>`
      + '<tr><th></th><th>Стъпка</th><th>Дата</th><th>Кой</th></tr>' + rows + '</table>');
  }
  if (item.time) {
    const who = item.time.byUser.map((u) => `${esc(u.name)} — ${esc(fmtHours(u.seconds))}`).join(', ');
    parts.push(`<h3>Отчетено време (от платформата)</h3><div class="note">`
      + `Общо ${esc(fmtHours(item.time.seconds))} в ${item.time.entries} записа. ${who}</div>`);
  }
  if (item.comments.length) {
    const cmts = item.comments.map((c) => `<div class="cmt"><div class="who">${esc(c.author)} · `
      + `${esc(fmtDateTime(c.createdAt))}</div>${safeRich(c.content)}</div>`).join('');
    parts.push(`<h3>Коментари (${item.comments.length})</h3>${cmts}`);
  }
  if (!parts.length) parts.push('<div class="note">Няма описание, стъпки или коментари.</div>');

  // data-s: всичко търсимо в един низ (заглавие, хора, описание, коментари).
  const haystack = [
    item.title, people,
    String(item.content).replace(/<[^>]*>/g, ' '),
    item.steps.map((s) => s.title).join(' '),
    item.comments.map((c) => `${c.author} ${String(c.content).replace(/<[^>]*>/g, ' ')}`).join(' '),
  ].join(' ').replace(/\s+/g, ' ').toLowerCase().slice(0, 4000);

  const link = item.url ? ` <a href="${esc(item.url)}">отвори в Basecamp ↗</a>` : '';
  return `<details class="${cls.join(' ')}" data-s="${esc(haystack)}">`
    + `<summary><div class="ttl">${esc(item.title || '(без заглавие)')}</div>`
    + `<div class="meta">${tags.join('')}</div>`
    + `<div class="meta">${meta.join(' · ')}${link}</div></summary>`
    + `<div class="body">${parts.join('')}</div></details>`;
}

function renderHtml(snap) {
  const s = snap.stats;
  const kpi = (n, label) => `<div class="kpi"><b>${n}</b><span>${label}</span></div>`;

  const overview = snap.boards.map((b) => {
    const rows = b.columns.map((c) => {
      const open = c.cards.filter((x) => !x.completed && !c.isDone).length;
      const late = c.cards.filter((x) => x.dueOn && x.dueOn < snap.today && !x.completed && !c.isDone && !x.onHold).length;
      const hold = c.cards.filter((x) => x.onHold).length;
      return `<tr><td>${esc(c.title)}</td><td>${c.cards.length}</td><td>${open}</td>`
        + `<td>${hold || ''}</td><td>${late ? `<span class="tag red">${late}</span>` : ''}</td></tr>`;
    }).join('');
    return `<h3>${esc(b.title)}</h3><table>`
      + '<tr><th>Колона</th><th>Общо</th><th>Отворени</th><th>On hold</th><th>Просрочени</th></tr>'
      + rows + '</table>';
  }).join('');

  const boardsHtml = snap.boards.map((b) => {
    const cols = b.columns.map((c) => {
      if (!c.cards.length) return '';
      const cards = c.cards.map((card) => renderItem(card, { today: snap.today, isDone: c.isDone })).join('');
      return `<div data-group><h3>${esc(c.title)} · ${c.cards.length}</h3>${cards}</div>`;
    }).join('');
    return `<h2>${esc(b.title)}</h2>${cols || '<div class="note">Няма карти.</div>'}`;
  }).join('');

  const todosHtml = snap.todoLists.length
    ? snap.todoLists.map((l) => {
      const items = l.items.map((i) => renderItem(i, { today: snap.today, isDone: false })).join('');
      return `<div data-group><h3>${esc(l.set)} → ${esc(l.title)} · ${l.items.length}</h3>`
        + (items || '<div class="note">Няма задачи.</div>') + '</div>';
    }).join('')
    : '';

  const warn = snap.warnings.length
    ? `<div class="panel"><h3>Бележки от изтеглянето</h3><ul>${
      snap.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="bg"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Бекъп · ${esc(snap.project.name)} · ${esc(snap.generatedLocal)}</title>
<style>${STYLE}</style></head><body><div class="wrap">

<h1>Бекъп на ${esc(snap.project.name)}</h1>
<div class="sub">Направен на ${esc(snap.generatedLocal)} · всички дъски, колони и задачи
към този момент · <a href="${esc(snap.project.url)}">проектът в Basecamp ↗</a></div>

<div class="tools">
 <input type="search" id="q" placeholder="Търси в заглавия, описания, стъпки и коментари…">
 <button id="open" type="button">Разгъни всички</button>
 <button id="close" type="button">Сгъни всички</button>
</div>

<div class="panel">
 <div class="grid">
  ${kpi(s.cards, 'карти общо')}
  ${kpi(s.active, 'отворени')}
  ${kpi(s.overdue, 'просрочени')}
  ${kpi(s.onHold, 'on hold')}
  ${kpi(s.done, 'завършени')}
  ${kpi(s.todos, 'to-do задачи')}
  ${kpi(s.comments, 'коментара')}
  ${kpi(fmtHours(s.timeSeconds), 'отчетено време')}
 </div>
 <p class="note" style="margin:14px 0 0">
  Файлът е самостоятелен — отваря се с двоен клик, работи без интернет и без логин.
  Кликни върху задача, за да видиш описанието, стъпките, коментарите и отчетеното време.
  Прикачените файлове и снимките не са вътре — те остават в Basecamp и линковете водят към тях.
 </p>
</div>

${warn}

<h2>Обобщение по дъски</h2>
<div class="panel">${overview}</div>

${boardsHtml}

${todosHtml ? `<h2>To-do списъци</h2>${todosHtml}` : ''}

<p class="note" style="margin-top:40px">
 Изготвено автоматично от платформата (thepact.pro) за ${Math.round(snap.tookMs / 100) / 10} сек.
</p>
</div><script>${SCRIPT}</script></body></html>`;
}

module.exports = { collectSnapshot, renderHtml, fmtHours };
