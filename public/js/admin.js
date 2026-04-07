// ==================== ADMIN PANEL + SETTINGS + TEST BUTTONS ====================
async function renderAdmin(el) {
  if (currentUser?.role !== 'admin') { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--red)">Нямаш достъп до тази страница.</div>'; return; }
  setBreadcrumb(null); el.className = '';
  try {
    const users = await (await fetch('/api/users')).json();
    el.innerHTML = `
      <div style="max-width:900px;margin:0 auto">
        <div class="page-header">
          <h1>⚙️ Админ панел</h1>
        </div>

        <div style="display:flex;gap:8px;justify-content:center;margin-bottom:24px;flex-wrap:wrap">
          <button class="btn btn-sm admin-tab active" onclick="showAdminTab('users',this)">👤 Потребители</button>
          <button class="btn btn-sm admin-tab" onclick="showAdminTab('boards',this)">📋 Бордове</button>
          <button class="btn btn-sm admin-tab" onclick="showAdminTab('settings',this)">⚙️ Настройки</button>
          <button class="btn btn-sm admin-tab" onclick="showAdminTab('colors',this)">🎨 Персонализация</button>
          <button class="btn btn-sm admin-tab" onclick="showAdminTab('logic',this)">📖 Логика</button>
        </div>

        <div id="adminContent">
          <div id="adminUsers">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
              <h2 style="font-size:16px;font-weight:700;color:#fff">Потребители (${users.length})</h2>
              <button class="btn btn-primary btn-sm" onclick="createNewUser()">+ Нов потребител</button>
            </div>
            <table class="admin-table">
              <thead><tr><th>Име</th><th>Email</th><th>Роля</th><th>Статус</th><th>Действия</th></tr></thead>
              <tbody>
                ${users.map(u => `<tr>
                  <td><strong>${esc(u.name)}</strong></td>
                  <td style="color:var(--text-dim)">${esc(u.email)}</td>
                  <td><select class="input-sm" onchange="changeUserRole(${u.id},this.value)" style="padding:2px 6px;font-size:11px">
                    <option value="member" ${u.role==='member'?'selected':''}>Член</option>
                    <option value="moderator" ${u.role==='moderator'?'selected':''}>Модератор</option>
                    <option value="admin" ${u.role==='admin'?'selected':''}>Админ</option>
                  </select></td>
                  <td>${u.is_active ? '<span style="color:var(--green)">●</span> Активен' : '<span style="color:var(--red)">●</span> Неактивен'}</td>
                  <td><button class="btn btn-sm" onclick="toggleUserActive(${u.id},${!u.is_active})">${u.is_active ? 'Деактивирай' : 'Активирай'}</button></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div id="adminBoards" style="display:none">
            <h2 style="font-size:16px;font-weight:700;color:#fff;margin-bottom:16px">Бордове</h2>
            <div class="task-list">
              ${allBoards.map(b => `<div class="task-row"><span class="task-title">${esc(b.title)}</span><span class="task-meta">${b.columns?.length || 0} колони</span></div>`).join('')}
            </div>
          </div>
          <div id="adminSettings" style="display:none">
            <h2 style="font-size:16px;font-weight:700;color:#fff;margin-bottom:20px">Настройки на системата</h2>
            <div id="adminSettingsContent" style="color:var(--text-dim);text-align:center;padding:40px">Зареждане...</div>
          </div>
          <div id="adminColors" style="display:none">
            <h2 style="font-size:16px;font-weight:700;color:#fff;margin-bottom:20px">Персонализация на интерфейса</h2>
            <div id="adminColorsContent" style="color:var(--text-dim);text-align:center;padding:40px">Зареждане...</div>
          </div>
          <div id="adminLogic" style="display:none">
            <div id="adminLogicContent" style="color:var(--text-dim);text-align:center;padding:40px">Зареждане...</div>
          </div>
        </div>
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
function showAdminTab(tab, btn) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  btn?.classList.add('active');
  ['Users','Boards','Settings','Colors','Logic'].forEach(t => {
    const el = document.getElementById('admin'+t);
    if (el) el.style.display = t.toLowerCase() === tab ? 'block' : 'none';
  });
  if (tab === 'settings') loadAdminSettings();
  if (tab === 'colors') loadAdminColors();
  if (tab === 'logic') loadAdminLogic();
}
function createNewUser() {
  var ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = '<div class="confirm-modal-box"><p class="confirm-modal-msg">\u041d\u043e\u0432 \u043f\u043e\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043b</p>' +
    '<input class="confirm-modal-input" id="nuName" placeholder="\u0418\u043c\u0435\u2026">' +
    '<input class="confirm-modal-input" type="email" id="nuEmail" placeholder="\u0418\u043c\u0435\u0439\u043b\u2026">' +
    '<input class="confirm-modal-input" type="password" id="nuPass" placeholder="\u041f\u0430\u0440\u043e\u043b\u0430\u2026">' +
    '<div class="confirm-modal-actions"><button class="btn btn-primary" id="nuOk">\u0421\u044a\u0437\u0434\u0430\u0439</button><button class="btn btn-ghost" id="nuCancel">\u041e\u0442\u043a\u0430\u0437</button></div></div>';
  document.body.appendChild(ov);
  setTimeout(function(){ ov.querySelector('#nuName').focus(); }, 50);
  ov.querySelector('#nuOk').onclick = async function() {
    var name = ov.querySelector('#nuName').value.trim(); if (!name) { ov.querySelector('#nuName').focus(); return; }
    var email = ov.querySelector('#nuEmail').value.trim(); if (!email) { ov.querySelector('#nuEmail').focus(); return; }
    var password = ov.querySelector('#nuPass').value; if (!password) { ov.querySelector('#nuPass').focus(); return; }
    ov.remove();
    try { await fetch('/api/users', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password})}); showToast('\u041f\u043e\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043b\u044f\u0442 \u0435 \u0441\u044a\u0437\u0434\u0430\u0434\u0435\u043d', 'success'); router(); } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0441\u044a\u0437\u0434\u0430\u0432\u0430\u043d\u0435 \u043d\u0430 \u043f\u043e\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043b', 'error'); }
  };
  ov.querySelector('#nuCancel').onclick = function() { ov.remove(); };
  ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
  ov.querySelector('#nuName').onkeydown = function(e) { if (e.key === 'Escape') ov.remove(); };
}
async function changeUserRole(userId, role) {
  try { await fetch(`/api/users/${userId}/role`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})}); } catch {}
}
async function toggleUserActive(userId, active) {
  try { await fetch(`/api/users/${userId}/active`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_active:active})}); router(); } catch {}
}

