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
// Затова тук няма база и няма мрежа — само заглавие → пътища. Два пътя за разпознаване:
// по префикс (КП/РЕК/КМП) и вратичката „Клиент - Име на задачата" за всичко останало.
// Ако и двете се провалят, връщаме null и задачата остава без блок с локации (по-добре
// нищо, отколкото път, който сочи на грешно място).
//
// Кръстосаните имена (Z:\Pulse Fitness срещу Exported Videos\Pulse) още не са решени —
// засега папката се казва точно както клиентът е изписан в заглавието на задачата.

const bch = require('./bc-html');

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

// Вратичката (решение на Венци, 12.08.2026): задача извън КП/РЕК/КМП също получава
// папка — кръстена на самата задача, направо в главната папка на клиента. Точно както
// на сървъра вече стоят „Credissimo\Кастинг" и „Credissimo\Коледно Парти 2025".
//
// Конвенция: „Клиент - Име на задачата". Разделителят трябва да е тире С ИНТЕРВАЛИ от
// двете страни — иначе почти-правилно заглавие като „Credissimo ADS-8 - Видео 2" би се
// разцепило на глупости. Без такъв разделител не гадаем кой е клиентът и не даваме нищо.
function parseFreeTitle(title) {
  const m = String(title == null ? '' : title).trim().match(/^([^-–—]{1,60}?)\s+[-–—]\s+(.+)$/);
  if (!m) return null;
  const client = safeName(m[1]);
  const name = safeName(m[2]);
  if (!client || !name) return null;
  return { kind: 'free', client, block: null, number: null, videoNumber: null, videoTitle: '', name };
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

// Двете локации за една задача. Първо по префикс (КП/РЕК/КМП), после през вратичката.
// Нищо разпознато → null и задачата остава без блок.
function pathsForTitle(title) {
  const p = parseTaskTitle(title);
  if (p) {
    const videoFolder = p.videoNumber
      ? `Видео ${p.videoNumber}${p.videoTitle ? ' - ' + p.videoTitle : ''}`
      : null;

    const filesWin = ['Z:', p.client, p.block].concat(videoFolder ? [videoFolder] : []).join('\\');
    const exportWin = ['Z:', EXPORT_DIR, p.client, p.block].join('\\');
    return { parsed: p, files: formsFor(filesWin), exported: formsFor(exportWin) };
  }

  const f = parseFreeTitle(title);
  if (!f) return null;
  return {
    parsed: f,
    files: formsFor(['Z:', f.client, f.name].join('\\')),
    exported: formsFor(['Z:', EXPORT_DIR, f.client, f.name].join('\\')),
  };
}

// Един блок („Локация на файлове" + трите реда) като редове inline HTML.
// Заглавието е оцветено, не удебелено — виж services/bc-html.js.
function blockLines(heading, f) {
  return [
    bch.mark(heading),
    `Windows: ${bch.esc(f.win)}`,
    `Mac: ${bch.esc(f.mac)}`,
    `<a href="${bch.escAttr(f.url)}">ОТВОРИ ПАПКА</a>`,
  ];
}

// Двата блока с локации като редове (готов inline HTML), за вграждане в ОБЩИЯ Trix
// блок на описанието — отделни <div>-ове тук биха се сплескали при първото отваряне
// на картата за редакция. Празен масив, ако заглавието не се разпознава.
function locationLines(title) {
  const p = pathsForTitle(title);
  if (!p) return [];
  return blockLines('Локация на файлове:', p.files)
    .concat(blockLines('Локация на експортираното видео:', p.exported));
}

// Блокът стои ГОРЕ (решение на Венци, 12.08.2026): веднага след водещите редове от вида
// „/Участници - ХХХ/" и преди „Описание:". Тук връщаме текста, разцепен на мястото на
// вмъкване, за да може всеки от двата пътя за създаване на карти да си сглоби HTML-а сам.
//
// Ако няма нито „Описание:", нито водещи /…/ редове — блокът пада най-отдолу, както беше.
function splitForLocation(text) {
  const lines = String(text == null ? '' : text).split('\n');

  let idx = lines.findIndex((l) => /^\s*Описание\s*:/i.test(l));
  if (idx === -1) {
    let last = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (i === 0 && /^Видео\s+\d+\s*[-–—]/i.test(t)) continue; // заглавният ред на секцията
      if (/^\/.*\/$/.test(t)) { last = i; continue; }
      if (t === '' && last === -1) continue;
      break;
    }
    idx = last === -1 ? lines.length : last + 1;
  }

  // Празните редове от двете страни на мястото ги изяждаме — блокът си носи свой отстъп,
  // иначе се получава двойна дупка над и под него.
  let end = idx;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  let start = idx;
  while (start < lines.length && lines[start].trim() === '') start++;

  return { before: lines.slice(0, end).join('\n'), after: lines.slice(start).join('\n') };
}

module.exports = {
  parseTaskTitle, parseFreeTitle, pathsForTitle, locationLines, splitForLocation, safeName,
  SHARE_HOST, SHARE_NAME, EXPORT_DIR,
};
