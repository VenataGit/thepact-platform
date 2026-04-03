const fs = require('fs');
let c = fs.readFileSync('public/js/app.js', 'utf8');

function rep(from, to, label) {
  if (c.includes(from)) {
    c = c.replace(from, to);
    console.log('OK:', label || from.substring(0, 50));
  } else {
    console.log('NOT FOUND:', label || from.substring(0, 50));
  }
}

// =====================================================
// 1. CAMPFIRE — append message instead of full reload
// =====================================================

rep(
  "async function sendCampfireMsg(roomId) {\n  const i = document.getElementById('campfireInput'), c = i?.value?.trim(); if(!c) return;\n  try { await fetch(`/api/campfire/rooms/${roomId}/messages`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:c})}); i.value=''; router(); } catch {}\n}",
  "async function sendCampfireMsg(roomId) {\n" +
  "  const i = document.getElementById('campfireInput'), c = i?.value?.trim(); if(!c) return;\n" +
  "  i.value = '';\n" +
  "  try {\n" +
  "    const res = await fetch(`/api/campfire/rooms/${roomId}/messages`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:c})});\n" +
  "    const msg = await res.json();\n" +
  "    if (msg && msg.id) appendCampfireMsg(msg);\n" +
  "  } catch {}\n" +
  "}\n" +
  "function appendCampfireMsg(msg) {\n" +
  "  const msgs = document.getElementById('campfireMessages');\n" +
  "  if (!msgs) return;\n" +
  "  const campColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];\n" +
  "  const isSystem = !msg.user_id;\n" +
  "  const mc = isSystem ? '#1a3040' : campColors[(msg.user_name||'').length % campColors.length];\n" +
  "  const avatarContent = isSystem ? '\\ud83d\\udcca' : initials(msg.user_name);\n" +
  "  const msgContent = parseCampfireMarkdown(msg.content || '');\n" +
  "  const div = document.createElement('div');\n" +
  "  div.className = 'chat-msg' + (isSystem ? ' campfire-system-msg' : '');\n" +
  "  div.innerHTML = '<div class=\"chat-msg-avatar\" style=\"background:' + mc + ';color:#fff\">' + avatarContent + '</div>' +\n" +
  "    '<div class=\"chat-msg-body\"><div class=\"chat-msg-name\">' + esc(msg.user_name || 'Система') + ' <span class=\"hint\">' + new Date(msg.created_at).toLocaleTimeString('bg',{hour:'2-digit',minute:'2-digit'}) + '</span></div>' +\n" +
  "    '<div class=\"chat-msg-text\">' + msgContent + '</div></div>';\n" +
  "  msgs.appendChild(div);\n" +
  "  msgs.scrollTop = msgs.scrollHeight;\n" +
  "}",
  'sendCampfireMsg -> append locally'
);

// Replace WS campfire handler
rep(
  "if (t === 'campfire:message' && location.hash.startsWith('#/campfire/')) wsRouter();",
  "if (t === 'campfire:message' && location.hash.startsWith('#/campfire/')) { if (ev.message) appendCampfireMsg(ev.message); return; }",
  'campfire WS -> appendCampfireMsg'
);

// =====================================================
// 2. REPORTS — Add renderReportRow helper + grouping
// =====================================================

