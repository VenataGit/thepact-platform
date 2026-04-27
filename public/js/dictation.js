// ==================== ДИКТОВКА (Whisper STT) ====================
// Pipeline-parallel chunked recording:
//   MediaRecorder ротира на всеки 60 сек → нов parc се качва веднага
//   докато записът продължава. Whisper service-ът обработва паралелно
//   с recording-а. Текстът се появява прогресивно (в правилен ред).
//
// Глобално състояние, защото view-овете се re-render-ват при hashchange.
var DICT_CHUNK_MS = 60_000;       // дължина на едно audio парче
var DICT_MIN_CHUNK_BYTES = 5000;  // под този размер парчето се счита за празно

var _dict = {
  stream: null,
  recorder: null,        // current MediaRecorder (ротира всеки 60 сек)
  startedAt: 0,
  timerId: null,
  audioCtx: null,
  analyser: null,
  vizRafId: null,
  busy: false,           // true докато AI обобщение върви
  // chunked transcription state
  isRecording: false,    // user wants to be recording
  chunkIdx: 0,           // следващия chunk index за recording
  chunkRotateId: null,   // setTimeout за rotate на recorder
  totalChunks: 0,        // общо създадени chunks
  pendingChunks: 0,      // брой in-flight transcribe заявки
  nextToShow: 0,         // следващия chunk index за показване
  results: {}            // {idx: {status:'pending'|'done'|'error', text?, error?}}
};

async function renderDictation(el) {
  setBreadcrumb([{label: 'Диктовка', href: '#/dictation'}]);
  el.className = 'flush-top';

  el.innerHTML = `
    <div class="home-content-box">
      <div class="page-header" style="margin-bottom:20px">
        <h1>🎤 Диктовка</h1>
        <div class="page-subtitle">Записи аудио и ще се транскрибира на български език. Текстът се добавя на парчета и можеш да запишеш колкото пъти е нужно.</div>
      </div>

      <div id="dictMicBox" style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px;flex-wrap:wrap">
          <button id="dictRecBtn" class="btn" style="min-width:160px;font-size:15px;padding:12px 18px">🎤 Старт</button>
          <div id="dictTimer" style="font-family:ui-monospace,monospace;font-size:18px;color:#fff;min-width:60px">00:00</div>
          <div style="flex:1;min-width:180px;height:24px;background:rgba(0,0,0,0.35);border-radius:6px;overflow:hidden;position:relative">
            <div id="dictLevel" style="height:100%;width:0%;background:linear-gradient(90deg,#46a374,#8ed1a8);transition:width .08s linear"></div>
          </div>
        </div>
        <div id="dictStatus" style="font-size:13px;color:var(--text-dim);min-height:18px">Натисни Старт за запис.</div>
      </div>

      <div style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <label style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.06em">Транскрипция (суров текст)</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="dictAiBtn" class="btn btn-primary btn-sm" onclick="dictAiSummary()" style="font-weight:600">✨ AI обобщение</button>
          <button class="btn btn-ghost btn-sm" onclick="dictCopyText()">📋 Копирай</button>
          <button class="btn btn-ghost btn-sm" onclick="dictDownloadText()">⬇️ Свали .txt</button>
          <button class="btn btn-ghost btn-sm" onclick="dictClearText()" style="color:var(--red)">🗑️ Изчисти</button>
        </div>
      </div>
      <textarea id="dictText" placeholder="Тук ще се появи транскрибираният текст..." style="width:100%;min-height:280px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;color:var(--text);font-size:14.5px;line-height:1.55;font-family:inherit;resize:none;outline:none;overflow:hidden"></textarea>
      <div id="dictMeta" style="font-size:12px;color:var(--text-dim);margin-top:6px;min-height:16px"></div>

      <div id="dictAiPanel" style="display:none;margin-top:24px;border-top:1px solid var(--border);padding-top:20px">
        <div style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <label style="font-size:11px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:0.06em">✨ AI обобщение</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm" onclick="dictAiUseAsMain()" title="Замества суровия текст с подредената версия">⬆ Използвай горе</button>
            <button class="btn btn-ghost btn-sm" onclick="dictAiCopy()">📋 Копирай</button>
            <button class="btn btn-ghost btn-sm" onclick="dictAiDownload()">⬇️ Свали .md</button>
            <button class="btn btn-ghost btn-sm" onclick="dictAiClose()" style="color:var(--red)">✕ Затвори</button>
          </div>
        </div>
        <textarea id="dictAiContent" placeholder="Тук ще се появи AI обобщението. Можеш да редактираш свободно." style="width:100%;min-height:240px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:16px 20px;color:var(--text);font-size:14.5px;line-height:1.65;font-family:inherit;resize:none;outline:none;overflow:hidden"></textarea>
        <div id="dictAiMeta" style="font-size:12px;color:var(--text-dim);margin-top:6px;min-height:16px"></div>
      </div>
    </div>
  `;

  // Restore last text from localStorage (survives nav)
  var dictTa = document.getElementById('dictText');
  try {
    var saved = localStorage.getItem('thepact-dictation-text');
    if (saved) dictTa.value = saved;
  } catch (e) {}
  dictTa.addEventListener('input', function() {
    try { localStorage.setItem('thepact-dictation-text', this.value); } catch (e) {}
    dictAutoGrow(this);
  });

  // Restore AI text from localStorage and persist edits
  var aiTa = document.getElementById('dictAiContent');
  try {
    var aiSaved = localStorage.getItem('thepact-dictation-ai-text');
    if (aiSaved) {
      aiTa.value = aiSaved;
      document.getElementById('dictAiPanel').style.display = 'block';
    }
  } catch (e) {}
  aiTa.addEventListener('input', function() {
    try { localStorage.setItem('thepact-dictation-ai-text', this.value); } catch (e) {}
    dictAutoGrow(this);
  });

  document.getElementById('dictRecBtn').addEventListener('click', dictToggleRec);

  // Initial auto-grow after restore (defer to next frame so layout is settled)
  requestAnimationFrame(function() {
    dictAutoGrow(dictTa);
    dictAutoGrow(aiTa);
  });
}

