// Сравняване на машинни ключове (опашки, бекъп, webhooks, deploy) без изтичане по времето.
// `!==` спира на първия различен символ → по времето за отговор може да се гадае ключът.
const crypto = require('crypto');

function keyMatches(given, expected) {
  if (!given || !expected) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { keyMatches };
