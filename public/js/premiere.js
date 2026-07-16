// ==================== PREMIERE PRO DOWNGRADE ====================
// Сваля .prproj проект към по-стара версия на Premiere. От PP2026 нагоре само
// смяната на номера не стига (Adobe смени структурата на файла), затова истинската
// конверсия минава през специализиран схема-енджин — но всичко през нашия сървър
// (thepact.pro). Безплатно за файлове под 100 KB. Файлът се обработва временно.
var _pp = { file: null, currentVersion: null, busy: false };

// Вътрешен Version номер → приблизителна година (само за показване на текущата).
function ppVersionLabel(v) {
  var map = { 38: '2020', 39: '2021', 40: '2022', 41: '2023', 42: '2024', 43: '2025', 44: '2025', 45: '2026' };
  if (map[v]) return 'Premiere ' + map[v];
  if (v >= 46) return 'Premiere 2026+';
  if (v <= 37) return 'стара (CC/CS)';
  return null;
}

async function renderPremiere(el) {
  setBreadcrumb([{ label: 'Premiere Downgrade', href: '#/premiere' }]);
  el.className = 'flush-top';

  var years = ['2025', '2024', '2023', '2022', '2021', '2020', '2019'];
  var yearOptions = years.map(function (y, i) {
    return '<option value="' + y + '"' + (i === 0 ? ' selected' : '') + '>Premiere ' + y + '</option>';
  }).join('');

  el.innerHTML = `
    <div class="home-content-box">
      <div class="page-header" style="margin-bottom:20px">
        <h1>🎬 Premiere Pro Downgrade</h1>
        <div class="page-subtitle">Отвори проект (<code>.prproj</code>), запазен в по-нова версия на Premiere Pro, в по-стара — включително сваляне от 2026. Истинската конверсия се прави от специализиран енджин, но всичко минава през нашия сървър. Монтажът и секвенциите се пренасят; много нови ефекти може да изискват донастройка (напр. Lumetri look).</div>
      </div>

      <div id="ppDrop" style="border:2px dashed var(--border);border-radius:14px;padding:34px 20px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s;background:var(--bg)">
        <div style="font-size:38px;line-height:1;margin-bottom:10px">📁</div>
        <div id="ppDropLabel" style="font-size:15px;color:var(--text);font-weight:600;margin-bottom:4px">Пусни тук .prproj файл или кликни за избор</div>
        <div style="font-size:12.5px;color:var(--text-dim)">Файлът се обработва временно и не се запазва. Безплатно за файлове под 100 KB.</div>
        <input type="file" id="ppFile" accept=".prproj" style="display:none">
      </div>

      <div id="ppInfo" style="display:none;margin-top:16px;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:16px 18px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
          <div style="font-size:22px">🎬</div>
          <div style="flex:1;min-width:180px">
            <div id="ppFileName" style="font-size:14.5px;color:var(--text);font-weight:600;word-break:break-all"></div>
            <div id="ppFileMeta" style="font-size:12.5px;color:var(--text-dim);margin-top:2px"></div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="ppReset()" style="color:var(--red)">✕ Друг файл</button>
        </div>

        <div style="border-top:1px solid var(--border);padding-top:14px">
          <label style="display:block;font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Към коя версия на Premiere</label>
          <select id="ppTarget" style="width:100%;max-width:420px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:14px;outline:none">
            ${yearOptions}
          </select>
        </div>

        <div style="margin-top:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <button id="ppConvertBtn" class="btn btn-primary" onclick="ppConvert()" style="font-weight:600;padding:11px 20px">⬇️ Свали сваления проект</button>
          <div id="ppStatus" style="font-size:13px;color:var(--text-dim)"></div>
        </div>

        <div id="ppLogs" style="display:none;margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
          <div style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Отчет от конверсията</div>
          <div id="ppLogsBody" style="font-size:12.5px;line-height:1.55;color:var(--text-dim)"></div>
        </div>
      </div>
    </div>
  `;

  var drop = document.getElementById('ppDrop');
  var input = document.getElementById('ppFile');
  drop.addEventListener('click', function () { input.click(); });
  input.addEventListener('change', function () { if (input.files && input.files[0]) ppOnFile(input.files[0]); });

  drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.style.borderColor = 'var(--accent,#46a374)'; drop.style.background = 'rgba(70,163,116,0.06)'; });
  drop.addEventListener('dragleave', function () { drop.style.borderColor = ''; drop.style.background = ''; });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    drop.style.borderColor = ''; drop.style.background = '';
    if (e.dataTransfer.files && e.dataTransfer.files[0]) ppOnFile(e.dataTransfer.files[0]);
  });
}

function ppFmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function ppOnFile(file) {
  if (!/\.prproj$/i.test(file.name)) {
    if (typeof showToast === 'function') showToast('Трябва .prproj файл.', 'error');
    return;
  }
  _pp.file = file;
  _pp.currentVersion = null;
  document.getElementById('ppInfo').style.display = 'block';
  document.getElementById('ppFileName').textContent = file.name;
  document.getElementById('ppFileMeta').textContent = ppFmtSize(file.size) + ' · проверка на версията…';
  document.getElementById('ppStatus').textContent = '';
  document.getElementById('ppLogs').style.display = 'none';

  var sizeNote = file.size > 100 * 1024 ? ' · ⚠️ над 100 KB — безплатната конверсия е до 100 KB' : '';
  try {
    var fd = new FormData();
    fd.append('project', file, file.name);
    var resp = await fetch('/api/premiere/inspect', { method: 'POST', body: fd });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
    _pp.currentVersion = data.version;
    var label = ppVersionLabel(data.version);
    document.getElementById('ppFileMeta').textContent =
      ppFmtSize(file.size) + ' · текуща версия: ' + data.version + (label ? ' (' + label + ')' : '') + sizeNote;
  } catch (err) {
    document.getElementById('ppFileMeta').textContent = ppFmtSize(file.size) + ' · ' + err.message + sizeNote;
    if (typeof showToast === 'function') showToast('Внимание: ' + err.message, 'error');
  }
}

function ppReset() {
  _pp.file = null;
  _pp.currentVersion = null;
  document.getElementById('ppInfo').style.display = 'none';
  var input = document.getElementById('ppFile');
  if (input) input.value = '';
}

function ppRenderLogs(logs) {
  var box = document.getElementById('ppLogs');
  var body = document.getElementById('ppLogsBody');
  if (!logs || !logs.length) { box.style.display = 'none'; return; }
  var icon = { ok: '✅', warn: '⚠️', info: '•', err: '❌' };
  body.innerHTML = logs.map(function (l) {
    var color = l.t === 'warn' ? 'var(--gold,#d4a24b)' : (l.t === 'err' ? 'var(--red)' : (l.t === 'ok' ? 'var(--green,#46a374)' : 'var(--text-dim)'));
    return '<div style="color:' + color + '">' + (icon[l.t] || '•') + ' ' + esc(String(l.m || '')) + '</div>';
  }).join('');
  box.style.display = 'block';
}

async function ppConvert() {
  if (_pp.busy) return;
  if (!_pp.file) { if (typeof showToast === 'function') showToast('Първо избери .prproj файл.', 'error'); return; }
  var target = document.getElementById('ppTarget').value;
  var btn = document.getElementById('ppConvertBtn');
  var status = document.getElementById('ppStatus');

  _pp.busy = true;
  var origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Конвертиране…';
  status.textContent = '';
  status.style.color = '';
  document.getElementById('ppLogs').style.display = 'none';

  try {
    var fd = new FormData();
    fd.append('project', _pp.file, _pp.file.name);
    fd.append('target', target);
    var resp = await fetch('/api/premiere/convert', { method: 'POST', body: fd });
    var data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || ('HTTP ' + resp.status));

    // Decode base64 → blob → download.
    var bin = atob(data.data);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var blob = new Blob([bytes], { type: 'application/octet-stream' });
    var outName = data.name || (_pp.file.name.replace(/\.prproj$/i, '') + '_PP' + target + '.prproj');
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = outName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);

    ppRenderLogs(data.logs);
    status.textContent = 'Готово · свален като ' + outName + ' (Premiere ' + target + ')';
    status.style.color = 'var(--green,#46a374)';
    if (typeof showToast === 'function') showToast('Проектът е свален и изтеглен.', 'success');
  } catch (err) {
    status.textContent = 'Грешка: ' + err.message;
    status.style.color = 'var(--red)';
    if (typeof showToast === 'function') showToast('Грешка: ' + err.message, 'error');
  } finally {
    _pp.busy = false;
    btn.disabled = false;
    btn.textContent = origLabel;
  }
}
