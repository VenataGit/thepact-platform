// Архивът на контент плановете (Венци, 22.08.2026, задача „Създай задачи по КП").
//
// Разбие ли се един КП на задачи, планът е свършил работата си като карта — но
// идеите в него трябва да останат търсими. Затова текстът му отива на две места:
//
//   1. Basecamp → Docs & Files → „Контент планове - Архив" → папка на клиента.
//      Пази се като ДОКУМЕНТ, не като качен .txt файл. Причината е практическа:
//      качен файл не може да се дописва, а общият файл („всички планове на едно
//      място") живее точно от дописването. Документът е и търсим от самия Basecamp,
//      освен с Ctrl+F в браузъра.
//   2. Вътрешният сървър → Z:\Контент планове - Архив\<Клиент>\<име на плана>.txt.
//      Платформата няма достъп до Z: — пише заявка в опашката, а агентът в офиса
//      прави файла (services/folder-queue.js → folder-agent/worker.js).
//
// И на двете места има и ЕДИН общ файл с всичко, за да се търси идея през всички
// планове наведнъж.
//
// Оригиналната карта НЕ се изпразва — архивът е копие. Картата само отива в Done.
const config = require('../config');
const bc = require('./basecamp');
const fp = require('./folder-paths');
const fq = require('./folder-queue');
const kpPlan = require('./kp-plan');

const ARCHIVE_ROOT = 'Z:\\Контент планове - Архив';
const MASTER_TITLE = 'Всички контент планове';
const MASTER_FILE = ARCHIVE_ROOT + '\\' + MASTER_TITLE + '.txt';
const OTHER_FOLDER = 'Други'; // клиент, който не се разпознава от заглавието

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const norm = (s) => String(s || '').trim().toLowerCase();

// Името на клиента от заглавието на плана („Credissimo КП-12" → „Credissimo").
function clientOf(planTitle) {
  const p = fp.parseTaskTitle(planTitle);
  if (p && p.client) return p.client;
  const f = fp.parseFreeTitle(planTitle);
  if (f && f.client) return f.client;
  return OTHER_FOLDER;
}