// ==================== ADMIN LOGIC ====================
async function loadAdminLogic() {
  var el = document.getElementById('adminLogicContent');
  if (!el) return;
  try {
    var settingsRes = await fetch('/api/settings');
    var s = (await settingsRes.json()).settings || {};

    el.innerHTML = '' +
      '<div style="text-align:left">' +

      // Section 1: Board-Date Mapping
      '<div class="admin-settings-section">' +
        '<h3>📋 Борд → Дата (коя дата е важна за всеки борд)</h3>' +
        '<p style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:14px">' +
          'Всяка карта може да има няколко дати: <strong>Краен срок (due_on)</strong>, <strong>Дата за измисляне (brainstorm_date)</strong>, ' +
          '<strong>Заснемане (filming_date)</strong>, <strong>Монтаж (editing_date)</strong>, <strong>Качване (upload_date)</strong>. ' +
          'За всеки борд има една "водеща" production дата, която определя дали картата е просрочена в контекста на този борд.' +
        '</p>' +
        '<table class="admin-table" style="margin-bottom:10px"><thead><tr><th>Борд (ключова дума)</th><th>Production дата</th><th>Обяснение</th></tr></thead><tbody>' +
          '<tr><td><input class="input-sm" style="width:120px" value="' + esc(s.board_keyword_pre || 'pre') + '" onblur="saveSetting(\'board_keyword_pre\',this.value)"></td>' +
            '<td><strong style="color:var(--accent)">brainstorm_date</strong></td>' +
            '<td style="font-size:11px;color:var(--text-dim)">Pre-Production — измисляне</td></tr>' +
          '<tr><td><input class="input-sm" style="width:120px" value="' + esc(s.board_keyword_production || 'production') + '" onblur="saveSetting(\'board_keyword_production\',this.value)"></td>' +
            '<td><strong style="color:var(--accent)">filming_date</strong></td>' +
            '<td style="font-size:11px;color:var(--text-dim)">Production — заснемане</td></tr>' +
          '<tr><td><input class="input-sm" style="width:120px" value="' + esc(s.board_keyword_post || 'post') + '" onblur="saveSetting(\'board_keyword_post\',this.value)"></td>' +
            '<td><strong style="color:var(--accent)">editing_date</strong></td>' +
            '<td style="font-size:11px;color:var(--text-dim)">Post-Production — монтаж</td></tr>' +
          '<tr><td><input class="input-sm" style="width:120px" value="' + esc(s.board_keyword_account || 'акаунт') + '" onblur="saveSetting(\'board_keyword_account\',this.value)"></td>' +
            '<td><strong style="color:var(--accent)">upload_date</strong></td>' +
            '<td style="font-size:11px;color:var(--text-dim)">Акаунт — качване</td></tr>' +
        '</tbody></table>' +
        '<p style="font-size:11px;color:var(--text-dim);line-height:1.5">' +
          'Системата проверява дали името на борда <strong>съдържа</strong> ключовата дума (case-insensitive). ' +
          'За бордове, които не съвпадат с нито една дума — се ползва само <strong>due_on</strong>.' +
        '</p>' +
      '</div>' +

      // Section 2: Overdue Logic
      '<div class="admin-settings-section">' +
        '<h3>🔴 Логика за "Просрочени" (Home + Dashboard)</h3>' +
        '<p style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:14px">' +
          'Карта се счита за <strong>просрочена</strong> когато КОЯТО И ДА Е от приложимите дати е преди днешната дата. ' +
          'На началната страница се проверяват <strong>и due_on, и production датата</strong> на борда. ' +
          'Ако карта има due_on = 5 април и filming_date = 10 април, тя ще е просрочена от 6 април заради due_on.' +
        '</p>' +
        '<div class="admin-setting-row">' +
          '<label>due_on влияе на просрочени</label>' +
          '<label class="toggle-switch">' +
            '<input type="checkbox" ' + (s.overdue_checks_due_on !== 'false' ? 'checked' : '') + ' onchange="saveSetting(\'overdue_checks_due_on\',this.checked?\'true\':\'false\')">' +
            '<span class="toggle-track"></span>' +
          '</label>' +
          '<span style="font-size:11px;color:var(--text-dim)">Ако е изключено, само production датата на борда се проверява</span>' +
        '</div>' +
      '</div>' +

      // Section 3: Timer Logic
      '<div class="admin-settings-section">' +
        '<h3>⏱ Таймер логика (Dashboard)</h3>' +
        '<p style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:14px">' +
          'Всеки борд в Dashboard има таймер, който брои колко време няма просрочени задачи. ' +
          'Когато се появи просрочена задача, таймерът спира и показва "<span style="color:var(--red)">Просрочена задача</span>". ' +
          'Когато всички просрочени задачи се решат (преместят, завършат), таймерът тръгва отново.' +
        '</p>' +
        '<div class="admin-setting-row">' +
          '<label>due_on спира таймера</label>' +
          '<label class="toggle-switch">' +
            '<input type="checkbox" ' + (s.timer_checks_due_on === 'true' ? 'checked' : '') + ' onchange="saveSetting(\'timer_checks_due_on\',this.checked?\'true\':\'false\');_platformConfig.timer_checks_due_on=this.checked?\'true\':\'false\'">' +
            '<span class="toggle-track"></span>' +
          '</label>' +
          '<span style="font-size:11px;color:var(--text-dim)">По подразбиране: <strong>ИЗКЛ</strong> — таймерът реагира САМО на production дати (filming, brainstorm, editing, upload)</span>' +
        '</div>' +
        '<div style="margin-top:8px;padding:10px 12px;background:rgba(28,176,246,0.06);border:1px solid rgba(28,176,246,0.15);border-radius:8px;font-size:11px;color:var(--text-secondary);line-height:1.7">' +
          '<strong>Примери:</strong><br>' +
          '• Карта в Production с <strong>filming_date = 3 април</strong> (минала) → таймерът СПИРА<br>' +
          '• Карта в Production с <strong>due_on = 3 април</strong>, без filming_date → таймерът <strong>НЕ СПИРА</strong> (ако toggle е ИЗКЛ)<br>' +
          '• Карта в Pre-Production с <strong>brainstorm_date = 1 април</strong> (минала) → таймерът СПИРА<br>' +
          '• Карта е <strong>на изчакване (on hold)</strong> → НЕ влияе на таймера' +
        '</div>' +
      '</div>' +

      // Section 4: Deadline Colors
      '<div class="admin-settings-section">' +
        '<h3>🎨 Цветове на крайни срокове</h3>' +
        '<p style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:14px">' +
          'Картите в Dashboard и Kanban се оцветяват според оставащите дни до най-близкия крайен срок. ' +
          'Проверява се <strong>най-ранната</strong> дата от всички приложими (due_on + production дата на борда).' +
        '</p>' +
        '<table class="admin-table" style="margin-bottom:10px"><thead><tr><th>Цвят</th><th>Условие</th></tr></thead><tbody>' +
          '<tr><td><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:#111;border:1px solid #444;vertical-align:middle"></span> Черно</td><td>Просрочена (дни &lt; 0)</td></tr>' +
          '<tr><td><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:var(--red);vertical-align:middle"></span> Червено</td><td>Краен срок е ДНЕС (0 дни)</td></tr>' +
          '<tr><td><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:var(--yellow);vertical-align:middle"></span> Жълто</td><td>Наближава — до <input class="input-sm" type="number" min="1" max="30" style="width:50px;display:inline" value="' + esc(s.deadline_soon_days || '3') + '" onblur="saveSetting(\'deadline_soon_days\',this.value);_platformConfig.deadline_soon_days=this.value"> дни</td></tr>' +
          '<tr><td><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:var(--green);vertical-align:middle"></span> Зелено</td><td>Има време (повече дни)</td></tr>' +
        '</tbody></table>' +
      '</div>' +

      // Section 5: Dashboard
      '<div class="admin-settings-section">' +
        '<h3>📊 Dashboard настройки</h3>' +
        '<div class="admin-setting-row">' +
          '<label>Auto-refresh интервал</label>' +
          '<input class="input-sm" type="number" min="10" max="300" style="width:60px" value="' + esc(s.auto_refresh_seconds || '30') + '" onblur="saveSetting(\'auto_refresh_seconds\',this.value);_platformConfig.auto_refresh_seconds=this.value">' +
          '<span style="font-size:11px;color:var(--text-dim)">секунди (Dashboard се обновява автоматично за studio screen режим)</span>' +
        '</div>' +
        '<div class="admin-setting-row">' +
          '<label>Таймер на секундите</label>' +
          '<span style="color:#fff;font-weight:600">1 сек</span>' +
          '<span style="font-size:11px;color:var(--text-dim)">Таймерът в Dashboard тиктака на всяка секунда (не е променимо)</span>' +
        '</div>' +
      '</div>' +

      // Section 6: Success Rate
      '<div class="admin-settings-section">' +
        '<h3>🏆 Успеваемост (Home)</h3>' +
        '<p style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:14px">' +
          'Показва процента на завършените карти, които са приключени <strong>преди или на крайния им срок</strong>. ' +
          'Изчислява се за последните N дни. Ако карта няма краен срок — счита се за "навреме".' +
        '</p>' +
        '<div class="admin-setting-row">' +
          '<label>Период за изчисление</label>' +
          '<input class="input-sm" type="number" min="7" max="365" style="width:60px" value="' + esc(s.success_rate_days || '90') + '" onblur="saveSetting(\'success_rate_days\',this.value);_platformConfig.success_rate_days=this.value">' +
          '<span style="font-size:11px;color:var(--text-dim)">дни назад</span>' +
        '</div>' +
        '<table class="admin-table"><thead><tr><th>Цвят</th><th>Условие</th></tr></thead><tbody>' +
          '<tr><td><span style="color:var(--green);font-weight:700">Зелено</span></td><td>≥ 80%</td></tr>' +
          '<tr><td><span style="color:#fff;font-weight:700">Бяло</span></td><td>50% – 79%</td></tr>' +
          '<tr><td><span style="color:var(--red);font-weight:700">Червено</span></td><td>&lt; 50%</td></tr>' +
        '</tbody></table>' +
      '</div>' +

      // Section 7: KP Cards
      '<div class="admin-settings-section">' +
        '<h3>📦 КП Карти (Content Plan)</h3>' +
        '<p style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:14px">' +
          'КП (Контент План) картите се разпознават по regex pattern в заглавието. ' +
          'Те имат специална логика за deadline-и и автоматично генериране на видео задачи.' +
        '</p>' +
        '<div class="admin-setting-row">' +
          '<label>KP regex pattern</label>' +
          '<input class="input-sm" type="text" style="width:140px" value="' + esc(s.kp_card_pattern || 'КП-\\d') + '" onblur="saveSetting(\'kp_card_pattern\',this.value);_platformConfig.kp_card_pattern=this.value">' +
          '<span style="font-size:11px;color:var(--text-dim)">Regex за разпознаване на КП карти по заглавие</span>' +
        '</div>' +
      '</div>' +

      // Section 8: Home Page Stats
      '<div class="admin-settings-section">' +
        '<h3>🏠 Начална страница — статистика</h3>' +
        '<p style="font-size:12px;color:var(--text-secondary);line-height:1.6">' +
          'Статистиката горе показва 5 метрики. Всяка е кликабилна и отваря филтриран списък:' +
        '</p>' +
        '<table class="admin-table"><thead><tr><th>Метрика</th><th>Логика</th></tr></thead><tbody>' +
          '<tr><td><strong>Активни задачи</strong></td><td style="font-size:11px">Всички карти без completed_at и archived_at</td></tr>' +
          '<tr><td><strong>Краен срок днес</strong></td><td style="font-size:11px">Карти с НЯКОЯ приложима дата = днес (due_on или production дата)</td></tr>' +
          '<tr><td><strong>Просрочени</strong></td><td style="font-size:11px">Карти с НЯКОЯ приложима дата &lt; днес, не са on hold</td></tr>' +
          '<tr><td><strong>Завършени тази седмица</strong></td><td style="font-size:11px">Карти с completed_at ≥ понеделник на текущата седмица</td></tr>' +
          '<tr><td><strong>Успеваемост</strong></td><td style="font-size:11px">% завършени навреме за последните N дни (виж горе)</td></tr>' +
        '</tbody></table>' +
      '</div>' +

      // Section 9: WebSocket
      '<div class="admin-settings-section">' +
        '<h3>🔌 Real-time (WebSocket)</h3>' +
        '<p style="font-size:12px;color:var(--text-secondary);line-height:1.6">' +
          'Платформата използва WebSocket за мигновени обновявания. Когато някой премести карта, добави коментар ' +
          'или промени нещо — всички отворени табове се обновяват автоматично без refresh. ' +
          'Dashboard допълнително има auto-refresh на всеки ' + (s.auto_refresh_seconds || '30') + ' секунди за studio screen режим.' +
        '</p>' +
      '</div>' +

      '</div>';
  } catch (e) { el.innerHTML = '<div style="color:var(--red)">Грешка при зареждане на логиката</div>'; }
}

