// Публичен мост към Basecamp за линковете в Google Calendar.
//
// Защо изобщо съществува: тапнат ДИРЕКТЕН basecamp.com линк от календара на iPhone → iOS го
// подава на нативното приложение (universal link), а то не отваря отделна Card Table карта →
// „This page couldn't be found". (Потвърдено с Венци, 16.07.2026.) Затова линкът в календара
// сочи ТУК (thepact.pro — не е basecamp домейн, така iOS не го прихваща) и оттук решаваме
// накъде да го пуснем.
//
// Двата вида потребители се държат различно (30.07.2026):
//
// ДЕСКТОП — авто-пренасочване към уеб, както досега (Венци: „работи перфектно"). Ключово:
// прави се с `window.location.replace(...)`, защото universal links на iOS НЕ сработват при
// JS навигация — така браузърът зарежда самата карта, вместо да я подаде на приложението.
//
// ТЕЛЕФОН — БЕЗ авто-пренасочване. Причината: браузърът на телефона няма Basecamp сесия, а
// Basecamp връща `302 → launchpad.37signals.com/bc3/<id>/signin` БЕЗ return-параметър, тоест
// след входа човекът остава на началната страница и картата се губи (проверено с curl,
// 30.07.2026 — точно това докладва Венци). Нативното приложение обаче е вече логнато, а и
// двата хоста обявяват `"/": "*"` в `apple-app-site-association` / `assetlinks.json`, т.е.
// приложението е валидна цел за universal link към пътя на картата. Затова на телефон даваме
// ИСТИНСКИ линк за тапване (universal link сработва само при потребителски тап) + резервен
// бутон към браузъра за случаите, в които приложението не разпознае пътя.
const express = require('express');
const router = express.Router();

// Класическият хост пази тъмната тема на акаунта; на уеб препраща напред при нужда.
const WEB_HOST = 'https://3.basecamp.com/';
// Каноничният хост на приложението — за тапа, който отваря нативното приложение.
const APP_HOST = 'https://app.basecamp.com/';

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// GET /go/basecamp/<basecamp-path>
router.get('/basecamp/*', (req, res) => {
  const raw = req.params[0] || '';
  // Допускаме само безопасната форма на Basecamp път (без схема, без хост, без опасни знаци).
  const safePath = /^[\w/\-.]*$/.test(raw) ? raw : '';
  const webUrl = WEB_HOST + safePath;
  const appUrl = APP_HOST + safePath;

  const payload = JSON.stringify({ web: webUrl, app: appUrl });

  res.set('Cache-Control', 'no-store');
  res.type('html').send(`<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Отваряне в Basecamp…</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #111a1e; color: #e6e6e6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .box { max-width: 420px; width: 100%; padding: 32px 24px; text-align: center; }
  h1 { font-size: 20px; font-weight: 700; margin: 0 0 8px; }
  p { font-size: 15px; line-height: 1.5; color: #a9b3b6; margin: 0 0 24px; }
  a.btn { display: block; width: 100%; padding: 14px 18px; border-radius: 20px;
          font-size: 16px; font-weight: 700; text-decoration: none; background: #46a374; color: #fff; }
  a.alt { display: inline-block; margin-top: 18px; font-size: 14px; color: #a9b3b6; text-decoration: underline; }
  .spin { width: 34px; height: 34px; margin: 0 auto 20px; border: 3px solid rgba(255,255,255,0.15);
          border-top-color: #46a374; border-radius: 50%; animation: r 0.8s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
  .hidden { display: none; }
</style>
</head>
<body>
  <div class="box">
    <div class="spin" id="spin"></div>
    <h1 id="title">Отваряне на задачата…</h1>
    <p id="hint">Пренасочваме те към Basecamp.</p>
    <a class="btn hidden" id="openBtn" href="#">Отвори задачата</a>
    <a class="alt hidden" id="altBtn" href="#"></a>
  </div>
<script>
(function () {
  var D = ${payload};
  if (!D.web) return;

  var ua = navigator.userAgent || '';
  var isMobile = /Android|iPhone|iPad|iPod/i.test(ua) ||
                 (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS

  var spin = document.getElementById('spin');
  var title = document.getElementById('title');
  var hint = document.getElementById('hint');
  var openBtn = document.getElementById('openBtn');
  var altBtn = document.getElementById('altBtn');

  // JS-пренасочване (НЕ тап върху basecamp домейн) → браузърът зарежда картата, вместо
  // iOS да я подаде на приложението (universal link не сработва при JS navigation).
  function goWeb() { window.location.replace(D.web); }

  if (!isMobile) {
    // ДЕСКТОП: авто-пренасочване към уеб (сесията там е активна).
    goWeb();
    setTimeout(function () {
      spin.className = 'hidden';
      title.textContent = 'Отвори задачата в Basecamp';
      hint.textContent = 'Ако не се отвори автоматично, натисни бутона.';
      openBtn.className = 'btn';
      openBtn.onclick = function (e) { e.preventDefault(); goWeb(); };
    }, 2000);
    return;
  }

  // ТЕЛЕФОН: без авто-пренасочване. Тапът върху истински basecamp линк вдига universal link
  // и отваря нативното приложение, което вече е логнато. (Авто-пренасочването към уеб
  // изхвърля на началната страница, защото Basecamp иска вход без да пази пътя.)
  spin.className = 'hidden';
  title.textContent = 'Отвори задачата';
  hint.textContent = 'В приложението Basecamp се отваря директно — вече си логнат там.';

  openBtn.className = 'btn';
  openBtn.textContent = 'Отвори в приложението Basecamp';
  openBtn.setAttribute('href', D.app); // истински href → тапът вдига universal link / App Link

  altBtn.className = 'alt';
  altBtn.textContent = 'Отвори в браузъра вместо това';
  altBtn.onclick = function (e) { e.preventDefault(); goWeb(); };
})();
</script>
<noscript>
  <div class="box">
    <a class="btn" href="${escHtml(appUrl)}">Отвори задачата в Basecamp</a>
  </div>
</noscript>
</body>
</html>`);
});