// Целият план като обикновен текст. Прикачените файлове не могат да отидат в текстов
// архив — на тяхно място остава името им, за да се вижда какво е имало.
function planToText(html) {
  const withNames = String(html || '').replace(
    /<bc-attachment\b[^>]*>[\s\S]*?<\/bc-attachment>/gi,
    (m) => {
      const n = m.match(/\bfilename="([^"]*)"/i) || m.match(/\balt="([^"]*)"/i);
      return '\n[файл: ' + (n ? n[1] : 'без име') + ']\n';
    }
  );
  return kpPlan.htmlToText(withNames)
    .split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Заглавният ред на един запис в общия файл — по него се разбира кой план е.
function entryHeader(planTitle, archivedOn) {
  return '=========== ' + planTitle + ' — архивиран на ' + kpPlan.isoToBg(archivedOn) + ' ===========';
}

// Текстът на един архивен запис (същият и за Basecamp, и за сървъра).
function entryText(planTitle, planText, archivedOn) {
  return entryHeader(planTitle, archivedOn) + '\n\n' + planText + '\n';
}

// Обикновен текст → HTML за документ в Basecamp: по един <div> на абзац, с <br>
// между редовете. Документите не минават през Trix-капана на описанията на картите
// (там празните редове изчезваха), затова тук форматът е простият.
function textToDocHtml(text) {
  return String(text || '').split(/\n{2,}/)
    .map((block) => '<div>' + block.split('\n').map(esc).join('<br>') + '</div>')
    .join('');
}

// Папката на клиента в архива — намира съществуващата или прави нова.
async function ensureClientFolder(auth, projectId, vaultId, clientName) {
  const folders = await bc.getVaultFolders(auth.token, auth.account, projectId, vaultId);
  const hit = (folders || []).find((f) => norm(f.title) === norm(clientName));
  if (hit) return { id: hit.id, title: hit.title, created: false, url: bc.normalizeAppUrl(hit.app_url) };
  const made = await bc.createVaultFolder(auth.token, auth.account, projectId, vaultId, clientName);
  return { id: made.id, title: made.title, created: true, url: bc.normalizeAppUrl(made.app_url) };
}

// Документ по заглавие в дадена папка: презаписва съществуващия или прави нов.
// `append` = дописва отдолу, вместо да замени (общият файл).
async function upsertDocument(auth, projectId, vaultId, title, text, { append = false } = {}) {
  const docs = await bc.getVaultDocuments(auth.token, auth.account, projectId, vaultId);
  const hit = (docs || []).find((d) => norm(d.title) === norm(title));
  if (!hit) {
    const made = await bc.createDocument(auth.token, auth.account, projectId, vaultId, {
      title, content: textToDocHtml(text),
    });
    return { id: made.id, url: bc.normalizeAppUrl(made.app_url), created: true };
  }
  let content = textToDocHtml(text);
  if (append) {
    // Дописваме към ТЕКУЩОТО съдържание — затова се чете пълният документ (списъкът
    // не носи `content`).
    const full = await bc.getDocument(auth.token, auth.account, projectId, hit.id);
    content = (full.content || '') + content;
  }
  const saved = await bc.updateDocument(auth.token, auth.account, projectId, hit.id, { title: hit.title, content });
  return { id: saved.id, url: bc.normalizeAppUrl(saved.app_url), created: false };
}

/**
 * Архивира един контент план на двете места. Никога не хвърля — задачите вече са
 * създадени и архивът не бива да ги събаря; всичко се връща в отчета.
 *
 * @param {object} p
 * @param {object} p.auth        { token, account }
 * @param {number} p.projectId
 * @param {string} p.planTitle   заглавието на КП картата
 * @param {string} p.planHtml    описанието ѝ (вече с евентуално сменените дати)
 * @param {string} p.archivedOn  'YYYY-MM-DD'
 */
async function archivePlan({ auth, projectId, planTitle, planHtml, archivedOn }) {
  const out = { client: clientOf(planTitle), basecamp: null, server: null };
  const text = planToText(planHtml);
  const entry = entryText(planTitle, text, archivedOn);

  // --- Basecamp: Docs & Files ---
  try {
    const vaultId = config.BASECAMP_KP_ARCHIVE_VAULT_ID;
    if (!vaultId) throw new Error('няма настроена папка за архива');
    const folder = await ensureClientFolder(auth, projectId, vaultId, out.client);
    const doc = await upsertDocument(auth, projectId, folder.id, planTitle, entry);
    let master = null;
    try {
      master = await upsertDocument(auth, projectId, vaultId, MASTER_TITLE, '\n' + entry, { append: true });
    } catch (e) {
      console.error('[kp-archive] master doc:', e.message);
      out.masterError = e.message;
    }
    out.basecamp = {
      folder: folder.title, folderCreated: folder.created,
      doc: planTitle, docUrl: doc.url, docCreated: doc.created,
      master: master ? MASTER_TITLE : null, masterUrl: master ? master.url : null,
    };
  } catch (e) {
    console.error('[kp-archive] basecamp:', e.message);
    out.basecampError = e.message;
  }

  // --- Вътрешният сървър (през опашката към агента в офиса) ---
  try {
    const file = ARCHIVE_ROOT + '\\' + fp.safeName(out.client) + '\\' + fp.safeName(planTitle) + '.txt';
    const one = await fq.enqueueText({ title: planTitle, filePath: file, content: entry, append: false });
    const all = await fq.enqueueText({ title: MASTER_TITLE, filePath: MASTER_FILE, content: '\n' + entry, append: true });
    out.server = { file, queued: [one, all].filter(Boolean).length };
  } catch (e) {
    console.error('[kp-archive] server queue:', e.message);
    out.serverError = e.message;
  }

  return out;
}

module.exports = {
  ARCHIVE_ROOT, MASTER_TITLE, MASTER_FILE, OTHER_FOLDER,
  clientOf, planToText, entryText, textToDocHtml,
  ensureClientFolder, upsertDocument, archivePlan,
};
