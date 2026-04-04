'use strict';
const fs = require('fs');
const path = require('path');
const appPath = path.join(__dirname, '..', 'public', 'js', 'app.js');
let c = fs.readFileSync(appPath, 'utf8');

function must(idx, label) {
  if (idx === -1) { console.error('NOT FOUND:', label); process.exit(1); }
  return idx;
}

const CR = '\r\n';

// ── 1. renderActivity — wrap in home-content-box ──────────────────────────────
{
  // Add opening wrapper
  const old1 =
    '    el.innerHTML = `' + CR +
    '      <div class="page-header"><h1>\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0430 \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442</h1></div>';
  const neu1 =
    '    el.innerHTML = `' + CR +
    '      <div class="home-content-box">' + CR +
    '      <div class="page-header"><h1>\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0430 \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442</h1></div>';
  must(c.indexOf(old1), 'renderActivity opening');
  c = c.replace(old1, neu1);

  // Add closing wrapper — anchor on unique loadMoreActivity text (file has literal \uXXXX escapes here)
  const old2 =
    'id="loadMoreActivityBtn" onclick="loadMoreActivity(this)">\\u0417\\u0430\\u0440\\u0435\\u0434\\u0438 \\u043f\\u043e\\u0432\\u0435\\u0447\\u0435</button></div>` : \'\'}' + CR +
    '      `;';
  const neu2 =
    'id="loadMoreActivityBtn" onclick="loadMoreActivity(this)">\\u0417\\u0430\\u0440\\u0435\\u0434\\u0438 \\u043f\\u043e\\u0432\\u0435\\u0447\\u0435</button></div>` : \'\'}' + CR +
    '      </div>' + CR +
    '      `;';
  must(c.indexOf(old2), 'renderActivity closing');
  c = c.replace(old2, neu2);
  console.log('1. renderActivity wrapped in home-content-box');
}

// ── 2. renderMyStuff — wrap in home-content-box ───────────────────────────────
{
  // Opening — remove inline max-width style from task-list
  const old1 =
    '    el.innerHTML = `' + CR +
    '      <div class="page-header"><h1>\u041c\u043e\u0438\u0442\u0435 \u0437\u0430\u0434\u0430\u0447\u0438</h1><div class="page-subtitle">${cards.length} \u0437\u0430\u0434\u0430\u0447\u0438</div></div>' + CR +
    '      <div class="task-list" style="max-width:760px;margin:0 auto">';
  const neu1 =
    '    el.innerHTML = `' + CR +
    '      <div class="home-content-box">' + CR +
    '      <div class="page-header"><h1>\u041c\u043e\u0438\u0442\u0435 \u0437\u0430\u0434\u0430\u0447\u0438</h1><div class="page-subtitle">${cards.length} \u0437\u0430\u0434\u0430\u0447\u0438</div></div>' + CR +
    '      <div class="task-list">';
  must(c.indexOf(old1), 'renderMyStuff opening');
  c = c.replace(old1, neu1);

  // Closing — use unique noDate anchor
  const old2 =
    '        ${noDate.length   > 0 ? `<div class="task-section-label" style="opacity:0.6">\u0411\u0435\u0437 \u0434\u0430\u0442\u0430 (${noDate.length})</div>${noDate.map(renderCard).join(\'\')}` : \'\'}' + CR +
    '      </div>`;';
  const neu2 =
    '        ${noDate.length   > 0 ? `<div class="task-section-label" style="opacity:0.6">\u0411\u0435\u0437 \u0434\u0430\u0442\u0430 (${noDate.length})</div>${noDate.map(renderCard).join(\'\')}` : \'\'}' + CR +
    '      </div>' + CR +
    '      </div>`;';
  must(c.indexOf(old2), 'renderMyStuff closing');
  c = c.replace(old2, neu2);
  console.log('2. renderMyStuff wrapped in home-content-box');
}

// ── 3. renderNotifications — replace inline style div with home-content-box ───
{
  const old =
    '    el.innerHTML = `' + CR +
    '      <div class="page-header">' + CR +
    '        <h1>Hey!</h1>' + CR +
    '        <div class="page-subtitle">\u0422\u0432\u043e\u0438\u0442\u0435 \u0438\u0437\u0432\u0435\u0441\u0442\u0438\u044f</div>' + CR +
    '      </div>' + CR +
    '      <div style="max-width:640px;margin:0 auto;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;overflow:hidden">' + CR +
    '        ${listHtml}' + CR +
    '      </div>`;';
  const neu =
    '    el.innerHTML = `' + CR +
    '      <div class="home-content-box">' + CR +
    '      <div class="page-header">' + CR +
    '        <h1>Hey!</h1>' + CR +
    '        <div class="page-subtitle">\u0422\u0432\u043e\u0438\u0442\u0435 \u0438\u0437\u0432\u0435\u0441\u0442\u0438\u044f</div>' + CR +
    '      </div>' + CR +
    '      <div style="border-radius:8px;overflow:hidden;border:1px solid var(--border)">' + CR +
    '        ${listHtml}' + CR +
    '      </div>' + CR +
    '      </div>`;';
  must(c.indexOf(old), 'renderNotifications innerHTML');
  c = c.replace(old, neu);
  console.log('3. renderNotifications wrapped in home-content-box');
}