// ---------- GET /go/folder?p=<път> — мост към папка на вътрешния сървър ----------
//
// Защо съществува: браузърът НЕ позволява file:// линк да се отвори от https страница,
// а описанието на задачата живее в Basecamp (https). Затова бутонът „ОТВОРИ ПАПКА" в
// задачата сочи ТУК — обикновен https линк, който Basecamp пази без да го пипа. Оттук
// нататък страницата познава операционната система и подава пътя надолу:
//   Windows → thepact://open?p=…  (схема, регистрирана еднократно с folder-link/register.ps1)
//   macOS   → smb://192.168.31.147/Production/…  (Finder го отваря нативно, без инсталация)
// И в двата случая пътят стои и като текст с бутон „Копирай" — резервният вариант, който
// работи навсякъде, включително на телефон.
//
// Самата папка е достъпна само от офис мрежата, така че страницата е публична (както
// /go/basecamp) — тя не дава достъп до нищо, само превежда един път в друг.
const SHARE_HOST = '192.168.31.147';
const SHARE_NAME = 'Production';

// Приема Z:\… или \\192.168.31.147\Production\… ; всичко друго → null.
function parseFolder(raw) {
  const p = String(raw == null ? '' : raw).trim().replace(/\//g, '\\').replace(/\\+$/, '');
  if (!p || p.length > 400 || p.indexOf('..') !== -1) return null;

  const uncPrefix = '\\\\' + SHARE_HOST + '\\' + SHARE_NAME + '\\';
  let rel = null;
  if (/^[Zz]:\\/.test(p)) rel = p.slice(3);
  else if (p.toLowerCase().indexOf(uncPrefix.toLowerCase()) === 0) rel = p.slice(uncPrefix.length);
  if (!rel) return null;

  const posix = rel.replace(/\\/g, '/');
  return {
    win: 'Z:\\' + rel,
    mac: '/Volumes/' + SHARE_NAME + '/' + posix,
    smb: 'smb://' + SHARE_HOST + '/' + SHARE_NAME + '/' + encodeURI(posix),
    winUrl: 'thepact://open?p=' + encodeURIComponent('Z:\\' + rel),
    name: rel.split('\\').pop(),
  };
}

router.get('/folder', (req, res) => {
  const f = parseFolder(req.query.p);
  res.set('Cache-Control', 'no-store');
  if (!f) {
    return res.status(400).type('html').send(
      '<!DOCTYPE html><meta charset="utf-8"><body style="background:#111a1e;color:#e6e6e6;'
      + 'font-family:sans-serif;padding:40px;text-align:center">'
      + '<p>Невалиден път. Очаква се папка от вътрешния сървър (<code>Z:\\…</code>).</p></body>');
  }

  const payload = JSON.stringify(f);
  res.type('html').send(`<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(f.name)} — отваряне на папка</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #111a1e; color: #e6e6e6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .box { max-width: 520px; width: 100%; padding: 32px 24px; text-align: center; }
  h1 { font-size: 20px; font-weight: 700; margin: 0 0 6px; }
  .sub { font-size: 14px; color: #a9b3b6; margin: 0 0 22px; }
  .path { display: block; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px; padding: 12px 14px; font-family: ui-monospace, Consolas, monospace;
          font-size: 13px; line-height: 1.5; word-break: break-all; text-align: left; margin: 0 0 14px; }
  button.btn { display: block; width: 100%; padding: 14px 18px; border: 0; border-radius: 20px; cursor: pointer;
               font-size: 16px; font-weight: 700; background: #46a374; color: #fff; margin: 0 0 10px; }
  button.ghost { background: rgba(255,255,255,0.08); }
  .other { margin-top: 26px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.08);
           font-size: 13px; color: #a9b3b6; text-align: left; }
  .other .path { font-size: 12px; margin-top: 8px; }
  .note { font-size: 12px; color: #7d888b; margin-top: 16px; line-height: 1.6; }
</style>
</head>
<body>
  <div class="box">
    <h1 id="title">Отваряне на папката</h1>
    <p class="sub" id="sub">…</p>
    <code class="path" id="mainPath"></code>
    <button class="btn" id="openBtn">Отвори папката</button>
    <button class="btn ghost" id="copyBtn">Копирай пътя</button>
    <div class="other">
      <span id="otherLabel"></span>
      <code class="path" id="otherPath"></code>
      <button class="btn ghost" id="copyOther">Копирай и този път</button>
    </div>
    <p class="note" id="note"></p>
  </div>
<script>
(function () {
  var D = ${payload};
  var ua = navigator.userAgent || '';
  var isMac = /Mac|iPhone|iPad|iPod/i.test(ua);

  var mainPath = isMac ? D.mac : D.win;
  var otherPath = isMac ? D.win : D.mac;
  var openUrl = isMac ? D.smb : D.winUrl;

  document.getElementById('sub').textContent = isMac
    ? 'Разпознах macOS — бутонът подава папката на Finder.'
    : 'Разпознах Windows — бутонът подава папката на Explorer.';
  document.getElementById('mainPath').textContent = mainPath;
  document.getElementById('otherLabel').textContent = isMac ? 'За Windows:' : 'За macOS:';
  document.getElementById('otherPath').textContent = otherPath;
  document.getElementById('note').textContent = isMac
    ? 'Ако Finder поиска, потвърди отварянето. Дискът Production трябва да е закачен (Go → Connect to Server → smb://${SHARE_HOST}/${SHARE_NAME}).'
    : 'Първия път браузърът пита „Да отвори ли The Pact folder?" — потвърди и сложи отметка да помни. Ако нищо не се случи, схемата още не е регистрирана на този компютър — тогава ползвай „Копирай пътя".';

  document.getElementById('openBtn').onclick = function () { window.location.href = openUrl; };

  function copier(btnId, text, label) {
    document.getElementById(btnId).onclick = function () {
      var btn = this;
      var done = function () { btn.textContent = 'Копирано ✓'; setTimeout(function () { btn.textContent = label; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { window.prompt('Копирай пътя:', text); });
      } else {
        window.prompt('Копирай пътя:', text);
      }
    };
  }
  copier('copyBtn', mainPath, 'Копирай пътя');
  copier('copyOther', otherPath, 'Копирай и този път');
})();
</script>
</body>
</html>`);
});

module.exports = router;
