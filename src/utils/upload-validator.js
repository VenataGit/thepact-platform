// Shared upload validation for multer.
// Whitelist-based approach: only allow known-safe file types.
// Different presets for different use cases (attachments, vault, avatars).

const path = require('path');

// === EXTENSION + MIME WHITELISTS ===

// General attachments (cards, vault) — documents, images, video, audio, archives.
// Explicitly excludes: executables, scripts, SVG (XSS risk via embedded JS), HTML.
const ATTACHMENT_EXTENSIONS = new Set([
  // Images
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.heic',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.odt', '.ods', '.odp', '.rtf', '.txt', '.csv', '.md',
  // Video
  '.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v',
  // Audio
  '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac',
  // Archives
  '.zip', '.rar', '.7z', '.tar', '.gz',
  // Design files (common in video production)
  '.psd', '.ai', '.eps', '.indd', '.aep', '.prproj', '.fcpx', '.drp', '.veg',
]);

// MIME type prefixes that are always allowed (even if extension is missing)
const ALLOWED_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats',
  'application/vnd.ms-',
  'application/vnd.oasis.opendocument',
  'application/zip',
  'application/x-rar',
  'application/x-7z',
  'application/x-tar',
  'application/gzip',
  'text/plain',
  'text/csv',
  'text/markdown',
];

// Strictly dangerous — block even if mime/extension is whitelisted somewhere else.
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.com', '.cpl', '.msi', '.scr',
  '.ps1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta',
  '.sh', '.bash', '.zsh', '.csh', '.fish',
  '.php', '.phtml', '.php5', '.phar',
  '.jsp', '.asp', '.aspx', '.cgi', '.pl', '.py', '.rb',
  '.htm', '.html', '.xhtml',  // can host XSS payloads
  '.svg',                       // SVG can embed JS — block
  '.jar', '.war', '.ear',
  '.app', '.deb', '.rpm', '.dmg', '.pkg',
  '.lnk', '.url',
]);

// Avatar uploads — only images, no animations needed.
const AVATAR_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const AVATAR_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

// === SIZE LIMITS ===

const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;  // 50 MB
const MAX_AVATAR_SIZE     =  5 * 1024 * 1024;  // 5 MB
const MAX_VAULT_SIZE      = 100 * 1024 * 1024; // 100 MB (videos)

// === FILTER FUNCTIONS ===

/**
 * Filter for general attachments and vault files.
 * Allows most safe file types, blocks executables and scripts.
 */
function attachmentFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return cb(new Error('Този тип файл не е разрешен (изпълним/скрипт): ' + ext));
  }

  // Accept if extension is in whitelist OR mime type starts with safe prefix
  const extOk = !ext || ATTACHMENT_EXTENSIONS.has(ext);
  const mimeOk = ALLOWED_MIME_PREFIXES.some(prefix => (file.mimetype || '').startsWith(prefix));

  if (!extOk && !mimeOk) {
    return cb(new Error('Този тип файл не е разрешен: ' + (ext || file.mimetype || 'unknown')));
  }

  cb(null, true);
}

/**
 * Filter for avatar uploads — only common image formats.
 */
function avatarFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (!AVATAR_EXTENSIONS.has(ext)) {
    return cb(new Error('Профилните снимки трябва да са JPG, PNG, GIF или WebP'));
  }
  if (!AVATAR_MIMES.has(file.mimetype)) {
    return cb(new Error('MIME типът на файла не съответства на изображение'));
  }

  cb(null, true);
}

/**
 * Sanitize a filename for storage (remove path separators, control chars).
 * Returns a safe filename — never the original.
 */
function safeStorageFilename(originalName) {
  const ext = path.extname(originalName || '').toLowerCase().slice(0, 16);
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now()}-${random}${ext}`;
}

module.exports = {
  attachmentFilter,
  avatarFilter,
  safeStorageFilename,
  MAX_ATTACHMENT_SIZE,
  MAX_AVATAR_SIZE,
  MAX_VAULT_SIZE,
  BLOCKED_EXTENSIONS,
};
