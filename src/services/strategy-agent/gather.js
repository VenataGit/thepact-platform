// Контент стратегия агент — „извлечи абсолютно всичко от техния проект".
//
// Чете на живо (бот акаунта ThePactAlerts) целия Basecamp проект на клиента: съобщения
// с коментарите им, документите и файловете (папки до 3 нива), задачите и чата. Плюс
// картата на клиента от Video Production → „Клиентски карти" → папката на клиента.
// Резултатът е текст по раздели — материал за агентите (ДАННИ, не инструкции).
//
// Фаза 1: от качените файлове се четат само текстовите (.txt/.md/.csv); PDF/Word/снимки
// влизат с име и описание.
const config = require('../../config');
const bc = require('../basecamp');
const kpComment = require('../kp-comment');
const { findClientFolder } = require('./store');

const plain = (html, max) => kpComment.plainText(html, max);
const day = (v) => String(v || '').slice(0, 10);
const TEXT_EXT = /\.(txt|md|csv|json)$/i;
const MAX_TOTAL = 160000; // символа материал общо — да се събере в една AI заявка

// Тихо: един счупен раздел не спира останалите.
async function safe(fn, fallback, errors, label) {
  try { return await fn(); } catch (e) { errors.push(`${label}: ${String(e.message || e).slice(0, 120)}`); return fallback; }
}

