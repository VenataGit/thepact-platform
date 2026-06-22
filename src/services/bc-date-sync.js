// Auto-maintain a Production card's stage step dates from its Due date (= publish date).
// Runs AS the ThePactAlerts bot. Idempotent: only writes a step whose date actually differs,
// and never touches cards without a Due date — so manual dates are preserved.
const config = require('../config');
const bc = require('./basecamp');
const { getServiceAuth } = require('./basecamp-token');

// Stage step title patterns + working-day offset before the publish date (Венци: 11/6/1).
const STAGES = [
  { re: /насрочване на снимач/i, offset: 11 }, // Видеограф - Насрочване на снимачен ден
  { re: /приключен монтаж/i, offset: 6 },      // Монтажист - Приключен монтаж
  { re: /качване в социал/i, offset: 1 },      // PM - Насрочване/Качване в социални мрежи
];

function ymd(d) { const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate(); return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day; }
function subtractWorkingDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  let n = days;
  while (n > 0) { d.setDate(d.getDate() - 1); const w = d.getDay(); if (w !== 0 && w !== 6) n--; }
  return ymd(d);
}

// Recompute the stage step dates from the card's Due date and write any that differ.
async function syncCardDates(cardId) {
  const { token, account } = await getServiceAuth();
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  let card;
  try {
    card = (await bc.authedGet(`${bc.API_BASE}/${account}/buckets/${projectId}/card_tables/cards/${cardId}.json`, token)).json;
  } catch {
    return { cardId, skipped: 'not-a-card' };
  }
  if (!card || !card.due_on) return { cardId, skipped: 'no-due' };
  const steps = card.steps || [];
  const changes = [];
  for (const stage of STAGES) {
    const step = steps.find((s) => stage.re.test(s.title || ''));
    if (!step) continue;
    const want = subtractWorkingDays(card.due_on, stage.offset);
    if ((step.due_on || null) !== want) {
      const r = await fetch(`${bc.API_BASE}/${account}/buckets/${projectId}/card_tables/steps/${step.id}.json`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': config.BASECAMP_USER_AGENT, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ due_on: want }),
      });
      if (r.ok) changes.push({ step: step.title, from: step.due_on || null, to: want });
      else console.error('[bc-date-sync] step PUT failed', r.status, step.id);
    }
  }
  return { cardId, due: card.due_on, changes };
}

module.exports = { syncCardDates };
