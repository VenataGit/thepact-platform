// Публичен „smart deep-link" мост към Basecamp.
//
// Линковете в Google Calendar сочат тук (напр. /go/basecamp/5750544/buckets/39396506/card_tables/cards/123)
// вместо директно към Basecamp.
//
// Наблюдение (Венци, iPhone, 16.07.2026): нативното приложение Basecamp НЕ отваря директен линк
// към отделна карта от Card Table (kanban) — вътрешният му рутер не разпознава пътя
// `card_tables/cards/<id>` и дава „This page couldn't be found", докато на десктоп уеб същият
// адрес работи. Обикновени неща (to-do, известия) се отварят нормално. Затова:
//   • Десктоп        → директно самата карта на 3.basecamp.com (тъмна тема, активна сесия).
//   • Телефон        → отваряме ПРОЕКТА в приложението (него приложението разпознава), а картата
//                      е на един-два тапа вътре. Директната карта остава като резервен линк за браузър.
//
// Двата хоста имат същия път: app.basecamp.com (каноничен, за приложението) и 3.basecamp.com
// (класически, тъмна тема в браузъра). Без auth — тапва се от календар без сесия към платформата.
const express = require('express');
const router = express.Router();

const WEB_HOST = 'https://3.basecamp.com/';   // класически хост (десктоп браузър, тъмна тема)
const APP_HOST = 'https://app.basecamp.com/'; // каноничен хост (нативно приложение)

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
  const webUrl = WEB_HOST + safePath;                 // точната карта (браузър)
  // Проектът (bucket) — приложението го отваря надеждно; картата е вътре.
  const bucket = /^(\d+\/buckets\/\d+)(?:\/|$)/.exec(safePath);
  const projectUrl = bucket ? APP_HOST + bucket[1] : APP_HOST;

  const payload = JSON.stringify({ path: safePath, web: webUrl, project: projectUrl, hasBucket: !!bucket });

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
      <a class="btn primary" id="openBtn">Отвори в Basecamp</a>
      <a class="link" id="altLink"></a>
    </div>
  </div>
<script>
(function () {
  var D = ${payload};
  var ua = navigator.userAgent || '';
  var isMobile = /Android|iPhone|iPad|iPod/i.test(ua) ||
                 (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function showActions(primaryUrl, primaryLabel, hint, altUrl, altLabel) {
    document.getElementById('spin').className = 'hidden';
    document.getElementById('title').textContent = 'Отвори в Basecamp';
    document.getElementById('hint').textContent = hint;
    var b = document.getElementById('openBtn');
    b.setAttribute('href', primaryUrl); b.textContent = primaryLabel;
    var alt = document.getElementById('altLink');
    if (altUrl) { alt.setAttribute('href', altUrl); alt.textContent = altLabel; alt.className = 'link'; }
    else { alt.className = 'link hidden'; }
    document.getElementById('actions').className = '';
  }

  if (isMobile && D.hasBucket) {
    // Телефон: приложението не отваря директно отделна карта → отваряме проекта в него.
    showActions(
      D.project, 'Отвори проекта в Basecamp',
      'Приложението на телефона не отваря директно отделна карта — тапни, за да влезеш в проекта, картата е вътре.',
      D.web, 'Или отвори картата в браузър'
    );
  } else if (isMobile) {
    showActions(D.web, 'Отвори в Basecamp', 'Тапни, за да отвориш в Basecamp.');
  } else {
    // Десктоп: направо към точната карта (тъмна тема, активна сесия).
    window.location.replace(D.web);
    setTimeout(function () {
      showActions(D.web, 'Отвори задачата в Basecamp', 'Ако не се пренасочиш автоматично, натисни бутона.');
    }, 1500);
  }
})();
</script>
<noscript>
  <div class="box">
    <a class="btn primary" href="${escHtml(webUrl)}">Отвори в Basecamp</a>
  </div>
</noscript>
</body>
</html>`);
});

module.exports = router;