// ── 4. renderChatList — wrap in home-content-box ─────────────────────────────
{
  // Opening
  const old1 =
    '    el.innerHTML = `' + CR +
    '      <div class="pings-page">';
  const neu1 =
    '    el.innerHTML = `' + CR +
    '      <div class="home-content-box">' + CR +
    '      <div class="pings-page">';
  must(c.indexOf(old1), 'renderChatList opening');
  c = c.replace(old1, neu1);

  // Closing — anchor on pings-search-bar listener line
  const old2 =
    '      </div>`;' + CR +
    '    document.addEventListener(\'click\', e => { if (!e.target.closest(\'.pings-search-bar\'))';
  const neu2 =
    '      </div>' + CR +
    '      </div>`;' + CR +
    '    document.addEventListener(\'click\', e => { if (!e.target.closest(\'.pings-search-bar\'))';
  must(c.indexOf(old2), 'renderChatList closing');
  c = c.replace(old2, neu2);
  console.log('4. renderChatList wrapped in home-content-box');
}

// ── 5. renderKpAuto — change class + wrap all innerHTML calls ─────────────────
{
  // renderKpAuto: class + loading state
  const old1 =
    '  el.className = \'page-tool\';' + CR +
    '  el.innerHTML = \'<div class="kp-auto-wrap"><div style="text-align:center;padding:40px;color:var(--text-dim)">\u0417\u0430\u0440\u0435\u0436\u0434\u0430\u043d\u0435...</div></div>\';';
  const neu1 =
    '  el.className = \'\';' + CR +
    '  el.innerHTML = \'<div class="home-content-box"><div class="kp-auto-wrap"><div style="text-align:center;padding:40px;color:var(--text-dim)">\u0417\u0430\u0440\u0435\u0436\u0434\u0430\u043d\u0435...</div></div></div>\';';
  must(c.indexOf(old1), 'renderKpAuto class + loading');
  c = c.replace(old1, neu1);

  // loadKpAuto: error when !res.ok
  const old2 =
    'el.innerHTML = \'<div class="kp-auto-wrap"><div style="text-align:center;padding:40px;color:var(--red)">\u0413\u0440\u0435\u0448\u043a\u0430: \' + esc((clients && clients.error) || \'\u041d\u0435\u0443\u0441\u043f\u0435\u0448\u043d\u043e \u0437\u0430\u0440\u0435\u0436\u0434\u0430\u043d\u0435\') + \'</div></div>\';';
  const neu2 =
    'el.innerHTML = \'<div class="home-content-box"><div class="kp-auto-wrap"><div style="text-align:center;padding:40px;color:var(--red)">\u0413\u0440\u0435\u0448\u043a\u0430: \' + esc((clients && clients.error) || \'\u041d\u0435\u0443\u0441\u043f\u0435\u0448\u043d\u043e \u0437\u0430\u0440\u0435\u0436\u0434\u0430\u043d\u0435\') + \'</div></div></div>\';';
  must(c.indexOf(old2), 'loadKpAuto error innerHTML');
  c = c.replace(old2, neu2);

  // loadKpAuto: main content opening
  const old3 = 'el.innerHTML = \'<div class="kp-auto-wrap">\' +';
  const neu3 = 'el.innerHTML = \'<div class="home-content-box"><div class="kp-auto-wrap">\' +';
  must(c.indexOf(old3), 'loadKpAuto main content opening');
  c = c.replace(old3, neu3);

  // loadKpAuto: main content closing (tableHtml + '</div>')
  const old4 =
    '      tableHtml +' + CR +
    '    \'</div>\';';
  const neu4 =
    '      tableHtml +' + CR +
    '    \'</div></div>\';';
  must(c.indexOf(old4), 'loadKpAuto main content closing');
  c = c.replace(old4, neu4);

  // loadKpAuto: catch block error
  const old5 =
    '    el.innerHTML = \'<div style="text-align:center;padding:40px;color:var(--red)">\u0413\u0440\u0435\u0448\u043a\u0430: \' + esc(err.message) + \'</div>\';';
  const neu5 =
    '    el.innerHTML = \'<div class="home-content-box"><div style="text-align:center;padding:40px;color:var(--red)">\u0413\u0440\u0435\u0448\u043a\u0430: \' + esc(err.message) + \'</div></div>\';';
  must(c.indexOf(old5), 'loadKpAuto catch error');
  c = c.replace(old5, neu5);

  console.log('5. renderKpAuto + loadKpAuto wrapped in home-content-box');
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
