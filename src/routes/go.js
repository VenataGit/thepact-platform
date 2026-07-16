// Публичен „smart deep-link" мост към Basecamp.
//
// Линковете в Google Calendar сочат тук (напр. /go/basecamp/5750544/buckets/47742842/todos/123)
// вместо директно към 3.basecamp.com. Причина: тапнат от календара, директен линк отваря
// вградения браузър на приложението Calendar, където потребителят не е логнат → грешка.
// Тази страница разпознава устройството и:
//   • Android  → intent:// към нативното Basecamp приложение (ако е инсталирано), иначе сайта.
//   • iOS      → показва ясен бутон „Отвори в Basecamp" (universal link) + линк към браузър.
//   • Desktop  → веднага пренасочва към сайта (там потребителят е логнат).
// Без auth — тапва се от календар, където няма сесия към платформата. Грешен пакет/липсващо
// приложение → тихо пада към уеб линка, така че никога не е по-зле от директния линк.
const express = require('express');
const router = express.Router();

const BC_WEB = 'https://3.basecamp.com/';
const BC_ANDROID_PKG = 'com.basecamp.bc3'; // Basecamp 3 (Android)

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
  const webUrl = BC_WEB + safePath;

  const payload = JSON.stringify({ path: safePath, web: webUrl, pkg: BC_ANDROID_PKG });

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
  a.btn { display: block; width: 100%; padding: 14px 18px; margin: 0 0 12px; border-radius: 20px;
          font-size: 16px; font-weight: 700; text-decoration: none; }
  a.primary { background: #46a374; color: #fff; }
  a.secondary { background: rgba(255,255,255,0.06); color: #e6e6e6; }
  .spin { width: 34px; height: 34px; margin: 0 auto 20px; border: 3px solid rgba(255,255,255,0.15);
          border-top-color: #46a374; border-radius: 50%; animation: r 0.8s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
  .hidden { display: none; }
</style>
</head>
<body>
  <div class="box">
    <div class="spin" id="spin"></div>
    <h1 id="title">Отваряне в Basecamp…</h1>
    <p id="hint">Пренасочваме те към задачата.</p>
    <div id="actions" class="hidden">
      <a class="btn primary" id="openApp">Отвори в приложението Basecamp</a>
      <a class="btn secondary" id="openWeb">Отвори в браузър</a>
    </div>
  </div>
<script>
(function () {
  var D = ${payload};
  var ua = navigator.userAgent || '';
  var isAndroid = /Android/i.test(ua);
  var isIOS = /iPhone|iPad|iPod/i.test(ua) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function showActions() {
    document.getElementById('spin').className = 'hidden';
    document.getElementById('title').textContent = 'Отвори задачата в Basecamp';
    document.getElementById('hint').textContent =
      'Ако е инсталирано приложението, отвори го в него — иначе в браузър.';
    var a = document.getElementById('actions'); a.className = '';
    document.getElementById('openApp').setAttribute('href', D.web);
    document.getElementById('openWeb').setAttribute('href', D.web);
  }

  if (!D.path) { showActions(); return; }

  if (isAndroid) {
    // intent:// → отваря нативния Basecamp; ако липсва, пада към уеб линка (browser_fallback_url).
    var intent = 'intent://3.basecamp.com/' + D.path +
      '#Intent;scheme=https;package=' + D.pkg +
      ';S.browser_fallback_url=' + encodeURIComponent(D.web) + ';end';
    window.location.replace(intent);
    // Резервен вариант, ако intent-ът не е обработен.
    setTimeout(showActions, 1200);
  } else if (isIOS) {
    // iOS няма публична схема; universal link отваря приложението само в системния Safari.
    // Показваме ясни бутони вместо да рискуваме „бяла страница" във вградения браузър.
    showActions();
  } else {
    // Desktop — направо към сайта (там сесията е активна).
    window.location.replace(D.web);
    setTimeout(showActions, 1500);
  }
})();
</script>
<noscript>
  <div class="box">
    <a class="btn primary" href="${escHtml(webUrl)}">Отвори задачата в Basecamp</a>
  </div>
</noscript>
</body>
</html>`);
});

module.exports = router;
