// Публичен мост към Basecamp за линковете в Google Calendar.
//
// Проблемът: тапнат директен basecamp.com линк от календара на iPhone → iOS го подава на
// нативното приложение (universal link), а то НЕ отваря отделна Card Table карта → „This page
// couldn't be found". (Потвърдено с Венци, 16.07.2026.)
//
// Решението (вариант Б, избран от Венци): линкът в календара сочи ТУК (thepact.pro — не е
// basecamp домейн, затова се отваря в БРАУЗЪРА, не в приложението). Оттук правим
// `window.location.replace(...)` към точната карта. Ключово: universal links на iOS НЕ
// сработват при JavaScript-пренасочване (само при потребителски тап върху basecamp линк),
// затова браузърът зарежда самата карта, вместо да я подаде на приложението. Ако браузърът е
// логнат в Basecamp — картата се отваря директно; ако не — Basecamp иска вход (еднократно).
//
// Десктоп работи по същия начин (пренасочва към картата в активната сесия). Без auth — тапва
// се от календар без сесия към платформата.
const express = require('express');
const router = express.Router();

// Класическият хост пази тъмната тема на акаунта; на уеб препраща напред при нужда.
const WEB_HOST = 'https://3.basecamp.com/';

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

  const payload = JSON.stringify({ web: webUrl });

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
  </div>
<script>
(function () {
  var D = ${payload};
  if (!D.web) return;

  // JS-пренасочване (НЕ тап върху basecamp домейн) → браузърът зарежда картата, вместо
  // iOS да я подаде на приложението (universal link не сработва при JS navigation).
  function go() { window.location.replace(D.web); }
  go();

  // Резервен бутон, ако автоматичното пренасочване е блокирано — пак през JS (не href handoff),
  // за да не подаде линка на приложението.
  setTimeout(function () {
    document.getElementById('spin').className = 'hidden';
    document.getElementById('title').textContent = 'Отвори задачата в Basecamp';
    document.getElementById('hint').textContent =
      'Ако не се отвори автоматично, натисни бутона. (Трябва да си логнат в Basecamp в браузъра.)';
    var b = document.getElementById('openBtn');
    b.className = 'btn';
    b.onclick = function (e) { e.preventDefault(); go(); };
  }, 2000);
})();
</script>
<noscript>
  <div class="box">
    <a class="btn" href="${escHtml(webUrl)}">Отвори задачата в Basecamp</a>
  </div>
</noscript>
</body>
</html>`);
});

module.exports = router;