// ==================== ADMIN SETTINGS ====================
async function loadAdminSettings() {
  const el = document.getElementById('adminSettingsContent');
  if (!el) return;
  try {
    const [settingsRes, roomsRes, boardsRes] = await Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/campfire/rooms').then(r => r.json()),
      fetch('/api/boards').then(r => r.json())
    ]);
    const s = settingsRes.settings || {};
    const rooms = Array.isArray(roomsRes) ? roomsRes : [];
    const boardsList = Array.isArray(boardsRes) ? boardsRes : [];
    const allCols = boardsList.flatMap(b => (b.columns || []).map(c => ({ ...c, board_title: b.title })));
    const colOpts = (settingKey) => `<option value="">— изберете колона —</option>` +
      allCols.map(c => `<option value="${c.id}" ${String(s[settingKey]) === String(c.id) ? 'selected' : ''}>${esc(c.board_title)} → ${esc(c.title)}</option>`).join('');
    const roomOpts = rooms.map(r => `<option value="${r.id}" ${String(s.daily_report_room_id) === String(r.id) ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
    const reportEnabled = s.daily_report_enabled !== 'false';

    el.innerHTML = `
      <div class="admin-settings-section">
        <h3>📊 Дневен отчет <span class="info-tooltip" title="Автоматично публикува сутрешен отчет в Campfire — задачи за деня, публикации и просрочени.">ⓘ</span></h3>
        <div class="admin-setting-row">
          <label>Активен</label>
          <label class="toggle-switch">
            <input type="checkbox" ${reportEnabled ? 'checked' : ''} onchange="saveSetting('daily_report_enabled', this.checked ? 'true' : 'false')">
            <span class="toggle-track"></span>
          </label>
          <span style="font-size:11px;color:var(--text-dim)">${reportEnabled ? 'включен' : 'изключен'}</span>
        </div>
        <div class="admin-setting-row">
          <label>Campfire канал</label>
          <select class="input-sm" onchange="saveSetting('daily_report_room_id', this.value)">${roomOpts || '<option>Няма канали</option>'}</select>
        </div>
        <div class="admin-setting-row">
          <label>Час (cron израз)</label>
          <input class="input-sm" type="text" value="${esc(s.daily_report_cron || '30 9 * * 1-5')}"
                 style="width:140px" placeholder="30 9 * * 1-5"
                 onblur="saveSetting('daily_report_cron', this.value)">
          <span style="font-size:11px;color:var(--text-dim)">Пн–Пт 9:30</span>
        </div>
        <div class="admin-setting-row">
          <label>Ръчен тест</label>
          <button class="btn btn-sm" onclick="testDailyReport(this)">📤 Изпрати сега</button>
          <span style="font-size:11px;color:var(--text-dim)">Изпраща незабавно в избрания канал</span>
        </div>
      </div>

      <div class="admin-settings-section">
        <h3>💬 Коментари</h3>
        <div class="admin-setting-row">
          <label>Прозорец за редакция</label>
          <input class="input-sm" type="number" min="0" max="1440" style="width:70px"
                 value="${esc(s.comment_edit_window_minutes || '10')}"
                 onblur="saveSetting('comment_edit_window_minutes', this.value)">
          <span style="font-size:11px;color:var(--text-dim)">минути след изпращане</span>
        </div>
      </div>

      <div class="admin-settings-section">
        <h3>🤖 КП Автоматизация <span class="info-tooltip" title="Настройки за автоматично генериране на видео задачи от КП карти.">ⓘ</span></h3>
        <div class="admin-setting-row">
          <label>Колона "Измисляне"</label>
          <select class="input-sm" style="max-width:280px" onchange="saveSetting('kp_izmislyane_column_id', this.value)">${colOpts('kp_izmislyane_column_id')}</select>
          <span style="font-size:11px;color:var(--text-dim)">тук се пускат КП картите</span>
        </div>
        <div class="admin-setting-row">
          <label>Колона "Разпределение"</label>
          <select class="input-sm" style="max-width:280px" onchange="saveSetting('kp_razpredelenie_column_id', this.value)">${colOpts('kp_razpredelenie_column_id')}</select>
          <span style="font-size:11px;color:var(--text-dim)">тук отиват видео задачите</span>
        </div>
        <div class="admin-setting-row">
          <label>Стъпки за видео карта</label>
          <span style="color:#fff;font-weight:600">5</span>
          <span style="font-size:11px;color:var(--text-dim)">Видеограф → Монтажист → Акаунт → Корекции → Качване</span>
        </div>
        <div class="admin-setting-row">
          <label>Календарен прозорец</label>
          <input class="input-sm" type="number" min="7" max="90" style="width:60px"
                 value="${esc(s.kp_calendar_window || '30')}"
                 onblur="saveSetting('kp_calendar_window', this.value)">
          <span style="font-size:11px;color:var(--text-dim)">календарни дни за разпределение на видеата</span>
        </div>
        <div class="admin-setting-row">
          <label>Дни преди следващ КП</label>
          <input class="input-sm" type="number" min="1" max="30" style="width:60px"
                 value="${esc(s.kp_days_before_next_kp || '15')}"
                 onblur="saveSetting('kp_days_before_next_kp', this.value)">
          <span style="font-size:11px;color:var(--text-dim)">работни дни преди първото видео → автоматично създаване на КП карта</span>
        </div>
      </div>

      <div class="admin-settings-section">
        <h3>📆 КП Дати (работни дни преди публикуване) <span class="info-tooltip" title="Колко работни дни преди датата за публикуване да се зададат автоматично production датите за нови видео карти.">ⓘ</span></h3>
        <div class="admin-setting-row">
          <label>Измисляне</label>
          <input class="input-sm" type="number" min="0" max="60" style="width:60px"
                 value="${esc(s.kp_days_brainstorm || '10')}"
                 onblur="saveSetting('kp_days_brainstorm', this.value)">
          <span style="font-size:11px;color:var(--text-dim)">работни дни</span>
        </div>
        <div class="admin-setting-row">
          <label>Заснемане</label>
          <input class="input-sm" type="number" min="0" max="60" style="width:60px"
                 value="${esc(s.kp_days_filming || '7')}"
                 onblur="saveSetting('kp_days_filming', this.value)">
          <span style="font-size:11px;color:var(--text-dim)">работни дни</span>
        </div>
        <div class="admin-setting-row">
          <label>Монтаж</label>
          <input class="input-sm" type="number" min="0" max="60" style="width:60px"
                 value="${esc(s.kp_days_editing || '5')}"
                 onblur="saveSetting('kp_days_editing', this.value)">
          <span style="font-size:11px;color:var(--text-dim)">работни дни</span>
        </div>
        <div class="admin-setting-row">
          <label>Качване</label>
          <input class="input-sm" type="number" min="0" max="60" style="width:60px"
                 value="${esc(s.kp_days_upload || '1')}"
                 onblur="saveSetting('kp_days_upload', this.value)">
          <span style="font-size:11px;color:var(--text-dim)">работни дни</span>
        </div>
        <div style="margin-top:6px;font-size:11px;color:var(--text-dim);line-height:1.5">
          Пример: ако Публикуване е на 20-ти и Заснемане = 7 → filming_date ще бъде 7 работни дни преди 20-ти.
          <br>Промените важат само за <strong>нови</strong> видео карти.
        </div>
      </div>

      <div class="admin-settings-section">
        <h3>📅 Google Calendar <span class="info-tooltip" title="Синхронизира събитията от Календар → Google Calendar. Нужен е Service Account.">ⓘ</span></h3>
        <div class="admin-setting-row">
          <label>Активен</label>
          <label class="toggle-switch">
            <input type="checkbox" ${s.google_calendar_enabled === 'true' ? 'checked' : ''} onchange="saveSetting('google_calendar_enabled', this.checked ? 'true' : 'false')">
            <span class="toggle-track"></span>
          </label>
          <span style="font-size:11px;color:var(--text-dim)">${s.google_calendar_enabled === 'true' ? 'синхронизация включена' : 'изключено'}</span>
        </div>
        <div class="admin-setting-row">
          <label>Calendar ID</label>
          <input class="input-sm" type="text" value="${esc(s.google_calendar_id || '')}"
                 style="width:320px" placeholder="xxxxx@group.calendar.google.com"
                 onblur="saveSetting('google_calendar_id', this.value)">
        </div>
        <div class="admin-setting-row">
          <label>Тест</label>
          <button class="btn btn-sm" onclick="testGoogleCalendar(this)">🔗 Тествай връзката</button>
          <span style="font-size:11px;color:var(--text-dim)">Проверява дали credentials-а работи</span>
        </div>
        <div style="margin-top:8px;padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:8px;font-size:11px;color:var(--text-dim);line-height:1.5">
          <strong style="color:var(--text-secondary)">Настройка:</strong><br>
          1. Google Cloud Console → Enable "Google Calendar API"<br>
          2. Create Service Account → Download JSON key<br>
          3. Качете файла като <code>google-credentials.json</code> в root папката на сървъра<br>
          4. Споделете Google Calendar-а с email-а на service account-а (Make changes to events)<br>
          5. Копирайте Calendar ID тук (Settings → Integrate calendar)
        </div>
      </div>`;
  } catch(e) {
    el.innerHTML = '<div style="color:var(--red);padding:20px">Грешка при зареждане: ' + esc(e.message) + '</div>';
  }
}

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

