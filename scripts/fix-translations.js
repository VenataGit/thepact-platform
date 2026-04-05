const fs = require('fs');
let c = fs.readFileSync('public/js/app.js', 'utf8');

// The file contains JavaScript source code with literal \u2026 escape sequences
// We need to match backslash + u2026 (6 chars) not the Unicode ellipsis character
const ESC_ELLIPSIS = '\\u2026';

function rep(from, to) {
  if (c.includes(from)) {
    c = c.replace(from, to);
    console.log('✓ Replaced:', from.substring(0, 40));
  } else {
    console.log('✗ Not found:', from.substring(0, 40));
  }
}

// Assign placeholder
rep("'Type names to assign" + ESC_ELLIPSIS + "'", "'Търси хора" + ESC_ELLIPSIS + "'");
rep('">Type names to assign' + ESC_ELLIPSIS + '</span>', '">Търси хора' + ESC_ELLIPSIS + '</span>');

// Notes placeholder
rep('placeholder="Add notes' + ESC_ELLIPSIS + '"', 'placeholder="Добави бележки' + ESC_ELLIPSIS + '"');
rep('">Add notes' + ESC_ELLIPSIS + '</span>', '">Добави бележки' + ESC_ELLIPSIS + '</span>');

// Describe step
rep('placeholder="Describe this step' + ESC_ELLIPSIS + '"', 'placeholder="Опиши тази стъпка' + ESC_ELLIPSIS + '"');

// Move along to
rep('value="">Move along to' + ESC_ELLIPSIS + '</option>', 'value="">Премести в' + ESC_ELLIPSIS + '</option>');

// Comment placeholder
rep('placeholder="Type your comment here' + ESC_ELLIPSIS + '"', 'placeholder="Написвай коментар тук' + ESC_ELLIPSIS + '"');

// Due on field label in bc-field section
rep('<span class="bc-field__label">Due on</span>', '<span class="bc-field__label">Краен срок</span>');

// Notes field label in bc-field section
rep('<span class="bc-field__label">Notes</span>', '<span class="bc-field__label">Бележки</span>');

// Assigned to field label
rep('<span class="bc-field__label">Assigned to</span>', '<span class="bc-field__label">Отговорник</span>');

// Added by field label
rep('<span class="bc-field__label">Added by</span>', '<span class="bc-field__label">Добавено от</span>');

// Steps field label
rep('<span class="bc-field__label">Steps</span>', '<span class="bc-field__label">Стъпки</span>');

// Cancel in step form
rep('>Cancel</button></div>\n        \'</div>\';', '>Отказ</button></div>\n        \'</div>\';');

fs.writeFileSync('public/js/app.js', c, 'utf8');
console.log('\nDone!');
