// Patch script — simplify step editing (text only, no assignee/date)
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'public', 'js', 'app.js');
let c = fs.readFileSync(appPath, 'utf8');
const orig = c.length;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Steps list + add-form HTML block
// ─────────────────────────────────────────────────────────────────────────────
const S1_START = c.indexOf("var stepsHtml = '';");
if (S1_START === -1) { console.error('stepsHtml start not found'); process.exit(1); }

// The add-form block ends with '</div>'; then \r\n    } then blank lines then // ===== COLUMN
const S1_CLOSE_MARKER = c.indexOf("'</div>';\r\n    }\r\n\r\n\r\n    // ===== COLUMN", S1_START);
if (S1_CLOSE_MARKER === -1) { console.error('S1 close marker not found'); process.exit(1); }
const S1_END = S1_CLOSE_MARKER + "'</div>';".length + "\r\n    }".length;

// Build: stepClick uses double-quoted onclick attribute so 'li' needs no escaping inside it
// In JS single-quoted string we must escape the inner ' around li
const SQ = "'"; // single quote character
const BSQ = "\\'"; // backslash + single quote — what appears in the JS source file

// Build stepClick line using char codes to avoid escaping hell
const sq = String.fromCharCode(39);  // '
const bs = String.fromCharCode(92);  // \

// Target output in app.js:
//   var stepClick = canEdit() ? ' onclick="expandStep(' + cardId + ',' + s.id + ',this.closest(\'li\'))"' : '';
const stepClickAssignment =
  '        var stepClick = canEdit() ? ' + sq + ' onclick=\"expandStep(' + sq + ' + cardId + ' + sq + ',' + sq + ' + s.id + ' +
  sq + ',this.closest(' + bs + sq + 'li' + bs + sq + '))\"' + sq + ' : ' + sq + sq + ';';

const newS1 = [
  "var stepsHtml = '';",
  "    if (card.steps && card.steps.length) {",
  "      stepsHtml += '<ul class=\"bc-checklist\">';",
  "      stepsHtml += card.steps.map(function(s) {",
  "        var doneClass = s.completed ? ' bc-checklist__item--done' : '';",
  stepClickAssignment,
  "        return '<li class=\"bc-checklist__item' + doneClass + '\" data-step-id=\"' + s.id + '\">' +",
  "          '<input type=\"checkbox\" ' + (s.completed ? 'checked' : '') + ' onclick=\"event.stopPropagation();toggleStep(' + cardId + ',' + s.id + ',this.checked)\">' +",
  "          '<span' + stepClick + '>' + esc(s.title) + '</span>' +",
  "          '</li>';",
  "      }).join('');",
  "      stepsHtml += '</ul>';",
  "    }",
  "    if (canEdit()) {",
  "      stepsHtml += '<button class=\"bc-add-step-link\" onclick=\"showAddStepForm(' + cardId + ')\">\u0414\u043e\u0431\u0430\u0432\u0438 \u0441\u0442\u044a\u043f\u043a\u0430</button>';",
  "      stepsHtml += '<div class=\"bc-add-step\" id=\"addStepForm_' + cardId + '\">' +",
  "        '<input id=\"newStepInput\" class=\"bc-step-expand__input\" type=\"text\" placeholder=\"\u041e\u043f\u0438\u0448\u0438 \u0442\u0430\u0437\u0438 \u0441\u0442\u044a\u043f\u043a\u0430\u2026\" onkeydown=\"if(event.key===\\'Enter\\')addStepFromPage(' + cardId + ')\">' +",
  "        '<div style=\"display:flex;gap:8px;margin-top:8px\"><button class=\"bc-btn-save\" onclick=\"addStepFromPage(' + cardId + ')\">\u0414\u043e\u0431\u0430\u0432\u0438 \u0442\u0430\u0437\u0438 \u0441\u0442\u044a\u043f\u043a\u0430</button><button class=\"bc-btn-discard\" onclick=\"hideAddStepForm(' + cardId + ')\">\u041e\u0442\u043a\u0430\u0436\u0438</button></div>' +",
  "        '</div>';",
  "    }"
].join('\r\n');

c = c.slice(0, S1_START) + newS1 + c.slice(S1_END);
console.log('S1 done, len:', c.length);

// ─────────────────────────────────────────────────────────────────────────────
// 2. expandStep — use DOM methods to avoid all onclick escaping issues
// ─────────────────────────────────────────────────────────────────────────────
const ES_START = c.indexOf('function expandStep(cardId, stepId, li, stepDueOn)');
const ES_END   = c.indexOf('\r\nasync function saveStepEdit', ES_START);
if (ES_START === -1 || ES_END === -1) { console.error('expandStep bounds', ES_START, ES_END); process.exit(1); }

