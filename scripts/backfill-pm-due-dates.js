#!/usr/bin/env node
// Еднократно вкарване на Due дати в дъската „Project Management".
//
// Венци (03.08.2026): много карти в Project Management излизат без дата, защото датата
// никога не е влизала в „Due on" — записана е само в тялото на картата като
// „Дата за публикуване: 19.07.2026". Скриптът я изчита и я записва в Due on.
//
// Правила:
//   * пипа САМО дъската Project Management (всички колони + on-hold секциите);
//   * пипа САМО карти БЕЗ Due date — ръчно въведените дати никога не се презаписват;
//   * PUT-ът на карта в Basecamp е ПЪЛНА ЗАМЯНА — задължително връщаме title + content +
//     assignee_ids, иначе тялото на картата се изтрива (същият капан като при стъпките
//     в bc-date-sync.js). Проверено на живо: content се връща байт в байт същият.
//
// Употреба (от /opt/thepact-platform на VPS-а):
//   node scripts/backfill-pm-due-dates.js            # само показва какво би направил
//   node scripts/backfill-pm-due-dates.js --apply    # записва
require('dotenv').config();
const bc = require('../src/services/basecamp');
const { getServiceAuth } = require('../src/services/basecamp-token');
const config = require('../src/config');

const APPLY = process.argv.includes('--apply');
const PAUSE_MS = 250; // Basecamp пуска 50 заявки / 10 сек — държим се доста под лимита.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- парсване ----------

// Тялото на картата е HTML. Свеждаме го до текст с редове, за да можем да работим
// „до края на реда" — етикетът и датата винаги стоят на един ред.
function toText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '');
}

