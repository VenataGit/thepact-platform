// Basecamp 3/4 OAuth 2.0 + API helper (37signals "Launchpad").
// Docs: https://github.com/basecamp/api/blob/master/sections/authentication.md
//
// Auth flow:
//   1. redirect user -> buildAuthorizeUrl()
//   2. Basecamp redirects back with ?code -> exchangeCodeForToken(code)
//   3. getAuthorization(accessToken) -> identity + the accounts the user can access
//
// Basecamp is strict about the User-Agent header — it must identify the app + a contact.
const config = require('../config');

const AUTH_BASE = 'https://launchpad.37signals.com';

function isConfigured() {
  return Boolean(config.BASECAMP_CLIENT_ID && config.BASECAMP_CLIENT_SECRET);
}

function headers(extra = {}) {
  return { 'User-Agent': config.BASECAMP_USER_AGENT, Accept: 'application/json', ...extra };
}

// URL we send the user to so they can grant access. `state` guards against CSRF.
function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    type: 'web_server',
    client_id: config.BASECAMP_CLIENT_ID,
    redirect_uri: config.BASECAMP_REDIRECT_URI,
  });
  if (state) params.set('state', state);
  return `${AUTH_BASE}/authorization/new?${params.toString()}`;
}

// Exchange the ?code from the callback for { access_token, refresh_token, expires_in }.
async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    type: 'web_server',
    client_id: config.BASECAMP_CLIENT_ID,
    redirect_uri: config.BASECAMP_REDIRECT_URI,
    client_secret: config.BASECAMP_CLIENT_SECRET,
    code,
  });
  const res = await fetch(`${AUTH_BASE}/authorization/token?${params.toString()}`, {
    method: 'POST',
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Basecamp token exchange failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Refresh an expired access token using the stored refresh_token.
async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    type: 'refresh',
    refresh_token: refreshToken,
    client_id: config.BASECAMP_CLIENT_ID,
    client_secret: config.BASECAMP_CLIENT_SECRET,
  });
  const res = await fetch(`${AUTH_BASE}/authorization/token?${params.toString()}`, {
    method: 'POST',
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Basecamp token refresh failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// The authenticated user's identity + the list of Basecamp accounts they can access.
// Shape: { identity: { id, email_address, first_name, last_name }, accounts: [{ id, name, product, href }] }
async function getAuthorization(accessToken) {
  const res = await fetch(`${AUTH_BASE}/authorization.json`, {
    headers: headers({ Authorization: `Bearer ${accessToken}` }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Basecamp identity fetch failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Authenticated GET that also surfaces the Link rel="next" pagination cursor.
async function authedGet(url, accessToken) {
  const r = await fetch(url, { headers: headers({ Authorization: `Bearer ${accessToken}` }) });
  if (!r.ok) throw new Error(`Basecamp GET failed (${r.status}): ${url}`);
  const json = await r.json();
  const link = r.headers.get('Link') || '';
  const m = link.match(/<([^>]+)>;\s*rel="next"/);
  return { json, next: m ? m[1] : null };
}

// Decide whether a person (by their own access token) may use the platform.
// Allowed if they are an internal team member (non-client) OR a member of the team project
// (e.g. Video Production). Returns { allowed, reason, errored }; `errored` is true when
// Basecamp could not be reached, so the caller can avoid locking out already-known users.
async function isTeamMember(accessToken, accountId, teamProjectId) {
  let errored = false;
  // 1) Internal team member (non-client) — from their own profile.
  try {
    const { json: profile } = await authedGet(`https://3.basecampapi.com/${accountId}/my/profile.json`, accessToken);
    if (profile && profile.client === false) return { allowed: true, reason: 'employee', errored: false };
  } catch (e) { errored = true; console.warn('[basecamp] profile check failed:', e.message); }
  // 2) Member of the team project.
  if (teamProjectId) {
    try {
      let url = `https://3.basecampapi.com/${accountId}/projects.json`;
      let pages = 0;
      while (url && pages < 25) {
        const { json, next } = await authedGet(url, accessToken);
        if (Array.isArray(json) && json.some((p) => String(p.id) === String(teamProjectId))) {
          return { allowed: true, reason: 'project', errored: false };
        }
        url = next;
        pages += 1;
      }
      return { allowed: false, reason: 'not-member', errored };
    } catch (e) { errored = true; console.warn('[basecamp] projects check failed:', e.message); }
  }
  return { allowed: false, reason: 'not-member', errored };
}

// ---- Card Table (kanban) API — all helpers take whatever token the caller provides ----
const API_BASE = 'https://3.basecampapi.com';

// Basecamp's API returns app_url links on their NEW app.basecamp.com host, but the team's
// browser sessions — and the per-account appearance setting (dark mode) — live on the
// classic 3.basecamp.com. The two are separate origins, so a link opened on app.* renders
// the default LIGHT theme even for people who set "Always dark" (Ventsi, 13.07.2026).
// Rewrite every link we hand out to the classic host; if Basecamp ever retires it, the
// old host just 302s forward and nothing breaks.
function normalizeAppUrl(url) {
  return typeof url === 'string' ? url.replace(/^https:\/\/app\.basecamp\.com\//i, 'https://3.basecamp.com/') : url;
}

async function getProject(token, account, projectId) {
  return (await authedGet(`${API_BASE}/${account}/projects/${projectId}.json`, token)).json;
}

// The signed-in person's own profile — includes name, email_address and avatar_url.
async function getMyProfile(token, account) {
  return (await authedGet(`${API_BASE}/${account}/my/profile.json`, token)).json;
}

async function getCardTable(token, account, projectId, cardTableId) {
  return (await authedGet(`${API_BASE}/${account}/buckets/${projectId}/card_tables/${cardTableId}.json`, token)).json;
}

// All cards in a column/list (follows pagination).
async function getColumnCards(token, account, projectId, listId) {
  let url = `${API_BASE}/${account}/buckets/${projectId}/card_tables/lists/${listId}/cards.json`;
  const out = [];
  while (url) {
    const { json, next } = await authedGet(url, token);
    if (Array.isArray(json)) out.push(...json);
    url = next;
  }
  return out;
}

// Move a card to another column within the same card table. POST .../card_tables/{id}/moves.json
// body { source_id: cardId, target_id: columnId, position }. Returns true on 204.
async function moveCard(token, account, projectId, cardTableId, cardId, targetColumnId, position = 0) {
  const r = await fetch(`${API_BASE}/${account}/buckets/${projectId}/card_tables/${cardTableId}/moves.json`, {
    method: 'POST',
    headers: headers({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ source_id: cardId, target_id: targetColumnId, position }),
  });
  if (!r.ok && r.status !== 204) {
    const b = await r.text().catch(() => '');
    throw new Error(`Basecamp move failed (${r.status}): ${b.slice(0, 200)}`);
  }
  return true;
}

// Fetch a single card with its full payload (incl. `content` rich HTML + steps).
async function getCard(token, account, projectId, cardId) {
  return (await authedGet(`${API_BASE}/${account}/buckets/${projectId}/card_tables/cards/${cardId}.json`, token)).json;
}

// Create a card in a column/list. POST .../card_tables/lists/{listId}/cards.json
// body { title (required), content (rich HTML), due_on, notify }. Returns the created card JSON.
async function createCard(token, account, projectId, listId, { title, content, due_on, notify } = {}) {
  const body = { title };
  if (content != null) body.content = content;
  if (due_on) body.due_on = due_on;
  if (notify) body.notify = true;
  const r = await fetch(`${API_BASE}/${account}/buckets/${projectId}/card_tables/lists/${listId}/cards.json`, {
    method: 'POST',
    headers: headers({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!r.ok) { const b = await r.text().catch(() => ''); throw new Error(`Basecamp create card failed (${r.status}): ${b.slice(0, 200)}`); }
  return r.json();
}

// Create a step (to-do) on a card. POST .../card_tables/cards/{cardId}/steps.json
async function createStep(token, account, projectId, cardId, { title, due_on, assignee_ids } = {}) {
  const body = { title };
  if (due_on) body.due_on = due_on;
  if (assignee_ids && assignee_ids.length) body.assignee_ids = assignee_ids;
  const r = await fetch(`${API_BASE}/${account}/buckets/${projectId}/card_tables/cards/${cardId}/steps.json`, {
    method: 'POST',
    headers: headers({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!r.ok) { const b = await r.text().catch(() => ''); throw new Error(`Basecamp create step failed (${r.status}): ${b.slice(0, 200)}`); }
  return r.json();
}

// Everyone on a project (follows pagination). Includes `attachable_sgid` per person —
// needed for @mentions in rich text (<bc-attachment sgid="...">).
async function getProjectPeople(token, account, projectId) {
  let url = `${API_BASE}/${account}/projects/${projectId}/people.json`;
  const out = [];
  while (url) {
    const { json, next } = await authedGet(url, token);
    if (Array.isArray(json)) out.push(...json);
    url = next;
  }
  return out;
}

// ---- Read helpers за PM Agent (Фаза 0) — всичко е само GET, с пагинация ----

// Follows Link rel="next" pagination and returns the concatenated array.
// `maxPages` пази от неочаквано огромни списъци (15 елемента/страница).
async function pagedGet(url, token, maxPages = 100) {
  const out = [];
  let pages = 0;
  while (url && pages < maxPages) {
    const { json, next } = await authedGet(url, token);
    if (Array.isArray(json)) out.push(...json);
    url = next;
    pages += 1;
  }
  return out;
}

// Всички проекти, които токенът вижда (Video Production + клиентските).
async function getProjects(token, account) {
  return pagedGet(`${API_BASE}/${account}/projects.json`, token, 30);
}

// Коментарите под който и да е recording (карта, съобщение, todo...).
async function getComments(token, account, projectId, recordingId) {
  return pagedGet(`${API_BASE}/${account}/buckets/${projectId}/recordings/${recordingId}/comments.json`, token, 40);
}

// Съобщенията от message board (най-новите първи).
async function getMessages(token, account, projectId, boardId) {
  return pagedGet(`${API_BASE}/${account}/buckets/${projectId}/message_boards/${boardId}/messages.json`, token, 20);
}

// To-do списъците на проект (през todoset id от dock-а).
async function getTodoLists(token, account, projectId, todosetId) {
  return pagedGet(`${API_BASE}/${account}/buckets/${projectId}/todosets/${todosetId}/todolists.json`, token, 20);
}

// To-do задачите в списък. По подразбиране само отворените; completed=true връща
// САМО завършените (Basecamp няма режим „всички наведнъж").
async function getTodos(token, account, projectId, todolistId, { completed = false } = {}) {
  const qs = completed ? '?completed=true' : '';
  return pagedGet(`${API_BASE}/${account}/buckets/${projectId}/todolists/${todolistId}/todos.json${qs}`, token, 30);
}

// Групите вътре в един to-do лист (Basecamp ги връща като mini-списъци със свои
// id-та; задачите в група НЕ излизат от todos.json на родителския лист).
async function getTodoGroups(token, account, projectId, todolistId) {
  return pagedGet(`${API_BASE}/${account}/buckets/${projectId}/todolists/${todolistId}/groups.json`, token, 10);
}

// Campfire редове (чат) — най-новите първи; по подразбиране само първите страници.
async function getCampfireLines(token, account, projectId, chatId, maxPages = 2) {
  return pagedGet(`${API_BASE}/${account}/buckets/${projectId}/chats/${chatId}/lines.json`, token, maxPages);
}

// Recordings cross-project: всички записи от даден тип (Comment/Message/Todo)
// през ВСИЧКИ проекти, сортирани по updated_at desc. Спира щом стигне запис,
// по-стар от `sinceIso` (или изчерпи maxPages). Идеално за инкрементален sync.
async function getRecordingsSince(token, account, type, sinceIso, maxPages = 30) {
  let url = `${API_BASE}/${account}/projects/recordings.json?type=${encodeURIComponent(type)}&sort=updated_at&direction=desc`;
  const out = [];
  let pages = 0;
  const since = sinceIso ? new Date(sinceIso).getTime() : 0;
  while (url && pages < maxPages) {
    const { json, next } = await authedGet(url, token);
    if (!Array.isArray(json) || !json.length) break;
    let reachedOld = false;
    for (const rec of json) {
      const at = new Date(rec.updated_at || rec.created_at || 0).getTime();
      if (since && at < since) { reachedOld = true; break; }
      out.push(rec);
    }
    if (reachedOld) break;
    url = next;
    pages += 1;
  }
  return out;
}

// Post a message to a Message Board. status:'active' publishes it immediately.
// ВАЖНО: без `subscriptions` Basecamp известява ЦЕЛИЯ проект при публикуване.
// Подаваме масив от person ids → само те са абонирани/известени ("notify: No one"
// за всички останали). Returns the created message JSON.
async function createMessage(token, account, projectId, boardId, { subject, content, subscriptions } = {}) {
  const body = { subject, content, status: 'active' };
  if (Array.isArray(subscriptions)) body.subscriptions = subscriptions;
  const r = await fetch(`${API_BASE}/${account}/buckets/${projectId}/message_boards/${boardId}/messages.json`, {
    method: 'POST',
    headers: headers({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!r.ok) { const b = await r.text().catch(() => ''); throw new Error(`Basecamp create message failed (${r.status}): ${b.slice(0, 200)}`); }
  return r.json();
}

// Post a line to a Campfire chat. Content is rich text — <bc-attachment sgid>
// mentions work and notify the mentioned people (closest thing to a Ping the
// public API offers; real Pings/DMs are not exposed by Basecamp).
async function createCampfireLine(token, account, projectId, chatId, content) {
  const r = await fetch(`${API_BASE}/${account}/buckets/${projectId}/chats/${chatId}/lines.json`, {
    method: 'POST',
    headers: headers({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ content }),
  });
  if (!r.ok) { const b = await r.text().catch(() => ''); throw new Error(`Basecamp campfire line failed (${r.status}): ${b.slice(0, 200)}`); }
  return r.json();
}

// Comment under any recording (e.g. a message). Notifies the thread's subscribers.
async function createComment(token, account, projectId, recordingId, content) {
  const r = await fetch(`${API_BASE}/${account}/buckets/${projectId}/recordings/${recordingId}/comments.json`, {
    method: 'POST',
    headers: headers({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify({ content }),
  });
  if (!r.ok) { const b = await r.text().catch(() => ''); throw new Error(`Basecamp create comment failed (${r.status}): ${b.slice(0, 200)}`); }
  return r.json();
}

// Replace the exact subscriber list of a recording (who gets notified about it).
// PUT subscription.json приема { subscriptions: [...ids] } за добавяне и
// { unsubscriptions: [...ids] } за махане.
async function setSubscription(token, account, projectId, recordingId, { subscriptions, unsubscriptions } = {}) {
  const body = {};
  if (Array.isArray(subscriptions) && subscriptions.length) body.subscriptions = subscriptions;
  if (Array.isArray(unsubscriptions) && unsubscriptions.length) body.unsubscriptions = unsubscriptions;
  if (!Object.keys(body).length) return true;
  const r = await fetch(`${API_BASE}/${account}/buckets/${projectId}/recordings/${recordingId}/subscription.json`, {
    method: 'PUT',
    headers: headers({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!r.ok) { const b = await r.text().catch(() => ''); throw new Error(`Basecamp subscription update failed (${r.status}): ${b.slice(0, 200)}`); }
  return true;
}

// Download a file (e.g. an attachment's `href` storage URL) as a Buffer.
// Accept */* — the shared headers() default of application/json would make the file
// server return a JSON error instead of the bytes.
async function downloadFile(token, url) {
  const r = await fetch(url, { headers: headers({ Authorization: `Bearer ${token}`, Accept: '*/*' }), redirect: 'follow' });
  if (!r.ok) { const b = await r.text().catch(() => ''); throw new Error(`download ${r.status} ${r.headers.get('content-type') || ''} ${b.slice(0, 80)}`.trim()); }
  const buffer = Buffer.from(await r.arrayBuffer());
  return { buffer, contentType: r.headers.get('content-type') || '' };
}

// Upload raw bytes to get a fresh attachable_sgid. POST /attachments.json?name=<file>
// (rich-text attachments can't be reused across cards, so each must be re-uploaded).
async function uploadAttachment(token, account, { name, contentType, buffer }) {
  const r = await fetch(`${API_BASE}/${account}/attachments.json?name=${encodeURIComponent(name || 'file')}`, {
    method: 'POST',
    headers: headers({ Authorization: `Bearer ${token}`, 'Content-Type': contentType || 'application/octet-stream', 'Content-Length': String(buffer.length) }),
    body: buffer,
  });
  if (!r.ok) { const b = await r.text().catch(() => ''); throw new Error(`Basecamp upload failed (${r.status}): ${b.slice(0, 150)}`); }
  return (await r.json()).attachable_sgid;
}

module.exports = {
  AUTH_BASE,
  API_BASE,
  normalizeAppUrl,
  isConfigured,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  getAuthorization,
  authedGet,
  isTeamMember,
  getMyProfile,
  getProject,
  getCardTable,
  getColumnCards,
  moveCard,
  getCard,
  createCard,
  createStep,
  getProjectPeople,
  getProjects,
  getComments,
  getMessages,
  getTodoLists,
  getTodos,
  getTodoGroups,
  getCampfireLines,
  getRecordingsSince,
  createMessage,
  createCampfireLine,
  createComment,
  setSubscription,
  downloadFile,
  uploadAttachment,
};