rep(
  "// ==================== REPORTS ====================\nasync function renderReports(el) {",
  "// ==================== REPORTS ====================\n" +
  "function renderReportRow(c, tab) {\n" +
  "  const now = new Date(); now.setHours(0,0,0,0);\n" +
  "  const isOver = c.due_on && new Date(c.due_on+'T00:00:00') < now;\n" +
  "  return '<a class=\"task-row ' + (isOver ? 'overdue' : '') + '\" href=\"#/card/' + c.id + '\">' +\n" +
  "    '<span class=\"task-title\">' + esc(c.title) + '</span>' +\n" +
  "    '<span class=\"task-meta\">' +\n" +
  "      (c.client_name ? '<span style=\"color:var(--accent);font-weight:600\">' + esc(c.client_name) + '</span>' : '') +\n" +
  "      (c.board_title ? '<span class=\"task-board\">' + esc(c.board_title) + '</span>' : '') +\n" +
  "      (c.column_title ? '<span style=\"opacity:.6;font-size:11px\">' + esc(c.column_title) + '</span>' : '') +\n" +
  "      (tab !== 'assignments' && c.assignee_name ? '<span style=\"color:var(--green)\">' + esc(c.assignee_name) + '</span>' : '') +\n" +
  "      (c.due_on ? '<span class=\"task-due\">' + formatDate(c.due_on) + '</span>' : '') +\n" +
  "    '</span></a>';\n" +
  "}\n" +
  "function renderReportRows(data, tab) {\n" +
  "  if (data.length === 0) return '<div style=\"text-align:center;padding:40px;color:var(--text-dim)\">Няма резултати</div>';\n" +
  "  if (tab === 'assignments') {\n" +
  "    const byPerson = {};\n" +
  "    data.forEach(c => { const k = c.assignee_name || 'Без отговорник'; if (!byPerson[k]) byPerson[k] = []; byPerson[k].push(c); });\n" +
  "    return Object.entries(byPerson).sort(([a],[b]) => a.localeCompare(b)).map(([name, cards]) =>\n" +
  "      '<div class=\"task-section-label\" style=\"color:var(--accent)\">' + esc(name) + ' (' + cards.length + ')</div>' +\n" +
  "      cards.map(c => renderReportRow(c, tab)).join('')\n" +
  "    ).join('');\n" +
  "  }\n" +
  "  return data.map(c => renderReportRow(c, tab)).join('');\n" +
  "}\n" +
  "async function renderReports(el) {",
  'add renderReportRow + renderReportRows'
);

// Replace the data.map in renderReports with renderReportRows call
rep(
  "${data.length === 0 ? '<div style=\"text-align:center;padding:40px;color:var(--text-dim)\">Няма резултати</div>' :\n            data.map(c => `\n              <a class=\"task-row ${c.due_on && new Date(c.due_on) < new Date() ? 'overdue' : ''}\" href=\"#/card/${c.id}\">\n                <span class=\"task-title\">${esc(c.title)}</span>\n                <span class=\"task-meta\">\n                  ${c.due_on ? `<span class=\"task-due\">${formatDate(c.due_on)}</span>` : ''}\n                  ${c.board_title ? `<span class=\"task-board\">${esc(c.board_title)}</span>` : ''}\n                  ${c.assignee_name ? `<span style=\"color:var(--accent)\">${esc(c.assignee_name)}</span>` : ''}\n                </span>\n              </a>`).join('')}",
  "${renderReportRows(data, tab)}",
  'replace reports data.map with renderReportRows'
);

// =====================================================
// 3. REPORTS — Add result count to header
// =====================================================
rep(
  "<div class=\"page-header\"><h1>\ud83d\udcca Отчети</h1></div>",
  "<div class=\"page-header\"><h1>\ud83d\udcca Отчети</h1><div class=\"page-subtitle\">" + "${data.length} резултата</div></div>",
  'reports add result count'
);

// =====================================================
// 4. ACTIVITY — Make filter buttons functional
// =====================================================

// Store items globally
rep(
  "    // Group by date\n    const grouped = {};",
  "    _activityItems = items;\n    // Group by date\n    const grouped = {};",
  'store _activityItems'
);

// Add id to the content container
rep(
  "      <div style=\"max-width:700px;margin:0 auto\">\n        ${items.length===0?'<div style=\"text-align:center;padding:40px;color:var(--text-dim)\">Няма активност все още</div>':",
  "      <div id=\"activityList\" style=\"max-width:700px;margin:0 auto\">\n        ${items.length===0?'<div style=\"text-align:center;padding:40px;color:var(--text-dim)\">Няма активност все още</div>':",
  'add id=activityList'
);

