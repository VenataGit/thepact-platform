// Auto-maintain a Production card's stage step dates from its Due date (= publish date).
// Runs AS the ThePactAlerts bot. Idempotent: only writes a step whose date actually differs,
// and never touches cards without a Due date — so manual dates are preserved.
const config = require('../config');
const bc = require('./basecamp');
const { getServiceAuth } = require('./basecamp-token');
const { subtractWorkingDays } = require('./workdays');
const prodSteps = require('./steps');

// Стъпките идват от services/steps.js — разпознават се и по новото, и по старото име,
// така че живите карти да продължат да се синхронизират, докато траят преименуванията.
const STAGES = prodSteps.STEPS;

// Basecamp отвръща 429, когато акаунтът е ударил общия лимит (другите ни автоматики
// също говорят с него). Пропуснат PUT значи стъпка с останала стара дата, затова
// опитваме до три пъти с кратко изчакване, вместо да се откажем на първата грешка.
async function putStep(url, token, body) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': config.BASECAMP_USER_AGENT, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok || attempt === 3 || (r.status !== 429 && r.status < 500)) return r;
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
}

// Recompute the stage step dates from the card's Due date and write any that differ.
// Обхват: целият проект Video Production (BASECAMP_TEAM_PROJECT_ID) — карта от друг
// проект не се намира по този адрес и излиза като 'not-a-card', тоест не се пипа.
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
    const step = steps.find((s) => prodSteps.titleMatchesKey(s.title, stage.key));
    if (!step) continue;
    const want = subtractWorkingDays(card.due_on, stage.offset);
    if ((step.due_on || null) !== want) {
      // Basecamp's step PUT is a full replace — we MUST resend the title + assignees,
      // otherwise the step title is wiped to "Untitled".
      const r = await putStep(
        `${bc.API_BASE}/${account}/buckets/${projectId}/card_tables/steps/${step.id}.json`,
        token,
        { title: step.title, due_on: want, assignee_ids: (step.assignees || []).map((a) => a.id) }
      );
      if (r.ok) changes.push({ step: step.title, from: step.due_on || null, to: want });
      else console.error('[bc-date-sync] step PUT failed', r.status, step.id);
    }
  }
  return { cardId, due: card.due_on, changes };
}

module.exports = { syncCardDates };