// Auto-resize textarea to fit content (no scrollbar, no manual resize handle).
// Works with box-sizing:border-box — adds back the border to scrollHeight.
function dictAutoGrow(ta) {
  if (!ta || !ta.isConnected) return;
  // Skip if hidden — scrollHeight is 0, would collapse the textarea
  if (ta.offsetParent === null) return;
  ta.style.height = 'auto';
  var borderY = ta.offsetHeight - ta.clientHeight; // top + bottom borders
  ta.style.height = (ta.scrollHeight + borderY) + 'px';
}

async function dictToggleRec() {
  if (_dict.isRecording) {
    dictStopRec();
  } else if (_dict.pendingChunks > 0) {
    // Disabled while draining backlog
    return;
  } else {
    await dictStartRec();
  }
}

async function dictStartRec() {
  var btn = document.getElementById('dictRecBtn');
  var status = document.getElementById('dictStatus');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    status.textContent = 'Браузърът не поддържа достъп до микрофон.';
    return;
  }
  try {
    _dict.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    });
  } catch (err) {
    status.textContent = 'Достъп до микрофон отказан: ' + (err.message || err.name);
    return;
  }

  // Reset chunked transcription state
  _dict.isRecording = true;
  _dict.chunkIdx = 0;
  _dict.totalChunks = 0;
  _dict.pendingChunks = 0;
  _dict.nextToShow = 0;
  _dict.results = {};
  _dict.startedAt = Date.now();

  // Visual level meter (attached to stream — survives recorder rotation)
  try {
    _dict.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var src = _dict.audioCtx.createMediaStreamSource(_dict.stream);
    _dict.analyser = _dict.audioCtx.createAnalyser();
    _dict.analyser.fftSize = 256;
    src.connect(_dict.analyser);
    dictTickViz();
  } catch (e) {}

  // Timer
  _dict.timerId = setInterval(dictTickTimer, 250);
  dictTickTimer();

  btn.textContent = '⏹ Стоп';
  btn.classList.add('btn-recording');
  btn.style.background = '#c0392b';

  // Start first chunk recorder
  dictStartChunkRecorder();
  dictUpdateStatus();
}

