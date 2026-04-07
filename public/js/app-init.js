// ==================== APP INIT (runs LAST) ====================
function showShortcutsHelp() {
  const existing = document.getElementById('shortcutsModal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'shortcutsModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:28px;max-width:480px;width:90%">
      <h2 style="font-size:18px;font-weight:800;color:#fff;margin-bottom:16px">⌨️ Клавишни комбинации</h2>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:13px">
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">Ctrl+J</kbd><span style="color:var(--text-secondary)">Бързо търсене</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">?</kbd><span style="color:var(--text-secondary)">Тази помощ</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">N</kbd><span style="color:var(--text-secondary)">Нова карта (в борд)</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">G → H</kbd><span style="color:var(--text-secondary)">Начало</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">G → A</kbd><span style="color:var(--text-secondary)">Активност</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">G → P</kbd><span style="color:var(--text-secondary)">Пингове</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">G → C</kbd><span style="color:var(--text-secondary)">Campfire</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">G → S</kbd><span style="color:var(--text-secondary)">График</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">G → R</kbd><span style="color:var(--text-secondary)">Отчети</span>
        <kbd style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:11px;border:1px solid var(--border)">Esc</kbd><span style="color:var(--text-secondary)">Затвори</span>
      </div>
      <button class="btn btn-sm" style="margin-top:16px" onclick="this.closest('#shortcutsModal').remove()">Затвори</button>
    </div>`;
  document.body.appendChild(modal);
}

// ==================== CARD PAGE TOOLBAR ====================
// ==================== INIT ====================
(async function() {
  if (!await checkAuth()) return;
  // Load platform config
  try { const r = await fetch('/api/settings'); _platformConfig = (await r.json()).settings || {}; } catch {}
  applyThemeColors();
  if (!location.hash || location.hash === '#' || location.hash === '#/') location.hash = '#/home';
  router();
  connectWS();
  // Fetch online users
  try { const ids = await (await fetch('/api/users/online')).json(); ids.forEach(id => onlineUsers.add(id)); } catch {}
})();
