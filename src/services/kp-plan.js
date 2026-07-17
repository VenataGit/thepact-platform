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

function htmlToText(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// Returns { sections:[{videoNumber,title,sectionText}], attachments:[{href,...}] }.
function parsePlan(html) {
  const attachments = [];
  const withPlaceholders = (html || '').replace(ATTACH_RE, (m) => {
    const i = attachments.length;
    attachments.push(parseAttachment(m));
    return '\nA' + i + '\n';
  });
  const sections = [];
  let cur = null, curLines = [];
  for (const raw of htmlToText(withPlaceholders).split('\n')) {
    const line = raw.trim();
    const m = line.match(/^Видео\s+(\d+)\s*[-–—]\s*(.+)$/);
    if (m) {
      if (cur) sections.push({ ...cur, sectionText: curLines.join('\n') });
      cur = { videoNumber: parseInt(m[1], 10), title: m[2].trim() };
      curLines = [line];
    } else if (cur) { curLines.push(raw); }
  }
  if (cur) sections.push({ ...cur, sectionText: curLines.join('\n') });
  return { sections, attachments };
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

module.exports = { parsePlan, parsePublishDate, planHtml, htmlToText };