// Pick best supported MIME (Chrome/Edge: webm/opus; Safari: mp4/aac)
function dictPickMime() {
  var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (var i = 0; i < candidates.length; i++) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
  }
  return '';
}

// Start a new MediaRecorder for the next chunk. When it stops (rotation or
// final stop), the accumulated blob is sent to /api/transcribe and the next
// recorder is started immediately so audio doesn't drop.
function dictStartChunkRecorder() {
  if (!_dict.isRecording || !_dict.stream) return;
  var idx = _dict.chunkIdx++;
  _dict.totalChunks = idx + 1;

  var mime = dictPickMime();
  var localChunks = [];
  var recorder;
  try {
    recorder = new MediaRecorder(_dict.stream, mime ? { mimeType: mime } : undefined);
  } catch (err) {
    var status = document.getElementById('dictStatus');
    if (status) status.textContent = 'MediaRecorder грешка: ' + err.message;
    _dict.isRecording = false;
    dictReleaseStream();
    return;
  }

  recorder.ondataavailable = function(e) { if (e.data && e.data.size) localChunks.push(e.data); };
  recorder.onstop = function() {
    var blob = new Blob(localChunks, { type: mime || 'audio/webm' });
    if (blob.size >= DICT_MIN_CHUNK_BYTES) {
      dictSendChunk(idx, blob, mime || 'audio/webm');
    } else {
      // empty/silent chunk — skip but advance the show pointer
      _dict.results[idx] = { status: 'done', text: '' };
      dictAppendCompleted();
    }
    dictUpdateStatus();
  };
  recorder.start();
  _dict.recorder = recorder;

  // Schedule rotation: stop current → start next (no gap, audio continues)
  _dict.chunkRotateId = setTimeout(function() {
    if (_dict.recorder === recorder && recorder.state === 'recording') {
      recorder.stop(); // triggers onstop → sends chunk
      if (_dict.isRecording) dictStartChunkRecorder();
    }
  }, DICT_CHUNK_MS);
}

function dictStopRec() {
  if (!_dict.isRecording) return;
  _dict.isRecording = false;
  if (_dict.chunkRotateId) { clearTimeout(_dict.chunkRotateId); _dict.chunkRotateId = null; }
  if (_dict.recorder && _dict.recorder.state === 'recording') {
    _dict.recorder.stop(); // triggers onstop → sends final chunk
  }
  // Stop timers + viz
  if (_dict.timerId) { clearInterval(_dict.timerId); _dict.timerId = null; }
  if (_dict.vizRafId) { cancelAnimationFrame(_dict.vizRafId); _dict.vizRafId = null; }
  var bar = document.getElementById('dictLevel'); if (bar) bar.style.width = '0%';
  dictReleaseStream();
  dictUpdateStatus();
}

async function dictSendChunk(idx, blob, mime) {
  _dict.pendingChunks++;
  _dict.results[idx] = { status: 'pending' };
  dictUpdateStatus();
  try {
    var fd = new FormData();
    var ext = mime.indexOf('mp4') > -1 ? 'm4a' : (mime.indexOf('ogg') > -1 ? 'ogg' : 'webm');
    fd.append('audio', blob, 'rec-' + idx + '.' + ext);
    var resp = await fetch('/api/transcribe', { method: 'POST', body: fd });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
    _dict.results[idx] = { status: 'done', text: (data.text || '').trim() };
  } catch (err) {
    _dict.results[idx] = { status: 'error', error: err.message };
    if (typeof showToast === 'function') showToast('Парче ' + (idx + 1) + ': ' + err.message, 'error');
  } finally {
    _dict.pendingChunks--;
    dictAppendCompleted();
    dictUpdateStatus();
  }
}

