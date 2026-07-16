// ==================== PREMIERE PRO DOWNGRADE ====================
// Отваря .prproj проект, запазен в по-нова версия на Premiere, в по-стара.
// .prproj файлът е gzip-нат XML; на сървъра се сменя само Version атрибутът
// на <Project> възела и файлът се пре-архивира. Монтажът остава непокътнат.
var _pp = { file: null, currentVersion: null, busy: false };

async function renderPremiere(el) {
  setBreadcrumb([{ label: 'Premiere Downgrade', href: '#/premiere' }]);
  el.className = 'flush-top';

  el.innerHTML = `
    <div class="home-content-box">
      <div class="page-header" style="margin-bottom:20px">
        <h1>🎬 Premiere Pro Downgrade</h1>
        <div class="page-subtitle">Отвори проект (<code>.prproj</code>), запазен в по-нова версия на Premiere Pro, в по-стара. Сменя се само версията на проекта — монтажът, секвенциите и връзките към клиповете остават непокътнати. Съвсем нови ефекти/преходи в редки случаи може да не се пренесат.</div>
      </div>

      <div id="ppDrop" style="border:2px dashed var(--border);border-radius:14px;padding:34px 20px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s;background:var(--bg)">
        <div style="font-size:38px;line-height:1;margin-bottom:10px">📁</div>
        <div id="ppDropLabel" style="font-size:15px;color:var(--text);font-weight:600;margin-bottom:4px">Пусни тук .prproj файл или кликни за избор</div>
        <div style="font-size:12.5px;color:var(--text-dim)">Файлът се обработва на сървъра и не се запазва. Макс 200 MB.</div>
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
          <label style="display:block;font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Към коя версия</label>

          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin-bottom:10px">
            <input type="radio" name="ppTargetMode" value="universal" checked onchange="ppOnModeChange()" style="margin-top:3px">
            <span>
              <span style="color:var(--text);font-weight:600">Универсална съвместимост (препоръчано)</span><br>
              <span style="font-size:12.5px;color:var(--text-dim)">Проектът се отваря във <em>всяка</em> по-стара версия на Premiere (Version = 1). Това ползва и онлайн инструментът от задачата.</span>
            </span>
          </label>

          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer">
            <input type="radio" name="ppTargetMode" value="custom" onchange="ppOnModeChange()" style="margin-top:3px">
            <span style="flex:1">
              <span style="color:var(--text);font-weight:600">Конкретен номер на версия</span><br>
              <span style="font-size:12.5px;color:var(--text-dim)">За напреднали — въведи точния Version номер на проекта (напр. по-нисък от текущия).</span>
              <div style="margin-top:8px">
                <input type="number" id="ppTargetNum" min="1" max="10000" value="1" disabled
                  style="width:120px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:14px;outline:none">
              </div>
            </span>
          </label>
        </div>

        <div style="margin-top:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <button id="ppConvertBtn" class="btn btn-primary" onclick="ppConvert()" style="font-weight:600;padding:11px 20px">⬇️ Свали сваления проект</button>
          <div id="ppStatus" style="font-size:13px;color:var(--text-dim)"></div>
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

function ppOnModeChange() {
  var custom = document.querySelector('input[name="ppTargetMode"][value="custom"]').checked;
  var num = document.getElementById('ppTargetNum');
  num.disabled = !custom;
  if (custom) num.focus();
}

function ppTargetValue() {
  var custom = document.querySelector('input[name="ppTargetMode"][value="custom"]').checked;
  if (!custom) return 1;
  var v = parseInt(document.getElementById('ppTargetNum').value, 10);
  if (!Number.isInteger(v) || v < 1) v = 1;
  return v;
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

  // Detect current version so the user knows what they're downgrading from.
  try {
    var fd = new FormData();
    fd.append('project', file, file.name);
    var resp = await fetch('/api/premiere/inspect', { method: 'POST', body: fd });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
    _pp.currentVersion = data.version;
    document.getElementById('ppFileMeta').textContent = ppFmtSize(file.size) + ' · текуща версия на проекта: ' + data.version;
  } catch (err) {
    document.getElementById('ppFileMeta').textContent = ppFmtSize(file.size) + ' · ' + err.message;
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

async function ppConvert() {
  if (_pp.busy) return;
  if (!_pp.file) { if (typeof showToast === 'function') showToast('Първо избери .prproj файл.', 'error'); return; }
  var target = ppTargetValue();
  var btn = document.getElementById('ppConvertBtn');
  var status = document.getElementById('ppStatus');

  _pp.busy = true;
  var origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Обработка…';
  status.textContent = '';
  status.style.color = '';

  try {
    var fd = new FormData();
    fd.append('project', _pp.file, _pp.file.name);
    var resp = await fetch('/api/premiere/downgrade?target=' + target, { method: 'POST', body: fd });
    if (!resp.ok) {
      var errData;
      try { errData = await resp.json(); } catch (e) { errData = {}; }
      throw new Error(errData.error || ('HTTP ' + resp.status));
    }
    var blob = await resp.blob();
    var base = _pp.file.name.replace(/\.prproj$/i, '');
    var outName = base + '_v' + target + '.prproj';
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = outName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);

    var origV = resp.headers.get('X-Original-Version');
    status.textContent = 'Готово · ' + (origV ? ('версия ' + origV + ' → ' + target) : ('версия → ' + target)) + ' · свален като ' + outName;
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
