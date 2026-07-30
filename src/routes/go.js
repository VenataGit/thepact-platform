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

module.exports = router;