// Append completed chunks to textarea IN ORDER. Stops at first pending hole.
function dictAppendCompleted() {
  while (_dict.results[_dict.nextToShow] && _dict.results[_dict.nextToShow].status !== 'pending') {
    var r = _dict.results[_dict.nextToShow];
    if (r.status === 'done' && r.text) {
      dictAppendText(r.text);
    } else if (r.status === 'error') {
      dictAppendText('[парче ' + (_dict.nextToShow + 1) + ' грешка: ' + r.error + ']');
    }
    delete _dict.results[_dict.nextToShow];
    _dict.nextToShow++;
  }
}

function dictUpdateStatus() {
  var status = document.getElementById('dictStatus');
  var btn = document.getElementById('dictRecBtn');
  if (!status || !btn) return;
  var done = _dict.nextToShow;
  var total = _dict.totalChunks;
  var pending = _dict.pendingChunks;

  if (_dict.isRecording) {
    status.textContent = 'Записва се · парче ' + (_dict.chunkIdx) + ' активно · готови ' + done + '/' + (total - 1) +
      (pending ? ' (' + pending + ' се обработват)' : '');
  } else if (pending > 0 || done < total) {
    btn.disabled = true;
    btn.textContent = '⏳ Чака ' + (total - done) + ' парчета...';
    btn.style.background = '';
    btn.classList.remove('btn-recording');
    status.textContent = 'Записването спря. Готови ' + done + '/' + total + ' (' + pending + ' в процес)';
  } else if (total > 0) {
    btn.disabled = false;
    btn.textContent = '🎤 Старт';
    btn.style.background = '';
    btn.classList.remove('btn-recording');
    status.textContent = 'Готово. ' + total + ' парче' + (total === 1 ? '' : 'та') + ' обработени.';
  } else {
    btn.disabled = false;
    btn.textContent = '🎤 Старт';
    status.textContent = 'Натисни Старт за запис.';
  }
}

function dictTickTimer() {
  var t = document.getElementById('dictTimer');
  if (!t) return;
  var sec = Math.floor((Date.now() - _dict.startedAt) / 1000);
  var mm = String(Math.floor(sec / 60)).padStart(2, '0');
  var ss = String(sec % 60).padStart(2, '0');
  t.textContent = mm + ':' + ss;
}

function dictTickViz() {
  if (!_dict.analyser) return;
  var bar = document.getElementById('dictLevel');
  if (!bar) return;
  var data = new Uint8Array(_dict.analyser.frequencyBinCount);
  _dict.analyser.getByteTimeDomainData(data);
  var sum = 0;
  for (var i = 0; i < data.length; i++) {
    var v = (data[i] - 128) / 128;
    sum += v * v;
  }
  var rms = Math.sqrt(sum / data.length);
  var pct = Math.min(100, Math.round(rms * 240));
  bar.style.width = pct + '%';
  _dict.vizRafId = requestAnimationFrame(dictTickViz);
}

function dictAppendText(text) {
  var ta = document.getElementById('dictText');
  if (!ta || !text) return;
  var current = ta.value.trim();
  ta.value = current ? (current + ' ' + text) : text;
  try { localStorage.setItem('thepact-dictation-text', ta.value); } catch (e) {}
  dictAutoGrow(ta);
}

function dictReleaseStream() {
  if (_dict.stream) { _dict.stream.getTracks().forEach(function(t) { t.stop(); }); _dict.stream = null; }
  if (_dict.audioCtx) { try { _dict.audioCtx.close(); } catch (e) {} _dict.audioCtx = null; }
  _dict.analyser = null;
  _dict.recorder = null;
}

function dictCopyText() {
  var ta = document.getElementById('dictText');
  if (!ta || !ta.value) return;
  ta.select();
  navigator.clipboard.writeText(ta.value).then(function() {
    if (typeof showToast === 'function') showToast('Копирано в clipboard', 'success');
  }).catch(function() {
    document.execCommand('copy');
  });
}