const newExpandStep = [
"function expandStep(cardId, stepId, li) {",
"  var existingForm = li.querySelector('.bc-step-expand');",
"  if (existingForm) { existingForm.remove(); return; }",
"  document.querySelectorAll('.bc-step-expand').forEach(function(f) { f.remove(); });",
"  var stepText = li.querySelector('span').textContent;",
"",
"  var form = document.createElement('div');",
"  form.className = 'bc-step-expand';",
"  form.addEventListener('click', function(e) { e.stopPropagation(); });",
"",
"  var inp = document.createElement('input');",
"  inp.type = 'text';",
"  inp.className = 'bc-step-expand__input';",
"  inp.id = 'editStepTitle_' + stepId;",
"  inp.value = stepText;",
"  inp.addEventListener('keydown', function(e) {",
"    if (e.key === 'Enter') { e.preventDefault(); saveStepEdit(cardId, stepId); }",
"    if (e.key === 'Escape') { form.remove(); }",
"  });",
"",
"  var actions = document.createElement('div');",
"  actions.className = 'bc-step-expand__actions';",
"",
"  var btnRow = document.createElement('div');",
"  btnRow.style.cssText = 'display:flex;gap:8px';",
"",
"  var saveBtn = document.createElement('button');",
"  saveBtn.className = 'bc-btn-save';",
"  saveBtn.textContent = '\u0417\u0430\u043f\u0430\u0437\u0438';",
"  saveBtn.onclick = function() { saveStepEdit(cardId, stepId); };",
"",
"  var cancelBtn = document.createElement('button');",
"  cancelBtn.className = 'bc-btn-discard';",
"  cancelBtn.textContent = '\u041e\u0442\u043a\u0430\u0437';",
"  cancelBtn.onclick = function() { form.remove(); };",
"",
"  var delBtn = document.createElement('button');",
"  delBtn.className = 'bc-step-expand__delete';",
"  delBtn.textContent = '\u0418\u0437\u0442\u0440\u0438\u0439 \u0441\u0442\u044a\u043f\u043a\u0430';",
"  delBtn.onclick = function() { deleteStep(cardId, stepId); };",
"",
"  btnRow.appendChild(saveBtn);",
"  btnRow.appendChild(cancelBtn);",
"  actions.appendChild(btnRow);",
"  actions.appendChild(delBtn);",
"  form.appendChild(inp);",
"  form.appendChild(actions);",
"  li.appendChild(form);",
"  inp.focus(); inp.select();",
"}"
].join('\r\n');

c = c.slice(0, ES_START) + newExpandStep + c.slice(ES_END);
console.log('expandStep done, len:', c.length);

// ─────────────────────────────────────────────────────────────────────────────
// 3. saveStepEdit — title only
// ─────────────────────────────────────────────────────────────────────────────
const SSE_START = c.indexOf('async function saveStepEdit(cardId, stepId)');
const SSE_END   = c.indexOf('\r\nfunction deleteStep', SSE_START);
if (SSE_START === -1 || SSE_END === -1) { console.error('saveStepEdit bounds', SSE_START, SSE_END); process.exit(1); }

const newSaveStep = [
"async function saveStepEdit(cardId, stepId) {",
"  var titleEl = document.getElementById('editStepTitle_' + stepId);",
"  if (!titleEl || !titleEl.value.trim()) return;",
"  var data = { title: titleEl.value.trim() };",
"  try {",
"    await fetch('/api/cards/' + cardId + '/steps/' + stepId, {",
"      method: 'PUT', headers: { 'Content-Type': 'application/json' },",
"      body: JSON.stringify(data)",
"    });",
"    router();",
"  } catch(e) {}",
"}"
].join('\r\n');

c = c.slice(0, SSE_START) + newSaveStep + c.slice(SSE_END);
console.log('saveStepEdit done, len:', c.length);

// ─────────────────────────────────────────────────────────────────────────────
// 4. addStepFromPage — title only
// ─────────────────────────────────────────────────────────────────────────────
const ASF_START = c.indexOf('async function addStepFromPage(cardId)');
const ASF_END   = c.indexOf('\r\nasync function addComment', ASF_START);
if (ASF_START === -1 || ASF_END === -1) { console.error('addStepFromPage bounds', ASF_START, ASF_END); process.exit(1); }

const newAddStep = [
"async function addStepFromPage(cardId) {",
"  var t = document.getElementById('newStepInput');",
"  if (!t || !t.value.trim()) return;",
"  var title = t.value.trim();",
"  try {",
"    await fetch('/api/cards/' + cardId + '/steps', {",
"      method: 'POST', headers: { 'Content-Type': 'application/json' },",
"      body: JSON.stringify({ title: title })",
"    });",
"    t.value = '';",
"    router();",
"  } catch(e) { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0434\u043e\u0431\u0430\u0432\u044f\u043d\u0435', 'error'); }",
"}"
].join('\r\n');

c = c.slice(0, ASF_START) + newAddStep + c.slice(ASF_END);
console.log('addStepFromPage done, len:', c.length);

// ─────────────────────────────────────────────────────────────────────────────
// Validate and save
// ─────────────────────────────────────────────────────────────────────────────
try {
  new Function(c);
  console.log('SYNTAX OK');
} catch(e) {
  console.error('SYNTAX ERROR:', e.message);
  process.exit(1);
}

fs.writeFileSync(appPath, c, 'utf8');
console.log('Saved. Was:', orig, '→ Now:', c.length);
