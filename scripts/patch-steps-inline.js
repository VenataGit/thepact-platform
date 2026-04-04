'use strict';
const fs = require('fs');
const path = require('path');
const appPath = path.join(__dirname, '..', 'public', 'js', 'app.js');
let c = fs.readFileSync(appPath, 'utf8');

function must(idx, label) {
  if (idx === -1) { console.error('NOT FOUND:', label); process.exit(1); }
  return idx;
}

// ── 1. Add data-card-id to the steps li ─────────────────────────────────────
{
  const old = "return '<li class=\"bc-checklist__item' + doneClass + '\" data-step-id=\"' + s.id + '\">'";
  const neu = "return '<li class=\"bc-checklist__item' + doneClass + '\" data-step-id=\"' + s.id + '\" data-card-id=\"' + cardId + '\">'";
  must(c.indexOf(old), 'li data-step-id');
  c = c.replace(old, neu);
  console.log('1. data-card-id added to li');
}

// ── 2. Replace expandStep ────────────────────────────────────────────────────
{
  const fnStart = c.indexOf('function expandStep(cardId, stepId, li)');
  const fnEnd   = c.indexOf('\r\nasync function saveStepEdit', fnStart);
  must(fnStart, 'expandStep start');
  must(fnEnd,   'expandStep end');

  const newFn = [
    'function expandStep(cardId, stepId, li) {',
    '  // If already editing this step, just focus the input',
    '  if (li.classList.contains(\'bc-checklist__item--editing\')) {',
    '    var ex = li.querySelector(\'.bc-step-edit-input\');',
    '    if (ex) ex.focus();',
    '    return;',
    '  }',
    '  // Collapse any other open inline editors',
    '  document.querySelectorAll(\'.bc-checklist__item--editing\').forEach(function(item) {',
    '    collapseStepEditInline(item);',
    '  });',
    '',
    '  var textSpan = li.querySelector(\'span\');',
    '  if (!textSpan) return;',
    '  var originalText = textSpan.textContent;',
    '',
    '  li.classList.add(\'bc-checklist__item--editing\');',
    '',
    '  // Wrapper replaces the span — contains input + action buttons',
    '  var wrap = document.createElement(\'div\');',
    '  wrap.className = \'bc-step-edit-wrap\';',
    '  wrap.addEventListener(\'click\', function(e) { e.stopPropagation(); });',
    '',
    '  var inp = document.createElement(\'input\');',
    '  inp.type = \'text\';',
    '  inp.className = \'bc-step-edit-input\';',
    '  inp.id = \'editStepTitle_\' + stepId;',
    '  inp.value = originalText;',
    '',
    '  var actions = document.createElement(\'div\');',
    '  actions.className = \'bc-step-expand__actions\';',
    '  actions.style.marginTop = \'8px\';',
    '',
    '  var btnRow = document.createElement(\'div\');',
    '  btnRow.style.cssText = \'display:flex;gap:8px\';',
    '',
    '  var saveBtn = document.createElement(\'button\');',
    '  saveBtn.className = \'bc-btn-save\';',
    '  saveBtn.textContent = \'\u0417\u0430\u043f\u0430\u0437\u0438\';',
    '  saveBtn.onclick = function() { saveStepEdit(cardId, stepId); };',
    '',
    '  var cancelBtn = document.createElement(\'button\');',
    '  cancelBtn.className = \'bc-btn-discard\';',
    '  cancelBtn.textContent = \'\u041e\u0442\u043a\u0430\u0437\';',
    '  cancelBtn.onclick = function() { collapseStepEditInline(li); };',
    '',
    '  var delBtn = document.createElement(\'button\');',
    '  delBtn.className = \'bc-step-expand__delete\';',
    '  delBtn.textContent = \'\u0418\u0437\u0442\u0440\u0438\u0439 \u0441\u0442\u044a\u043f\u043a\u0430\';',
    '  delBtn.onclick = function() { deleteStep(cardId, stepId); };',
    '',
    '  btnRow.appendChild(saveBtn);',
    '  btnRow.appendChild(cancelBtn);',
    '  actions.appendChild(btnRow);',
    '  actions.appendChild(delBtn);',
    '  wrap.appendChild(inp);',
    '  wrap.appendChild(actions);',
    '',
    '  textSpan.replaceWith(wrap);',
    '  inp.focus();',
    '  inp.select();',
    '',
    '  inp.addEventListener(\'keydown\', function(e) {',
    '    if (e.key === \'Enter\') { e.preventDefault(); saveStepEdit(cardId, stepId); }',
    '    if (e.key === \'Escape\') { collapseStepEditInline(li); }',
    '  });',
    '}',
    '',
    'function collapseStepEditInline(li) {',
    '  var wrap = li.querySelector(\'.bc-step-edit-wrap\');',
    '  var inp  = li.querySelector(\'.bc-step-edit-input\');',
    '  if (!wrap) return;',
    '  li.classList.remove(\'bc-checklist__item--editing\');',
    '  var span = document.createElement(\'span\');',
    '  span.textContent = inp ? (inp.value || \'\') : \'\';',
    '  var cId    = li.dataset.cardId;',
    '  var stepId = li.dataset.stepId;',
    '  if (cId && stepId) {',
    '    span.onclick = (function(ci, si) {',
    '      return function() { expandStep(parseInt(ci), parseInt(si), li); };',
    '    })(cId, stepId);',
    '  }',
    '  wrap.replaceWith(span);',
    '}'
  ].join('\r\n');

  c = c.slice(0, fnStart) + newFn + c.slice(fnEnd);
  console.log('2. expandStep + collapseStepEditInline done');
}

// ── Validate and save ─────────────────────────────────────────────────────────
try {
  new Function(c);
  console.log('SYNTAX OK');
} catch(e) {
  console.error('SYNTAX ERROR:', e.message);
  process.exit(1);
}
fs.writeFileSync(appPath, c, 'utf8');
console.log('Saved. Length:', c.length);