function dictDownloadText() {
  var ta = document.getElementById('dictText');
  if (!ta || !ta.value) return;
  var blob = new Blob([ta.value], { type: 'text/plain;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  var ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url; a.download = 'диктовка-' + ts + '.txt';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

function dictClearText() {
  var ta = document.getElementById('dictText');
  if (!ta) return;
  if (ta.value && !confirm('Сигурен ли си? Текстът ще се изтрие.')) return;
  ta.value = '';
  try { localStorage.removeItem('thepact-dictation-text'); } catch (e) {}
  var meta = document.getElementById('dictMeta'); if (meta) meta.textContent = '';
  dictAutoGrow(ta);
}

// ==================== AI SUMMARY (Claude API) ====================
async function dictAiSummary() {
  var ta = document.getElementById('dictText');
  var btn = document.getElementById('dictAiBtn');
  var panel = document.getElementById('dictAiPanel');
  var content = document.getElementById('dictAiContent');
  var meta = document.getElementById('dictAiMeta');
  if (!ta || !ta.value || !ta.value.trim()) {
    if (typeof showToast === 'function') showToast('Няма текст за обобщение.', 'error');
    return;
  }
  if (_dict.busy) return;
  _dict.busy = true;
  var origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ AI обработка...';
  panel.style.display = 'block';
  content.value = '';
  content.placeholder = 'Claude мисли...';
  content.disabled = true;
  meta.textContent = '';
  meta.style.color = '';

  var t0 = Date.now();
  try {
    var resp = await fetch('/api/transcribe/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: ta.value })
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
    content.value = data.text || '';
    content.placeholder = 'Тук ще се появи AI обобщението. Можеш да редактираш свободно.';
    try { localStorage.setItem('thepact-dictation-ai-text', content.value); } catch (e) {}
    meta.textContent = 'Готово за ' + ((Date.now() - t0) / 1000).toFixed(1) + 'с · модел: ' + (data.model || '?') +
      (data.input_tokens ? ' · ' + data.input_tokens + ' → ' + data.output_tokens + ' токена' : '');
    dictAutoGrow(content);
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    content.value = '';
    content.placeholder = 'Тук ще се появи AI обобщението. Можеш да редактираш свободно.';
    meta.textContent = 'Грешка: ' + err.message;
    meta.style.color = 'var(--red)';
    dictAutoGrow(content);
    if (typeof showToast === 'function') showToast('AI грешка: ' + err.message, 'error');
  } finally {
    _dict.busy = false;
    btn.disabled = false;
    btn.textContent = origLabel;
    content.disabled = false;
  }
}

function dictAiUseAsMain() {
  var content = document.getElementById('dictAiContent');
  var ta = document.getElementById('dictText');
  if (!content || !ta) return;
  var text = content.value || '';
  if (!text.trim()) return;
  if (ta.value.trim() && !confirm('Това ще замени суровия текст. Продължаваш?')) return;
  ta.value = text;
  try { localStorage.setItem('thepact-dictation-text', text); } catch (e) {}
  dictAutoGrow(ta);
  if (typeof showToast === 'function') showToast('AI обобщението е горе.', 'success');
}

function dictAiCopy() {
  var content = document.getElementById('dictAiContent');
  if (!content || !content.value) return;
  navigator.clipboard.writeText(content.value).then(function() {
    if (typeof showToast === 'function') showToast('AI текст копиран.', 'success');
  });
}

function dictAiDownload() {
  var content = document.getElementById('dictAiContent');
  if (!content || !content.value) return;
  var blob = new Blob([content.value], { type: 'text/markdown;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  var ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url; a.download = 'диктовка-ai-' + ts + '.md';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

function dictAiClose() {
  var panel = document.getElementById('dictAiPanel');
  var content = document.getElementById('dictAiContent');
  if (content && content.value && !confirm('Затваряне? AI текстът ще се изтрие.')) return;
  if (panel) panel.style.display = 'none';
  if (content) { content.value = ''; content.style.height = ''; }
  try { localStorage.removeItem('thepact-dictation-ai-text'); } catch (e) {}
  var meta = document.getElementById('dictAiMeta');
  if (meta) { meta.textContent = ''; meta.style.color = ''; }
}
