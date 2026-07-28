// ==================== ОБЩИ ПОМОЩНИЦИ ЗА НАСТРОЙКИТЕ ====================
// Старият админ панел (#/admin-legacy — „Разширени") е премахнат; всичките му живи
// настройки вече са в единния панел #/admin (settings.js, team-admin.js).
// Тук остават само нещата, които панелът ползва: записът на настройка и двата теста.

async function saveSetting(key, value) {
  try {
    const res = await fetch(`/api/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(value) })
    });
    if (!res.ok) console.error('Save setting failed:', key, value);
  } catch(e) { console.error('Save setting error:', e); }
}

async function testDailyReport(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генериране...'; }
  try {
    const res = await fetch('/api/settings/daily-report/trigger', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      if (btn) { btn.textContent = '✅ Изпратено!'; }
      setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '📤 Изпрати сега'; } }, 3000);
    } else {
      showToast('Грешка: ' + (data.error || 'Неизвестна'), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '📤 Изпрати сега'; }
    }
  } catch(e) {
    showToast('Грешка: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📤 Изпрати сега'; }
  }
}

async function testGoogleCalendar(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Тестване...'; }
  try {
    const res = await fetch('/api/settings/google-calendar/test', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      showToast('✅ Google Calendar връзката работи!', 'success');
      if (btn) { btn.textContent = '✅ Работи!'; }
    } else {
      showToast('❌ ' + (data.error || 'Неуспешно свързване'), 'error');
      if (btn) { btn.textContent = '❌ Грешка'; }
    }
    setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '🔗 Тествай връзката'; } }, 3000);
  } catch(e) {
    showToast('Грешка: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🔗 Тествай връзката'; }
  }
}
