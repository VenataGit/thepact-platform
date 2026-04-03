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

// Replace remaining alert() calls with showToast

// 1. Create card: title required
rep(
  "return alert('Заглавието е задължително')",
  "return showToast('\u0417\u0430\u0433\u043b\u0430\u0432\u0438\u0435\u0442\u043e \u0435 \u0437\u0430\u0434\u044a\u043b\u0436\u0438\u0442\u0435\u043b\u043d\u043e', 'warn')",
  'title required -> toast'
);

// 2. Comment save errors
rep(
  "alert(d.error || '\u0413\u0440\u0435\u0448\u043a\u0430'); if(btn){btn.disabled=false;btn.textContent='\u0414\u043e\u0431\u0430\u0432\u0438 \u043a\u043e\u043c\u0435\u043d\u0442\u0430\u0440'",
  "showToast(d.error || '\u0413\u0440\u0435\u0448\u043a\u0430', 'error'); if(btn){btn.disabled=false;btn.textContent='\u0414\u043e\u0431\u0430\u0432\u0438 \u043a\u043e\u043c\u0435\u043d\u0442\u0430\u0440'",
  'comment error -> toast'
);
rep(
  "alert('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0438\u0437\u043f\u0440\u0430\u0449\u0430\u043d\u0435'); if(btn){btn.disabled=false;btn.textContent='\u0414\u043e\u0431\u0430\u0432\u0438 \u043a\u043e\u043c\u0435\u043d\u0442\u0430\u0440'",
  "showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0438\u0437\u043f\u0440\u0430\u0449\u0430\u043d\u0435', 'error'); if(btn){btn.disabled=false;btn.textContent='\u0414\u043e\u0431\u0430\u0432\u0438 \u043a\u043e\u043c\u0435\u043d\u0442\u0430\u0440'",
  'comment send error -> toast'
);

// 3. KP validation
rep(
  "return alert('\u0412\u044a\u0432\u0435\u0434\u0438 \u0438\u043c\u0435 \u043d\u0430 \u043a\u043b\u0438\u0435\u043d\u0442')",
  "return showToast('\u0412\u044a\u0432\u0435\u0434\u0438 \u0438\u043c\u0435 \u043d\u0430 \u043a\u043b\u0438\u0435\u043d\u0442', 'warn')",
  'client name required -> toast'
);

// 4. SOS send errors
rep(
  "if (targetUserIds.length === 0) return alert('\u0418\u0437\u0431\u0435\u0440\u0438 \u043f\u043e\u043d\u0435 \u0435\u0434\u0438\u043d \u0447\u043e\u0432\u0435\u043a')",
  "if (targetUserIds.length === 0) return showToast('\u0418\u0437\u0431\u0435\u0440\u0438 \u043f\u043e\u043d\u0435 \u0435\u0434\u0438\u043d \u0447\u043e\u0432\u0435\u043a', 'warn')",
  'SOS no users -> toast'
);

// Replace all remaining error alert patterns
const errorPat1 = /alert\('Грешка: ' \+ \(data\.error \|\| '[^']+'\)\)/g;
let count1 = 0;
c = c.replace(errorPat1, (m) => { count1++; return m.replace('alert(', 'showToast(').replace(/\)$/, ", 'error')"); });
console.log('OK: replaced', count1, 'data.error alert -> toast');

const errorPat2 = /alert\('Грешка: ' \+ err\.message\)/g;
let count2 = 0;
c = c.replace(errorPat2, (m) => { count2++; return m.replace('alert(', 'showToast(').replace(/\)$/, ", 'error')"); });
console.log('OK: replaced', count2, 'err.message alert -> toast');

const errorPat3 = /alert\(d\.error \|\| 'Грешка'\)/g;
let count3 = 0;
c = c.replace(errorPat3, (m) => { count3++; return m.replace('alert(', 'showToast(').replace(/\)$/, ", 'error')"); });
console.log('OK: replaced', count3, 'd.error alert -> toast');

const errorPat4 = /alert\('Грешка \w+ [^']+'\)/g;
let count4 = 0;
c = c.replace(errorPat4, (m) => { count4++; return m.replace('alert(', 'showToast(').replace(/\)$/, ", 'error')"); });
console.log('OK: replaced', count4, 'generic error alert -> toast');

fs.writeFileSync('public/js/app.js', c, 'utf8');
console.log('\nBatch 14 alert->toast replacements done!');
