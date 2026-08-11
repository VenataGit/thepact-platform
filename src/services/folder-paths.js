// Локациите на файловете във вътрешния сървър, сглобени от ЗАГЛАВИЕТО на задачата.
//
// Решенията на Венци (11.08.2026, задача „Автоматизация в създаване на пътища"):
//   - името на папката следва префикса на задачата;
//   - „Контент план N" за органиката, „Реклами N" за рекламите — до главната папка на
//     клиента, а не в отделно ниво по услуга;
//   - папката на едно видео носи и заглавието: „Видео 4 - Как се прави";
//   - експортнатото е под ЕДНА папка за целия блок, без папка на видео;
//   - правилото важи за новите задачи, а източник на истината е името в Basecamp.
//
// Затова тук няма база и няма мрежа — само заглавие → пътища. Ако заглавието не следва
// конвенцията, връщаме null и задачата просто остава без блок с локации (по-добре нищо,
// отколкото път, който сочи на грешно място).
//
// Кръстосаните имена (Z:\Pulse Fitness срещу Exported Videos\Pulse) още не са решени —
// засега папката се казва точно както клиентът е изписан в заглавието на задачата.

const SHARE_HOST = '192.168.31.147';
const SHARE_NAME = 'Production';
const EXPORT_DIR = 'Exported Videos';
const PUBLIC_URL = 'https://thepact.pro';

// Префикс в заглавието → име на папката в главната папка на клиента.
const KINDS = [
  { key: 'kp', re: /^(?:КП|KP)$/i, folder: (n) => `Контент план ${n}` },
  { key: 'ads', re: /^(?:РЕК|REK)$/i, folder: (n) => `Реклами ${n}` },
  { key: 'campaign', re: /^(?:КМП|KMP)$/i, folder: (n) => `Кампания ${n}` },
];

// Windows не приема тези знаци в име на папка; точка/интервал накрая също чупи.
function safeName(s) {
  return String(s == null ? '' : s)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120);
}

// „Credissimo КП-12 - Видео 4 - Как се прави" → { client, kind, number, videoNumber, videoTitle }
// Търпи „КП 12", „КП-012", тире/дълго тире, както и опашка след номера („… контент план").
function parseTaskTitle(title) {
  const m = String(title == null ? '' : title).trim()
    .match(/^(.+?)\s+([А-Яа-яA-Za-z]{2,3})\s*[-–—]?\s*0*(\d+)\b(.*)$/);
  if (!m) return null;

  const kind = KINDS.find((k) => k.re.test(m[2]));
  if (!kind) return null;

  const client = safeName(m[1]);
  const number = parseInt(m[3], 10);
  if (!client || !Number.isFinite(number) || number < 1) return null;

  const out = { client, kind: kind.key, number, block: kind.folder(number), videoNumber: null, videoTitle: '' };

  const vm = String(m[4] || '').match(/^\s*[-–—]\s*Видео\s*0*(\d+)\s*(?:[-–—]\s*(.+))?$/i);
  if (vm) {
    out.videoNumber = parseInt(vm[1], 10);
    out.videoTitle = safeName(vm[2] || '');
  }
  return out;
}

// Windows път → останалите две форми (Mac + линкът, който отваря папката и на двете).
function formsFor(winPath) {
  const rel = winPath.replace(/^Z:\\/, '').replace(/\\/g, '/');
  return {
    win: winPath,
    mac: `/Volumes/${SHARE_NAME}/${rel}`,
    smb: `smb://${SHARE_HOST}/${SHARE_NAME}/${encodeURI(rel)}`,
    url: `${PUBLIC_URL}/go/folder?p=${encodeURIComponent(winPath)}`,
  };
}

// Двете локации за една задача. Без разпознат префикс → null.
function pathsForTitle(title) {
  const p = parseTaskTitle(title);
  if (!p) return null;

  const videoFolder = p.videoNumber
    ? `Видео ${p.videoNumber}${p.videoTitle ? ' - ' + p.videoTitle : ''}`
    : null;

  const filesWin = ['Z:', p.client, p.block].concat(videoFolder ? [videoFolder] : []).join('\\');
  const exportWin = ['Z:', EXPORT_DIR, p.client, p.block].join('\\');

  return { parsed: p, files: formsFor(filesWin), exported: formsFor(exportWin) };
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Един блок („Локация на файлове" + трите реда) като Basecamp HTML.
function blockHtml(heading, f) {
  return [
    `<div><strong>${esc(heading)}</strong></div>`,
    `<div>Windows: ${esc(f.win)}</div>`,
    `<div>Mac: ${esc(f.mac)}</div>`,
    `<div><a href="${esc(f.url)}">ОТВОРИ ПАПКА</a></div>`,
  ].join('');
}

// Готовият блок за долния край на описанието. Празен низ, ако заглавието не се разпознава.
function locationHtml(title) {
  const p = pathsForTitle(title);
  if (!p) return '';
  return '<div><br></div>'
    + blockHtml('Локация на файлове', p.files)
    + '<div><br></div>'
    + blockHtml('Локация на експортираното видео', p.exported);
}

module.exports = { parseTaskTitle, pathsForTitle, locationHtml, safeName, SHARE_HOST, SHARE_NAME, EXPORT_DIR };