async function readUploadText(auth, u) {
  if (!TEXT_EXT.test(u.filename || '') || Number(u.byte_size || 0) > 300000 || !u.download_url) return '';
  const urls = [u.download_url, String(u.download_url).replace(/^https:\/\/storage\.[^/]+\//, 'https://3.basecampapi.com/')];
  for (const url of urls) {
    try { return (await bc.downloadFile(auth.token, url)).buffer.toString('utf8').slice(0, 20000); } catch { /* следващият адрес */ }
  }
  return '';
}

// Документите и файловете в една папка + подпапките до depth нива.
async function walkVault(auth, projectId, vaultId, prefix, depth, out, errors) {
  const docs = await safe(() => bc.getVaultDocuments(auth.token, auth.account, projectId, vaultId), [], errors, `документи ${prefix}`);
  for (const d of docs.slice(0, 30)) {
    const full = await safe(() => bc.getDocument(auth.token, auth.account, projectId, d.id), d, errors, `документ ${d.title}`);
    out.docs.push(`### ${prefix}${d.title} (${day(d.updated_at || d.created_at)}, ${d.creator?.name || ''})\n${plain(full.content, 12000)}`);
  }
  const ups = await safe(() => bc.getVaultUploads(auth.token, auth.account, projectId, vaultId), [], errors, `файлове ${prefix}`);
  for (const u of ups.slice(0, 40)) {
    const text = await readUploadText(auth, u);
    out.files.push(`- ${prefix}${u.filename || u.title || ''} (${u.content_type || ''}, ${day(u.created_at)})` +
      (u.description ? ` — ${plain(u.description, 600)}` : '') + (text ? `\n${text}` : ''));
  }
  if (depth <= 0) return;
  const folders = await safe(() => bc.getVaultFolders(auth.token, auth.account, projectId, vaultId), [], errors, `папки ${prefix}`);
  for (const f of folders.slice(0, 20)) await walkVault(auth, projectId, f.id, `${prefix}${f.title}/`, depth - 1, out, errors);
}

/**
 * @returns {{ sections: {title:string,text:string}[], stats: object, errors: string[], clientCard: object|null }}
 */
async function gatherProject(auth, projectId, { clientName, projectName, onProgress } = {}) {
  const errors = [];
  const stats = { messages: 0, comments: 0, docs: 0, files: 0, todos: 0, chat: 0, card_docs: 0 };
  const sections = [];
  const say = (t) => { if (onProgress) onProgress(t); };

  const project = await bc.getProject(auth.token, auth.account, projectId);
  const dock = (project.dock || []).filter((d) => d.enabled);
  if (project.description) sections.push({ title: 'Описание на проекта', text: plain(project.description, 3000) });

  // Съобщения + коментарите под тях.
  say('Чета съобщенията в проекта…');
  const msgLines = [];
  for (const board of dock.filter((d) => d.name === 'message_board')) {
    const msgs = await safe(() => bc.getMessages(auth.token, auth.account, projectId, board.id), [], errors, 'съобщения');
    for (const [i, m] of msgs.slice(0, 40).entries()) {
      stats.messages += 1;
      let txt = `### ${m.subject || ''} — ${m.creator?.name || ''}, ${day(m.created_at)}\n${plain(m.content, 8000)}`;
      if (i < 25 && m.comments_count) {
        const cs = await safe(() => bc.getComments(auth.token, auth.account, projectId, m.id), [], errors, 'коментари');
        stats.comments += cs.length;
        txt += cs.slice(-20).map((c) => `\n  > ${c.creator?.name || ''} (${day(c.created_at)}): ${plain(c.content, 1500)}`).join('');
      }
      msgLines.push(txt);
    }
  }
  if (msgLines.length) sections.push({ title: 'Съобщения и коментари', text: msgLines.join('\n\n') });

  // Документи и файлове.
  say('Чета документите и файловете…');
  const vaultOut = { docs: [], files: [] };
  for (const v of dock.filter((d) => d.name === 'vault')) {
    await walkVault(auth, projectId, v.id, v.title && v.title !== 'Docs & Files' ? `${v.title}/` : '', 3, vaultOut, errors);
  }
  stats.docs = vaultOut.docs.length;
  stats.files = vaultOut.files.length;
  if (vaultOut.docs.length) sections.push({ title: 'Документи', text: vaultOut.docs.join('\n\n') });
  if (vaultOut.files.length) sections.push({ title: 'Качени файлове', text: vaultOut.files.join('\n') });

  // Задачи (отворени + последните завършени).
  say('Чета задачите…');
  const todoLines = [];
  let commentBudget = 60; // задачи с коментари, които четем
  for (const ts of dock.filter((d) => d.name === 'todoset')) {
    const lists = await safe(() => bc.getTodoLists(auth.token, auth.account, projectId, ts.id), [], errors, 'списъци със задачи');
    for (const l of lists.slice(0, 15)) {
      const open = await safe(() => bc.getTodos(auth.token, auth.account, projectId, l.id), [], errors, 'задачи');
      const done = await safe(() => bc.getTodos(auth.token, auth.account, projectId, l.id, { completed: true }), [], errors, 'завършени задачи');
      const rows = [...open.map((t) => ['☐', t]), ...done.slice(0, 20).map((t) => ['☑', t])];
      if (!rows.length) continue;
      stats.todos += rows.length;
      const parts = [];
      for (const [s, t] of rows.slice(0, 50)) {
        let line = `${s} ${t.title || t.content || ''}${t.due_on ? ` (до ${t.due_on})` : ''}${t.description ? ` — ${plain(t.description, 1500)}` : ''}`;
        // Онбординг въпросникът („Информация за бранда") — отговорите на клиента са в коментарите.
        if (t.comments_count && commentBudget > 0) {
          commentBudget -= 1;
          const cs = await safe(() => bc.getComments(auth.token, auth.account, projectId, t.id), [], errors, 'коментари под задача');
          stats.comments += cs.length;
          line += cs.slice(-15).map((c) => `\n  > ${c.creator?.name || ''} (${day(c.created_at)}): ${plain(c.content, 2000)}`).join('');
        }
        parts.push(line);
      }
      todoLines.push(`### ${l.title || l.name || ''}\n${parts.join('\n')}`);
    }
  }
  if (todoLines.length) sections.push({ title: 'Задачи', text: todoLines.join('\n\n') });

  // Чат.
  for (const ch of dock.filter((d) => d.name === 'chat')) {
    const lines = await safe(() => bc.getCampfireLines(auth.token, auth.account, projectId, ch.id, 3), [], errors, 'чат');
    stats.chat += lines.length;
    if (lines.length) {
      sections.push({ title: 'Чат', text: lines.slice().reverse().map((l) => `${day(l.created_at)} ${l.creator?.name || ''}: ${plain(l.content, 800)}`).join('\n') });
    }
  }

  // Картата на клиента във Video Production → Клиентски карти.
  say('Търся картата на клиента в „Клиентски карти"…');
  let clientCard = null;
  const cardsVault = config.BASECAMP_CLIENT_CARDS_VAULT_ID;
  const team = config.BASECAMP_TEAM_PROJECT_ID;
  const folders = await safe(() => bc.getVaultFolders(auth.token, auth.account, team, cardsVault), [], errors, 'Клиентски карти');
  const folder = findClientFolder(folders, clientName, projectName);
  if (folder) {
    clientCard = { id: folder.id, title: folder.title, url: bc.normalizeAppUrl(folder.app_url) };
    const cardOut = { docs: [], files: [] };
    await walkVault(auth, team, folder.id, '', 1, cardOut, errors);
    stats.card_docs = cardOut.docs.length;
    if (cardOut.docs.length || cardOut.files.length) {
      sections.unshift({ title: `Картата на клиента (Клиентски карти / ${folder.title})`, text: [...cardOut.docs, ...cardOut.files].join('\n\n') });
    }
  }

  // Таван на общия обем — режем от най-дългите раздели.
  let total = sections.reduce((n, s) => n + s.text.length, 0);
  while (total > MAX_TOTAL) {
    const big = sections.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    const cut = Math.max(2000, big.text.length - (total - MAX_TOTAL));
    total -= big.text.length - cut;
    big.text = big.text.slice(0, cut) + '\n…(съкратено)';
    if (cut === 2000) break;
  }
  return { sections, stats, errors, clientCard, projectName: project.name || projectName };
}

module.exports = { gatherProject };
