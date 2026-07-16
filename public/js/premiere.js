// ==================== PREMIERE PRO DOWNGRADE ====================
// Отваря .prproj проект, запазен в по-нова версия на Premiere, в по-стара.
// .prproj файлът е gzip-нат XML; на сървъра се сменя само Version атрибутът
// на <Project> възела и файлът се пре-архивира. Монтажът остава непокътнат.
//
// ВАЖНО: вътрешният "Version" номер НЕ е годината. Premiere 2026 = 45,
// 2025 ≈ 43, 2022 = 40 и т.н. Затова изборът е по година, не по суров номер.
var _pp = { file: null, currentVersion: null, busy: false };

// Целева година → вътрешен базов Version номер. Ползваме базовия номер за
// годината: така файлът се отваря в тази версия И във всяка по-нова.
var PP_YEAR_TO_VERSION = [
  { year: '2025', v: 43 },
  { year: '2024', v: 42 },
  { year: '2023', v: 41 },
  { year: '2022', v: 40 },
  { year: '2021', v: 39 },
  { year: '2020', v: 38 }
];

// Вътрешен номер → приблизителна година (за показване). 44/45 са скорошни.
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

  var yearOptions = PP_YEAR_TO_VERSION.map(function (o) {
    return '<option value="' + o.v + '">Premiere ' + o.year + '</option>';
  }).join('');

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

        <div id="ppWarn2026" style="display:none;background:rgba(140,75,75,0.15);border:1px solid rgba(200,90,90,0.4);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:13px;line-height:1.55;color:var(--text)">
          <strong>⚠️ Проект от Premiere 2026 (v45+).</strong> Adobe промени структурата на самия файл в 2026 (заради новата функция Object Mask). Затова сваляне към 2025 или по-стара версия <strong>често чупи Premiere при отваряне</strong> и това НЕ може да се реши само със смяна на номера — ограничение е от Adobe, не от инструмента. Може да пробваш (за прости проекти понякога минава), но ако Premiere крашне — това е причината. Надежден вариант: от самата Premiere 2026 → <em>Export → Final Cut Pro XML</em> и импорт на XML-а в по-старата версия.
        </div>

        <div style="border-top:1px solid var(--border);padding-top:14px">
          <label style="display:block;font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Към коя версия да се свали</label>
          <select id="ppTarget" onchange="ppOnTargetChange()" style="width:100%;max-width:420px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:14px;outline:none">
            <option value="1" selected>Универсална — отваря се навсякъде (препоръчано)</option>
            ${yearOptions}
            <option value="custom">Друг номер (за напреднали)…</option>
          </select>
          <div id="ppTargetHint" style="font-size:12.5px;color:var(--text-dim);margin-top:8px">Универсална: слага Version = 1, така проектът се отваря във <em>всяка</em> по-стара Premiere. Това ползва и онлайн инструментът от задачата.</div>
          <div id="ppCustomWrap" style="display:none;margin-top:10px">
            <label style="display:block;font-size:12px;color:var(--text-secondary);margin-bottom:4px">Вътрешен Version номер <strong>(това НЕ е годината!)</strong></label>
            <input type="number" id="ppTargetNum" min="1" max="10000" value="1"
              style="width:130px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:14px;outline:none">
          </div>
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

function ppOnTargetChange() {
  var sel = document.getElementById('ppTarget');
  var wrap = document.getElementById('ppCustomWrap');
  var hint = document.getElementById('ppTargetHint');
  var custom = sel.value === 'custom';
  wrap.style.display = custom ? 'block' : 'none';
  if (custom) {
    // Prefill with the detected version as a sensible starting point.
    var num = document.getElementById('ppTargetNum');
    if (_pp.currentVersion && (!num.value || num.value === '1')) num.value = _pp.currentVersion;
    hint.textContent = 'Въведи точния вътрешен номер на проекта. По-нисък номер = отваря се в повече (по-стари) версии.';
    num.focus();
  } else if (sel.value === '1') {
    hint.innerHTML = 'Универсална: слага Version = 1, така проектът се отваря във <em>всяка</em> по-стара Premiere. Това ползва и онлайн инструментът от задачата.';
  } else {
    var opt = sel.options[sel.selectedIndex];
    hint.textContent = 'Ще се свали така, че да се отваря в ' + opt.textContent + ' и по-нови (вътрешен Version = ' + sel.value + ').';
  }
}

function ppTargetValue() {
  var sel = document.getElementById('ppTarget');
  if (sel.value === 'custom') {
    var v = parseInt(document.getElementById('ppTargetNum').value, 10);
    if (!Number.isInteger(v) || v < 1) v = 1;
    return v;
  }
  var v2 = parseInt(sel.value, 10);
  return Number.isInteger(v2) && v2 >= 1 ? v2 : 1;
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
  document.getElementById('ppWarn2026').style.display = 'none';

  // Detect current version so the user knows what they're downgrading from.
  try {
    var fd = new FormData();
    fd.append('project', file, file.name);
    var resp = await fetch('/api/premiere/inspect', { method: 'POST', body: fd });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
    _pp.currentVersion = data.version;
    var label = ppVersionLabel(data.version);
    document.getElementById('ppFileMeta').textContent =
      ppFmtSize(file.size) + ' · вътрешна версия на проекта: ' + data.version + (label ? ' (' + label + ')' : '');
    // Warn for 2026 (v45+): structural change means downgrade often crashes older Premiere.
    if (data.version >= 45) document.getElementById('ppWarn2026').style.display = 'block';
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
