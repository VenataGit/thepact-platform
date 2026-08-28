// Парсване на Basecamp контент-план карта ("Видео N - Заглавие" секции + дати).
//
// Изнесено от routes/kp-split.js, защото вече има двама потребители:
//   kp-split  — създава по една карта на видео (нужни са му и attachments).
//   kp-results — брои видеата по плана и вади датите на публикуване за тези,
//                за които още няма създадена карта.
//
// Media is pulled out as whole-line placeholder tokens ("A<idx>") so each can be
// re-uploaded and re-embedded in place; text is preserved. Headings ("Видео N - …")
// may sit mid-paragraph (Basecamp <br>-separates them), so splitting is line-based
// after a tag→text pass. Placeholders are matched LINE-ANCHORED to avoid collisions.
const ATTACH_RE = /<bc-attachment\b[^>]*>[\s\S]*?<\/bc-attachment>/gi;

function attrOf(html, name) {
  const m = html.match(new RegExp('\\b' + name + '="([^"]*)"', 'i'));
  return m ? m[1] : '';
}

function parseAttachment(html) {
  return {
    sgid: attrOf(html, 'sgid'),
    href: attrOf(html, 'href') || attrOf(html, 'url'), // href = the real download URL (in `description`)
    contentType: attrOf(html, 'content-type'),
    filename: attrOf(html, 'filename') || attrOf(html, 'alt') || 'file',
    caption: attrOf(html, 'caption'),
    filesize: parseInt(attrOf(html, 'filesize') || '0', 10),
  };
}

// <a href="URL">TEXT</a> → "TEXT (URL)" (или само URL-а, ако текстът на връзката си Е
// URL-ът) — иначе генералният tag-stripper по-долу изтрива и тага, и адреса, и
// линкът изчезва безследно (Венци, 28.08.2026: "хипервръзки ... не пренасяха").
// Адресът остава като чист текст в sectionText; bc-html.js го превръща обратно в
// кликаема връзка, когато секцията се излива в новата карта.
const LINK_RE = /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

function linkToText(href, inner) {
  const url = String(href || '').trim();
  const text = String(inner || '').replace(/<[^>]+>/g, '').trim();
  if (!url) return text;
  const norm = (s) => s.replace(/\/+$/, '').toLowerCase();
  if (!text || norm(text) === norm(url)) return url;
  return text + ' (' + url + ')';
}

// Получер/курсив/зачеркнат/оцветяване от Trix → обикновени маркери в текста, СЪЩАТА
// причина като при връзките: генералният tag-stripper по-долу маха тага заедно със
// смисъла му (Венци, 28.08.2026: "оцветявания ... болдване, италик, зачеркване").
// bc-html.js/line() ги разпознава по маркерите и ги връща обратно в реални тагове.
function fmtToMarkers(html) {
  return String(html || '')
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (m, inner) => '**' + inner + '**')
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (m, inner) => '_' + inner + '_')
    .replace(/<(?:del|s|strike)\b[^>]*>([\s\S]*?)<\/(?:del|s|strike)>/gi, (m, inner) => '~~' + inner + '~~')
    .replace(/<mark\b[^>]*>([\s\S]*?)<\/mark>/gi, (m, inner) => '^^' + inner + '^^');
}

