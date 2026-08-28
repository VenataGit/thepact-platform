// Описанието на една карта в Basecamp: как се излива в HTML, така че Trix (редакторът
// на Basecamp) да го върне НЕПРОМЕНЕНО след първата редакция.
//
// Два проблема, докладвани от Венци (20.08.2026, „Описание на задачи - структура"):
//
// 1) Празните редове изчезваха. Trix държи обикновения текст в ЕДИН блок с <br> между
//    редовете, а празният ред е просто още едно <br>. Пътищата за създаване на карти
//    обаче пишеха по един <div> на ред и <div><br></div> за празните. В режим на четене
//    изглежда правилно, но щом картата се отвори за редакция, Trix преразбира HTML-а,
//    изхвърля празните блокове и разделителите пропадат — завинаги, защото следващият
//    запис връща вече сплескания текст.
//
// 2) Липсваше оцветяването на заглавията (а и <strong> не е това, което се иска).
//
// Затова цялото описание минава оттук — едно място, което знае и формата, и цветовете.

// Първият (най-вляво) highlight цвят на Basecamp, изписан ТОЧНО както го записва
// самият Basecamp в rich text-а: <mark> с inline background-color.
//
// Защо литералът rgb(250, 247, 133), а не голо <mark>: голият таг минава през API-то,
// но Trix не го припознава като highlight — цветът не се вижда и изчезва при първия
// запис от edit режим. С inline стила Trix вижда своя highlight атрибут и го връща
// обратно при запис, тоест оцветяването преживява редакцията.
//
// (Същият цвят в тъмната тема на Basecamp се смята като #51462D — това е една и съща
// боя, само променливата на темата е различна. Пишем литерала, защото той е формата,
// която Basecamp пази и рендерира навсякъде — включително в имейлите.)
const HIGHLIGHT_STYLE = 'background-color: rgb(250, 247, 133);';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

// Оцветен текст. САМО цвят — никакво удебеляване (изрично поискано, 12.08.2026).
const mark = (s) => `<mark style="${HIGHLIGHT_STYLE}">${esc(s)}</mark>`;

// Цели редове, които се оцветяват — списъкът е на Венци (20.08.2026):
// името на видеото и етикетите на секциите.
const HEADING_RE = /^(?:Видео\s+\d+\s*[-–—].*|Локация на файлове:|Локация на експортираното видео:|Описание:)$/i;

// Етикет в началото на реда: оцветява се САМО той, стойността след него остава чиста
// („Копи: ХХХ" → жълто е само „Копи:").
const LABEL_RE = /^(Копи:)(.*)$/i;

// http(s) адрес в чист текст → истинска кликаема връзка. kp-plan.js htmlToText()
// пази оригиналните <a href> връзки от плана като видим адрес в текста
// ("Текст (https://...)" или самия адрес) точно за да минат оттук обратно към HTML
// (Венци, 28.08.2026: линковете от контент плана трябва да работят и в новата задача).
const URL_RE = /https?:\/\/[^\s<>"]+/gi;

function linkify(s) {
  const str = String(s == null ? '' : s);
  let out = '', last = 0, m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(str))) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, ''); // не влачи пунктуацията след адреса
    out += esc(str.slice(last, m.index));
    out += `<a href="${escAttr(url)}" target="_blank">${esc(url)}</a>`;
    last = m.index + url.length;
    URL_RE.lastIndex = last;
  }
  return out + esc(str.slice(last));
}

// Маркерите, с които kp-plan.js/htmlToText() бележи Trix-форматирането на плана
// (получер/курсив/зачеркнат/оцветено), за да не изчезне при парсването. `_италик_`
// изисква граница на дума от двете страни, за да не пипа файлови имена и потребителски
// имена с долна черта по средата (напр. "eco_pack", "@some_user") — те си остават чист
// текст (Венци, 28.08.2026: "оцветявания ... болдване, италик, зачеркване").
function fmtTokenRe() {
  return /\*\*([\s\S]+?)\*\*|~~([\s\S]+?)~~|\^\^([\s\S]+?)\^\^|(?<!\w)_([^\s_][\s\S]*?[^\s_]|[^\s_])_(?!\w)/g;
}

// Текст с маркери → inline HTML: получер/курсив/зачеркнат/оцветено (рекурсивно, за
// вложени комбинации), плюс linkify() за адресите между маркерите.
function formatInline(s) {
  const str = String(s == null ? '' : s);
  const re = fmtTokenRe();
  let out = '', last = 0, m;
  while ((m = re.exec(str))) {
    out += linkify(str.slice(last, m.index));
    if (m[1] != null) out += '<strong>' + formatInline(m[1]) + '</strong>';
    else if (m[2] != null) out += '<del>' + formatInline(m[2]) + '</del>';
    else if (m[3] != null) out += `<mark style="${HIGHLIGHT_STYLE}">` + formatInline(m[3]) + '</mark>';
    else if (m[4] != null) out += '<em>' + formatInline(m[4]) + '</em>';
    last = m.index + m[0].length;
    re.lastIndex = last;
  }
  return out + linkify(str.slice(last));
}

// Един ред обикновен текст → inline HTML (escape + оцветяване по правилата горе,
// адресите в текста стават кликаеми връзки, а маркерите за получер/курсив/зачеркнат/
// оцветено — реални тагове).
function line(text) {
  const t = String(text == null ? '' : text).trim();
  if (t === '') return '';
  if (HEADING_RE.test(t)) return mark(t);
  const m = t.match(LABEL_RE);
  if (m) return mark(m[1]) + formatInline(m[2]);
  return formatInline(t);
}

// Многоредов текст → масив inline части (по една на ред; празният ред е '').
function lines(text) {
  if (!text) return [];
  return String(text).split('\n').map(line);
}

const isBlank = (parts) => !parts.length || parts.every((x) => x === '');

// Няколко групи редове → една обща поредица с по ЕДИН празен ред между групите.
// Празните групи се прескачат, за да няма дупка в началото или в края.
function join(groups) {
  const out = [];
  for (const g of groups) {
    const parts = (g || []).filter((x) => x != null);
    if (isBlank(parts)) continue;
    if (out.length) out.push('');
    out.push(...parts);
  }
  return out;
}

// Масив inline части → ЕДИН Trix блок. Празен низ, ако няма нищо за показване.
function block(parts) {
  const p = (parts || []).filter((x) => x != null);
  if (isBlank(p)) return '';
  return `<div>${p.join('<br>')}</div>`;
}

// Кратката форма: обикновен текст → готовия блок.
function textToHtml(text) {
  return block(lines(text));
}

module.exports = {
  HIGHLIGHT_STYLE, HEADING_RE, LABEL_RE,
  esc, escAttr, mark, line, lines, join, block, textToHtml,
};
