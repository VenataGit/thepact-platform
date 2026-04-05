const fs = require('fs');
let c = fs.readFileSync('public/js/app.js', 'utf8');

// All these strings are in the JS file as literal escape sequences
// The file contains them as: \u270f\ufe0f etc. (backslash+u+hex)
// In Node.js strings: '\\u' = backslash+u (literal, not unicode escape)

const reps = [
  // Options menu
  ['\\u270f\\ufe0f Edit</button>', '\\u270f\\ufe0f Редактирай</button>'],
  ['\\u2197\\ufe0f Move</button>', '\\u2197\\ufe0f Премести</button>'],
  ['\\ud83d\\udce6 Archive</button>', '\\ud83d\\udce6 Архивирай</button>'],
  ['\\ud83d\\uddd1\\ufe0f Put in the trash</button>', '\\ud83d\\uddd1\\ufe0f В кошчето</button>'],
  ['\\ud83d\\udd16 Bookmark</button>', '\\ud83d\\udd16 Отметка</button>'],
  ['\\ud83d\\udd50 View change log</button>', '\\ud83d\\udd50 История на промените</button>'],
  ['\\ud83d\\udc65 Notified people</button>', '\\ud83d\\udc65 Уведомени хора</button>'],
  // Move card picker typo
  ["'Премести в кой бордrd?\\n'", "'Премести в кой борд?\\n'"],
  ["'Which column?\\n'", "'Коя колона?\\n'"],
];

reps.forEach(([from, to]) => {
  if (c.includes(from)) {
    c = c.replace(from, to);
    console.log('✓ Replaced:', from.substring(0, 40));
  } else {
    console.log('✗ Not found:', from.substring(0, 40));
  }
});

fs.writeFileSync('public/js/app.js', c, 'utf8');
console.log('\nDone!');