function htmlToText(html) {
  return fmtToMarkers(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(LINK_RE, (m, href, inner) => linkToText(href, inner))
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// Returns { sections:[{videoNumber,title,sectionText}], attachments:[{href,...}], header }.
// `header` = редовете ПРЕДИ първата „Видео N" секция (там стои списъкът с датите
// за публикуване, който parsePlanDates чете).
function parsePlan(html) {
  const attachments = [];
  const withPlaceholders = (html || '').replace(ATTACH_RE, (m) => {
    const i = attachments.length;
    attachments.push(parseAttachment(m));
    return '\nA' + i + '\n';
  });
  const sections = [];
  const headerLines = [];
  let cur = null, curLines = [];
  for (const raw of htmlToText(withPlaceholders).split('\n')) {
    const line = raw.trim();
    const m = line.match(/^Видео\s+(\d+)\s*[-–—]\s*(.+)$/);
    if (m) {
      if (cur) sections.push({ ...cur, sectionText: curLines.join('\n') });
      cur = { videoNumber: parseInt(m[1], 10), title: m[2].trim() };
      curLines = [line];
    } else if (cur) { curLines.push(raw); }
    else { headerLines.push(raw); }
  }
  if (cur) sections.push({ ...cur, sectionText: curLines.join('\n') });
  return { sections, attachments, header: headerLines.join('\n') };
}

// "Дата на/за публикуване - DD.MM.YYYY" → YYYY-MM-DD.
function parsePublishDate(text) {
  if (!text) return null;
  const m = text.match(/Дата\s+(?:на|за)\s+публикуване\s*[-–—:]?\s*(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/i);
  if (!m) return null;
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// Планът идва в `description` (card table карта) или `content` — според endpoint-а.
function planHtml(card) { return (card && (card.description || card.content)) || ''; }

// ---------------------------------------------------------------------------
// Датите: четене на подготвения списък ГОРЕ в плана + редактиране на датата на
// едно видео (поискано от Венци, 21.08.2026 — „Създай задачи по КП").
// ---------------------------------------------------------------------------

function isoOf(d, mo, y) {
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// 'YYYY-MM-DD' → 'DD.MM.YYYY' (както се пише в текста на плана).
function isoToBg(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[3] + '.' + m[2] + '.' + m[1] : '';
}

const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// Всички DD.MM.YYYY в даден текст, в реда на появяване.
function allDates(str) {
  const out = [];
  const re = /(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/g;
  let m;
  while ((m = re.exec(String(str || '')))) {
    const iso = isoOf(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
    if (iso) out.push(iso);
  }
  return out;
}

// Подготвените дати за публикуване от главата на плана. Първо търсим блока
// „Дати за публикуване на видеа:" и вземаме редовете под него; ако такъв блок
// няма (стари/ръчни планове), падаме на всички дати в главата. Без дубликати.
function parsePlanDates(headerText) {
  const lines = String(headerText || '').split('\n');
  const start = lines.findIndex((l) => /^\s*Дати\s+за\s+публикуване/i.test(l));
  const out = [];
  const add = (iso) => { if (iso && !out.includes(iso)) out.push(iso); };
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === '') { if (out.length) break; continue; }
      const found = allDates(t);
      if (!found.length) break;
      found.forEach(add);
    }
    if (out.length) return out;
  }
  allDates(headerText).forEach(add);
  return out;
}

// Етикетът на реда с датата в една видео-секция. Отрицателният lookahead пази
// заглавния ред от главата на плана („Дата за публикуване на първо видео: …").
const PUBLISH_LABEL_RE = /Дата\s+(?:на|за)\s+публикуване(?!\s+на\s+пър)\s*[-–—:]?/i;
const DATE_ONE_RE = /(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/;
const PLACEHOLDER_RE = /[ХXхx]{2,}/;
// Краят на реда в Trix HTML — текстът върви в един блок, разделен с <br>.
const LINE_END_RE = /<br\s*\/?>|<\/div>|<\/p>/i;

// Границите на секцията на едно видео в СУРОВИЯ HTML (заглавието е контекстен
// текст, така че се намира и когато е обвито в <mark>/<strong>).
function sectionBoundsInHtml(html, videoNumber) {
  const re = /Видео\s+(\d+)\s*[-–—]/g;
  let m, start = -1, end = html.length;
  while ((m = re.exec(html))) {
    if (start >= 0) { end = m.index; break; }
    if (parseInt(m[1], 10) === videoNumber) start = m.index;
  }
  return start < 0 ? null : [start, end];
}

/**
 * Сменя датата за публикуване на едно видео направо в HTML-а на КП картата.
 * Пипа САМО стойността след етикета — целият останал текст, оцветяванията и
 * прикачените файлове остават непокътнати.
 * @returns {{ html: string, ok: boolean, inserted?: boolean, reason?: string }}
 */
function setPublishDateInHtml(html, videoNumber, iso) {
  const src = String(html || '');
  if (!isIso(iso)) return { html: src, ok: false, reason: 'bad-date' };
  const bounds = sectionBoundsInHtml(src, videoNumber);
  if (!bounds) return { html: src, ok: false, reason: 'no-section' };
  const [start, end] = bounds;
  const bg = isoToBg(iso);
  const seg = src.slice(start, end);

  const lm = seg.match(PUBLISH_LABEL_RE);
  if (!lm) {
    // Няма ред за дата — слагаме го веднага под заглавието на видеото (в същия
    // Trix блок, за да не се сплеска при първата редакция).
    const le = seg.search(LINE_END_RE);
    const at = le === -1 ? seg.length : le;
    const ins = '<br>Дата за публикуване: ' + bg;
    return { html: src.slice(0, start + at) + ins + src.slice(start + at), ok: true, inserted: true };
  }

  const vStart = lm.index + lm[0].length;
  const rest = seg.slice(vStart);
  const le = rest.search(LINE_END_RE);
  const cut = le === -1 ? rest.length : le;
  let chunk = rest.slice(0, cut);
  if (DATE_ONE_RE.test(chunk)) chunk = chunk.replace(DATE_ONE_RE, bg);
  else if (PLACEHOLDER_RE.test(chunk)) chunk = chunk.replace(PLACEHOLDER_RE, bg);
  else chunk = chunk.replace(/\s+$/, '') + ' ' + bg;
  if (!/^[\s<]/.test(chunk)) chunk = ' ' + chunk;

  const newSeg = seg.slice(0, vStart) + chunk + rest.slice(cut);
  return { html: src.slice(0, start) + newSeg + src.slice(end), ok: true };
}

// Същото, но върху обикновения текст на секцията — това е текстът, който отива
// в описанието на новата карта, така че двете места да казват едно и също.
function setPublishDateInText(text, iso) {
  if (!isIso(iso)) return String(text || '');
  const bg = isoToBg(iso);
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(PUBLISH_LABEL_RE);
    if (!m) continue;
    lines[i] = lines[i].slice(0, m.index + m[0].length) + ' ' + bg;
    return lines.join('\n');
  }
  lines.push('Дата за публикуване: ' + bg);
  return lines.join('\n');
}

module.exports = {
  parsePlan, parsePublishDate, planHtml, htmlToText,
  parsePlanDates, isoToBg, allDates,
  setPublishDateInHtml, setPublishDateInText,
};