// Replace static filter buttons with dynamic ones
rep(
  "      <div style=\"display:flex;justify-content:center;gap:8px;margin-bottom:24px\">\n        <button class=\"btn btn-sm\" style=\"background:var(--accent-dim);color:var(--accent);border-color:var(--accent)\">Всичко</button>\n        <button class=\"btn btn-sm\">Филтрирай по проекти</button>\n        <button class=\"btn btn-sm\">Филтрирай по хора</button>\n      </div>",
  "      <div id=\"activityFilters\" style=\"display:flex;justify-content:center;gap:8px;margin-bottom:24px;flex-wrap:wrap\">\n        <button class=\"btn btn-sm activity-filter-btn active\" style=\"background:var(--accent-dim);color:var(--accent);border-color:var(--accent)\" onclick=\"filterActivity('all',this)\">Всичко</button>\n        ${[...new Set(items.filter(a=>a.board_title).map(a=>a.board_title))].slice(0,6).map(b=>`<button class=\"btn btn-sm activity-filter-btn\" onclick=\"filterActivity('${esc(b)}',this)\">${esc(b)}</button>`).join('')}\n      </div>",
  'activity filter buttons dynamic'
);

// Add _activityItems global + filterActivity function before renderActivity
rep(
  "let _activityItems = [];\nfunction filterActivity",
  "function filterActivity",
  'remove duplicate if needed (no-op)'
);

// Only add if not already present
if (!c.includes('let _activityItems = []')) {
  rep(
    "async function renderActivity(el) {",
    "let _activityItems = [];\n" +
    "function filterActivity(board, btn) {\n" +
    "  document.querySelectorAll('.activity-filter-btn').forEach(b => b.classList.remove('active'));\n" +
    "  if (btn) btn.classList.add('active');\n" +
    "  const toShow = board === 'all' ? _activityItems : _activityItems.filter(a => a.board_title === board);\n" +
    "  const container = document.getElementById('activityList');\n" +
    "  if (!container) return;\n" +
    "  const campColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];\n" +
    "  const getAvatarColor = (name) => campColors[(name||'').length % campColors.length];\n" +
    "  const grouped = {};\n" +
    "  toShow.forEach(a => {\n" +
    "    const d = new Date(a.created_at);\n" +
    "    const today = new Date(); today.setHours(0,0,0,0);\n" +
    "    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);\n" +
    "    const dateKey = d >= today ? 'ДНЕС' : d >= yesterday ? 'ВЧЕРА' : d.toLocaleDateString('bg', { month: 'long', day: 'numeric', year: 'numeric' });\n" +
    "    if (!grouped[dateKey]) grouped[dateKey] = [];\n" +
    "    grouped[dateKey].push(a);\n" +
    "  });\n" +
    "  container.innerHTML = toShow.length === 0 ? '<div style=\"text-align:center;padding:40px;color:var(--text-dim)\">Няма активност</div>' :\n" +
    "    Object.entries(grouped).map(([date, entries]) =>\n" +
    "      '<div style=\"margin-bottom:24px\"><div style=\"font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;padding:8px 0;border-bottom:1px solid var(--border);margin-bottom:8px\">' + date + '</div>' +\n" +
    "      entries.map(a =>\n" +
    "        '<div class=\"activity-entry\"><div class=\"activity-avatar\" style=\"background:' + getAvatarColor(a.user_name) + '\">' + initials(a.user_name||'') + '</div>' +\n" +
    "        '<div class=\"activity-body\"><div class=\"activity-text\"><strong>' + esc(a.user_name||'') + '</strong> ' +\n" +
    "        (a.action==='created'?'създаде':a.action==='commented'?'коментира':a.action==='moved'?'премести':a.action==='completed'?'завърши':a.action==='checked_off'?'отметна стъпка на':a.action) + ' ' +\n" +
    "        (a.target_type==='card' ? '<a href=\"#/card/' + a.target_id + '\">' + esc(a.target_title||'') + '</a>' : esc(a.target_title||'')) + '</div>' +\n" +
    "        (a.excerpt ? '<div class=\"activity-excerpt\">' + esc(a.excerpt).substring(0,150) + '</div>' : '') +\n" +
    "        '<div class=\"activity-meta\">' + (a.board_title ? esc(a.board_title) + ' · ' : '') + timeAgo(a.created_at) + '</div></div></div>'\n" +
    "      ).join('') + '</div>'\n" +
    "    ).join('');\n" +
    "}\n" +
    "async function renderActivity(el) {",
    'add _activityItems + filterActivity'
  );
}

fs.writeFileSync('public/js/app.js', c, 'utf8');
console.log('\nBatch 5 done!');
