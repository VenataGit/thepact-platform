// Публичен „smart deep-link" мост към Basecamp.
//
// Линковете в Google Calendar сочат тук (напр. /go/basecamp/5750544/buckets/47742842/todos/123)
// вместо директно към Basecamp. Причина: тапнат от календара на телефона, директен линк отваря
// вградения мини-браузър, а класическият хост 3.basecamp.com не се разпознава от нативното
// приложение → „This page couldn't be found".
//
// Basecamp има ДВА хоста със СЪЩИЯ път:
//   • app.basecamp.com — новият/каноничният хост; нативните приложения (iOS/Android) отварят
//     точно него през своите universal / app links. → ползваме го на ТЕЛЕФОН.
//   • 3.basecamp.com   — класическият хост; пази тъмната тема в браузъра на десктоп, но на
//     уеб само 302-ва напред (затова на компютър работи, а в приложението дава 404). → ползваме
//     го на ДЕСКТОП.
//
// Без auth — тапва се от календар, където няма сесия към платформата.
const express = require('express');
const router = express.Router();

const WEB_HOST = 'https://3.basecamp.com/';   // десктоп браузър (тъмна тема)
const APP_HOST = 'https://app.basecamp.com/'; // телефон (нативно приложение)

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

  const payload = JSON.stringify({ path: safePath, web: webUrl, app: appUrl });

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
  a.link { display: inline-block; color: #7fb9a0; font-size: 14px; text-decoration: underline; margin-top: 4px; }
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
      <a class="btn primary" id="openBtn">Отвори задачата в Basecamp</a>
      <a class="link" id="altLink">Не се отвори? Пробвай в браузър</a>
    </div>
  </div>
<script>
(function () {
  var D = ${payload};
  var ua = navigator.userAgent || '';
  var isMobile = /Android|iPhone|iPad|iPod/i.test(ua) ||
                 (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // primaryUrl = основният бутон (тап от потребителя = отваря нативното приложение на iOS/Android);
  // altUrl = резервният линк към другия хост.
  function showActions(primaryUrl, altUrl, altLabel) {
    document.getElementById('spin').className = 'hidden';
    document.getElementById('title').textContent = 'Отвори задачата в Basecamp';
    document.getElementById('hint').textContent = isMobile
      ? 'Тапни бутона — задачата ще се отвори в приложението Basecamp.'
      : 'Ако не се пренасочиш автоматично, натисни бутона.';
    document.getElementById('openBtn').setAttribute('href', primaryUrl);
    var alt = document.getElementById('altLink');
    alt.setAttribute('href', altUrl);
    alt.textContent = altLabel;
    document.getElementById('actions').className = '';
  }

  if (!D.path) {
    showActions(D.app, D.web, 'Отвори в браузър');
  } else if (isMobile) {
    // Телефон: каноничният хост (app.basecamp.com) се отваря коректно в нативното приложение.
    // Изисква тап от потребителя (universal link не сработва при автоматично пренасочване).
    showActions(D.app, D.web, 'Не се отвори? Пробвай в браузър');
  } else {
    // Десктоп: направо към класическия хост (тъмна тема, активна сесия).
    window.location.replace(D.web);
    setTimeout(function () { showActions(D.web, D.app, 'Отвори в приложението Basecamp'); }, 1500);
  }
})();
</script>
<noscript>
  <div class="box">
    <a class="btn primary" href="${escHtml(appUrl)}">Отвори задачата в Basecamp</a>
  </div>
</noscript>
</body>
</html>`);
});

module.exports = router;
