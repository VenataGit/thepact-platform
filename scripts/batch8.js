const fs = require('fs');
let c = fs.readFileSync('public/js/app.js', 'utf8');

function rep(from, to, label) {
  if (c.includes(from)) {
    c = c.replace(from, to);
    console.log('OK:', label || from.substring(0, 60));
  } else {
    console.log('NOT FOUND:', label || from.substring(0, 60));
  }
}

// 1. Fix 'On Hold' in dashboard
rep(
  "'\\u23f8 On Hold (' + holdCards.length + ')'",
  "'\\u23f8 \\u041d\\u0430 \\u0438\\u0437\\u0447\\u0430\\u043a\\u0432\\u0430\\u043d\\u0435 (' + holdCards.length + ')'",
  'On Hold -> На изчакване'
);

// 2. Fix 'Pinned' in card pinned sidebar
rep(
  "'\\ud83d\\udccc Pinned'",
  "'\\ud83d\\udccc \\u0417\\u0430\\u043a\\u0430\\u0447\\u0435\\u043d\\u043e'",
  'Pinned -> Закачено'
);

// 3. Fix 'Unknown' in error messages (all 4 occurrences)
rep(
  "|| 'Unknown')",
  "|| '\\u041d\\u0435\\u0438\\u0437\\u0432\\u0435\\u0441\\u0442\\u043d\\u0430')",
  'Unknown -> Неизвестна (first)'
);
while (c.includes("|| 'Unknown')")) {
  c = c.replace("|| 'Unknown')", "|| '\\u041d\\u0435\\u0438\\u0437\\u0432\\u0435\\u0441\\u0442\\u043d\\u0430')");
  console.log('OK: Unknown -> Неизвестна (repeat)');
}

// 4. Add client_name to renderDashCard
rep(
  "'<div class=\"dash-card__title\">' + (card.is_on_hold ? '\\u23f8 ' : '') + esc(card.title) + '</div>' +",
  "'<div class=\"dash-card__title\">' + (card.is_on_hold ? '\\u23f8 ' : '') + esc(card.title) + '</div>' +\n    (card.client_name ? '<div class=\"dash-card__client\">' + esc(card.client_name) + '</div>' : '') +",
  'add client_name to dash card'
);

// 5. Add 'archived' action translation in activity
rep(
  "if (a.action === 'checked_off') return 'отметна стъпка на';\n      return a.action;",
  "if (a.action === 'checked_off') return 'отметна стъпка на';\n      if (a.action === 'archived') return 'архивира';\n      if (a.action === 'updated') return 'обнови';\n      return a.action;",
  'add archived/updated action translations'
);

// 6. Also fix in filterActivity function
rep(
  "(a.action==='created'?'създаде':a.action==='commented'?'коментира':a.action==='moved'?'премести':a.action==='completed'?'завърши':a.action==='checked_off'?'отметна стъпка на':a.action)",
  "(a.action==='created'?'създаде':a.action==='commented'?'коментира':a.action==='moved'?'премести':a.action==='completed'?'завърши':a.action==='checked_off'?'отметна стъпка на':a.action==='archived'?'архивира':a.action==='updated'?'обнови':a.action)",
  'add archived/updated in filterActivity'
);

// 7. Also fix in loadProjectActivity
rep(
  "a.action === 'created' ? 'създаде' : a.action === 'commented' ? 'коментира' : a.action === 'moved' ? 'премести' : a.action === 'completed' ? 'завърши' : a.action === 'checked_off' ? 'отметна стъпка на' : a.action",
  "a.action === 'created' ? 'създаде' : a.action === 'commented' ? 'коментира' : a.action === 'moved' ? 'премести' : a.action === 'completed' ? 'завърши' : a.action === 'checked_off' ? 'отметна стъпка на' : a.action === 'archived' ? 'архивира' : a.action === 'updated' ? 'обнови' : a.action",
  'add archived/updated in loadProjectActivity'
);

fs.writeFileSync('public/js/app.js', c, 'utf8');
console.log('\nBatch 8 string fixes done!');