function isValidYmd(y, m, d) {
  if (y < 2020 || y > 2035 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Година без изписана година („21.07. - тик ток"): избираме годината, при която датата
// пада най-близо до създаването на картата — публикуването е винаги около него.
function inferYear(month, day, createdAt) {
  const base = createdAt ? new Date(createdAt) : new Date();
  const y0 = base.getUTCFullYear();
  let best = null;
  for (const y of [y0 - 1, y0, y0 + 1]) {
    if (!isValidYmd(y, month, day)) continue;
    const diff = Math.abs(Date.UTC(y, month - 1, day) - base.getTime());
    if (!best || diff < best.diff) best = { y, diff };
  }
  return best ? best.y : null;
}

// „Дата за публикуване: 22.07.2026 - Видеото НЕ ГО качваме…" -> 2026-07-22
// Стойността стои ту на същия ред, ту на следващия („Дата за публикуване:\n26.07.2026"),
// затова гледаме текста СЛЕД етикета, без значение от новите редове. Два предпазителя
// срещу случайно число от текста нататък („Z:\Pulse\Контент план 2\Видео 4"):
// датата трябва да е в първите 30 знака И да е първото число след етикета.
const LABEL_RE = /Дата\s*за\s*публикуване/gi;
const DATE_RE = /(\d{1,2})\s*[.\/-]\s*(\d{1,2})(?:\s*[.\/-]\s*(\d{2,4}))?/;
const WINDOW = 30;

function parsePublishDate(text, createdAt) {
  LABEL_RE.lastIndex = 0;
  let m;
  while ((m = LABEL_RE.exec(text)) !== null) {
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 160)
      .replace(/^[\s:：\-–—]+/, '');
    const win = tail.slice(0, WINDOW);
    const d = win.match(DATE_RE);
    if (!d) continue;
    if (/\d/.test(win.slice(0, d.index))) continue; // датата не е първото число -> не е тя
    const day = parseInt(d[1], 10);
    const month = parseInt(d[2], 10);
    let year = d[3] ? parseInt(d[3], 10) : null;
    if (year !== null && year < 100) year += 2000;
    let inferred = false;
    if (year === null) {
      year = inferYear(month, day, createdAt);
      inferred = true;
    }
    if (year === null || !isValidYmd(year, month, day)) continue;
    return { date: ymd(year, month, day), raw: tail.split('\n')[0].trim().slice(0, 50), inferredYear: inferred };
  }
  return null;
}

// ---------- Basecamp ----------

async function findProjectManagementBoard(token, account, projectId) {
  const project = await bc.getProject(token, account, projectId);
  const tools = (project.dock || []).filter((t) => t.enabled && /kanban|card/i.test(t.name));
  for (const t of tools) {
    const table = (await bc.authedGet(t.url, token)).json;
    const title = t.title || table.title;
    if (/project\s*manage|проект\w*\s*мениджм|акаунт\s*мениджм/i.test(title)) {
      return { id: table.id, title, lists: table.lists || [] };
    }
  }
  return null;
}

async function setCardDue(token, account, projectId, card, due) {
  const url = `${bc.API_BASE}/${account}/buckets/${projectId}/card_tables/cards/${card.id}.json`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': config.BASECAMP_USER_AGENT,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      title: card.title,
      content: card.content,
      due_on: due,
      assignee_ids: (card.assignees || []).map((a) => a.id),
    }),
  });
  if (!r.ok) throw new Error(`PUT ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}

async function main() {
  const { token, account } = await getServiceAuth();
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  const board = await findProjectManagementBoard(token, account, projectId);
  if (!board) throw new Error('Дъската „Project Management" не е намерена в проекта');
  console.log(`Дъска: ${board.title} (${board.id})${APPLY ? '' : '   [ПРОБЕН ХОД — нищо не се записва]'}\n`);

  const planned = [];
  const skipped = [];
  let withDue = 0;
  let total = 0;

  for (const list of board.lists) {
    for (const src of [list, list.on_hold].filter(Boolean)) {
      if (!src.cards_count) continue;
      const cards = await bc.getColumnCards(token, account, projectId, src.id);
      const where = list.title + (src !== list ? ' / on-hold' : '');
      for (const c of cards) {
        total++;
        if (c.due_on) { withDue++; continue; }
        const text = `${toText(c.content)}\n${toText(c.description)}`;
        const hit = parsePublishDate(text, c.created_at);
        if (hit) planned.push({ card: c, where, ...hit });
        else skipped.push({ id: c.id, where, title: c.title });
      }
    }
  }

  console.log(`Карти в дъската: ${total} | вече с Due: ${withDue} | без Due: ${total - withDue}`);
  console.log(`Намерена дата в текста: ${planned.length} | без разпозната дата: ${skipped.length}\n`);

  let ok = 0;
  const failed = [];
  for (const p of planned) {
    const note = p.inferredYear ? '  (година по подразбиране от датата на създаване)' : '';
    console.log(`${p.date}  ${p.where.padEnd(22)}  ${p.card.title}   ← "${p.raw}"${note}`);
    if (!APPLY) continue;
    try {
      // Прясно четене на картата преди записа — PUT-ът е пълна замяна, не искаме да
      // пишем върху междувременно редактирано тяло.
      const url = `${bc.API_BASE}/${account}/buckets/${projectId}/card_tables/cards/${p.card.id}.json`;
      const fresh = (await bc.authedGet(url, token)).json;
      if (fresh.due_on) { console.log('   → пропуснато: междувременно е получила Due'); continue; }
      await setCardDue(token, account, projectId, fresh, p.date);
      ok++;
    } catch (e) {
      failed.push({ id: p.card.id, title: p.card.title, err: e.message });
      console.log(`   → ГРЕШКА: ${e.message}`);
    }
    await sleep(PAUSE_MS);
  }

  if (skipped.length) {
    console.log('\nБез разпозната дата (остават без Due):');
    for (const s of skipped) console.log(`  ${s.where.padEnd(22)}  ${s.title}  [${s.id}]`);
  }

  console.log(`\nГотово. ${APPLY ? `записани дати: ${ok}` : 'пробен ход — нищо не е записано'}` +
    (failed.length ? ` | грешки: ${failed.length}` : ''));
}

main().catch((e) => { console.error('Скриптът се провали:', e); process.exit(1); });
