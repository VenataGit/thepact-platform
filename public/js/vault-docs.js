// ==================== VAULT + DOCS + DOCUMENT EDITOR ====================
async function renderVault(el, folderId) {
  el.className='';
  try {
    const url = folderId ? `/api/vault/folders?parent_id=${folderId}` : '/api/vault/folders';
    const data = await (await fetch(url)).json();
    const { folders, files, current_folder } = data;
    const folderName = current_folder ? current_folder.name : null;
    setBreadcrumb(folderId && folderName
      ? [{label:'Документи',href:'#/vault'},{label:folderName}]
      : [{label:'Документи'}]);
    const canDel = canManage();
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <button class="btn btn-primary btn-sm" onclick="createVaultFolder(${folderId||'null'})">📁 Нова папка</button>
        <h1 style="font-size:22px;font-weight:800;color:#fff;text-align:center;flex:1">Документи</h1>
        <label class="btn btn-sm" style="cursor:pointer">📎 Качи файл<input type="file" style="display:none" onchange="uploadVaultFile(this,${folderId||'null'})"></label>
      </div>
      ${folderId?'<a href="#/vault" class="btn btn-sm" style="margin-bottom:16px;display:inline-flex">← Назад</a>':''}
      <div class="vault-grid">
        ${folders.map(f=>`<div class="vault-item folder" style="position:relative">
          <a href="#/vault/${f.id}" style="display:contents"><span class="vault-icon">📁</span><span class="vault-name">${esc(f.name)}</span></a>
          ${canDel ? `<button onclick="deleteVaultFolder(${f.id})" style="position:absolute;top:6px;right:6px;background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:14px;opacity:0;transition:opacity .15s" class="vault-del-btn" title="Изтрий папка">✕</button>` : ''}
        </div>`).join('')}
        ${files.map(f=>{
          const mime = (f.mime_type||'').toLowerCase();
          const isImage = mime.startsWith('image/');
          const isVideo = mime.startsWith('video/');
          const isPdf = mime.includes('pdf');
          const canPreview = isImage || isPdf;
          const thumbHtml = isImage
            ? `<div class="vault-thumb"><img src="/api/vault/files/${f.id}/preview" alt="${esc(f.original_name)}" loading="lazy"></div>`
            : isVideo
              ? `<div class="vault-icon" style="position:relative">${getFileIcon(f.mime_type)}<span class="vault-play-badge">&#9654;</span></div>`
              : `<span class="vault-icon">${getFileIcon(f.mime_type)}</span>`;
          const clickAttr = canPreview
            ? `onclick="openVaultPreview(${f.id},'${esc(f.original_name).replace(/'/g,"\\'")}','${f.storage_path}','${f.mime_type}')" style="cursor:pointer"`
            : `onclick="window.open('${f.storage_path}','_blank')" style="cursor:pointer"`;
          return `<div class="vault-item file" style="position:relative" ${clickAttr}>
          ${thumbHtml}
          <span class="vault-name">${esc(f.original_name)}</span>
          <span class="hint">${formatFileSize(f.size_bytes)}</span>
          ${canDel ? `<button onclick="event.stopPropagation();deleteVaultFile(${f.id})" style="position:absolute;top:6px;right:6px;background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:14px;opacity:0;transition:opacity .15s" class="vault-del-btn" title="Изтрий файл">✕</button>` : ''}
        </div>`;}).join('')}
        ${folders.length===0&&files.length===0?'<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-dim)">Празна папка</div>':''}
      </div>`;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
function createVaultFolder(pid) { showPromptModal('\u041d\u043e\u0432\u0430 \u043f\u0430\u043f\u043a\u0430', '\u0412\u044a\u0432\u0435\u0434\u0438 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435\u2026', '', async function(n) { try { await fetch('/api/vault/folders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,parent_id:pid})}); showToast('\u041f\u0430\u043f\u043a\u0430\u0442\u0430 \u0435 \u0441\u044a\u0437\u0434\u0430\u0434\u0435\u043d\u0430', 'success'); router(); } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0441\u044a\u0437\u0434\u0430\u0432\u0430\u043d\u0435 \u043d\u0430 \u043f\u0430\u043f\u043a\u0430', 'error'); } }); }
async function uploadVaultFile(input,fid) { if(!input.files[0])return; const f=new FormData(); f.append('file',input.files[0]); if(fid)f.append('folder_id',fid); try { await fetch('/api/vault/upload',{method:'POST',body:f}); showToast('\u0424\u0430\u0439\u043b\u044a\u0442 \u0435 \u043a\u0430\u0447\u0435\u043d', 'success'); router(); } catch { showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u043a\u0430\u0447\u0432\u0430\u043d\u0435', 'error'); } }
function deleteVaultFile(id) { showConfirmModal('\u0418\u0437\u0442\u0440\u0438\u0439 \u0444\u0430\u0439\u043b\u0430?', async function() { try{ await fetch('/api/vault/files/'+id,{method:'DELETE'}); showToast('\u0424\u0430\u0439\u043b\u044a\u0442 \u0435 \u0438\u0437\u0442\u0440\u0438\u0442', 'success'); router(); }catch{ showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0438\u0437\u0442\u0440\u0438\u0432\u0430\u043d\u0435', 'error'); } }, true); }
function deleteVaultFolder(id) { showConfirmModal('\u0418\u0437\u0442\u0440\u0438\u0439 \u043f\u0430\u043f\u043a\u0430\u0442\u0430 \u0438 \u0432\u0441\u0438\u0447\u043a\u043e \u0432 \u043d\u0435\u044f?', async function() { try{ await fetch('/api/vault/folders/'+id,{method:'DELETE'}); showToast('\u041f\u0430\u043f\u043a\u0430\u0442\u0430 \u0435 \u0438\u0437\u0442\u0440\u0438\u0442\u0430', 'success'); router(); }catch{ showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0438\u0437\u0442\u0440\u0438\u0432\u0430\u043d\u0435', 'error'); } }, true); }
function getFileIcon(m) { if(m?.startsWith('image/'))return'🖼️'; if(m?.startsWith('video/'))return'🎬'; if(m?.includes('pdf'))return'📄'; return'📎'; }
function formatFileSize(b) { if(!b)return''; if(b<1024)return b+' B'; if(b<1048576)return(b/1024).toFixed(1)+' KB'; return(b/1048576).toFixed(1)+' MB'; }

function openVaultPreview(fileId, fileName, storagePath, mimeType) {
  var existing = document.getElementById('vaultPreviewModal');
  if (existing) existing.remove();
  var mime = (mimeType||'').toLowerCase();
  var isImage = mime.startsWith('image/');
  var isPdf = mime.includes('pdf');
  var previewUrl = '/api/vault/files/' + fileId + '/preview';
  var contentHtml;
  if (isImage) {
    contentHtml = '<img src="' + previewUrl + '" class="vault-preview-content" alt="' + esc(fileName) + '">';
  } else if (isPdf) {
    contentHtml = '<iframe src="' + previewUrl + '" class="vault-preview-content vault-preview-pdf" title="' + esc(fileName) + '"></iframe>';
  } else {
    contentHtml = '<div style="color:var(--text-dim);padding:40px;text-align:center">Преглед не е наличен</div>';
  }
  var ov = document.createElement('div');
  ov.id = 'vaultPreviewModal';
  ov.className = 'vault-preview-modal';
  ov.innerHTML =
    '<div class="vault-preview-header">' +
      '<span class="vault-preview-filename">' + esc(fileName) + '</span>' +
      '<div class="vault-preview-actions">' +
        '<a href="' + storagePath + '" download class="btn btn-sm" title="Изтегли">⬇ Изтегли</a>' +
        '<button class="btn btn-sm vault-preview-close" onclick="closeVaultPreview()" title="Затвори">✕</button>' +
      '</div>' +
    '</div>' +
    '<div class="vault-preview-body">' + contentHtml + '</div>';
  document.body.appendChild(ov);
  ov.onclick = function(e) { if (e.target === ov) closeVaultPreview(); };
  document.addEventListener('keydown', vaultPreviewEscHandler);
}
function closeVaultPreview() {
  var m = document.getElementById('vaultPreviewModal');
  if (m) m.remove();
  document.removeEventListener('keydown', vaultPreviewEscHandler);
}
function vaultPreviewEscHandler(e) { if (e.key === 'Escape') closeVaultPreview(); }

// ==================== DOCS & FILES (Board-scoped Vault) ====================
async function renderDocs(el, boardId, folderId) {
  el.className = '';
  try {
    // Load board info for breadcrumb
    var boardsData = await (await fetch('/api/boards')).json();
    var board = boardsData.find(function(b) { return b.id === boardId; });
    var boardTitle = board ? board.title : 'Docs & Files';

    // Load folder contents
    var url = folderId
      ? '/api/vault/folders?parent_id=' + folderId
      : '/api/vault/folders?board_id=' + boardId;
    var data = await (await fetch(url)).json();
    var folders = data.folders || [];
    var files = data.files || [];
    var documents = data.documents || [];
    var currentFolder = data.current_folder;

    // Breadcrumb
    var bcItems = [{ label: '📁 ' + boardTitle, href: '#/docs/' + boardId }];
    if (folderId && currentFolder) {
      bcItems.push({ label: currentFolder.name });
    }
    setBreadcrumb(bcItems);

    var canDel = canManage();
    var rootFolderId = null;
    if (!folderId && currentFolder) rootFolderId = currentFolder.id;
    var uploadFolderId = folderId || rootFolderId || 'null';
    var isEmpty = folders.length === 0 && files.length === 0 && documents.length === 0;

    el.innerHTML =
      '<div class="home-content-box">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:8px;flex-wrap:wrap">' +
          '<div style="display:flex;gap:8px">' +
            '<button class="btn btn-primary btn-sm" onclick="createVaultDocument(' + uploadFolderId + ')">📝 Нов документ</button>' +
            '<button class="btn btn-sm" onclick="createDocsFolder(' + boardId + ',' + (folderId || 'null') + ')">📁 Нова папка</button>' +
          '</div>' +
          '<h1 style="font-size:22px;font-weight:800;color:#fff;text-align:center;flex:1">' + esc(boardTitle) + '</h1>' +
          '<label class="btn btn-sm" style="cursor:pointer">📎 Качи файл<input type="file" style="display:none" onchange="uploadDocsFile(this,' + uploadFolderId + ')" multiple></label>' +
        '</div>' +
        (folderId ? '<a href="#/docs/' + boardId + '" class="btn btn-sm" style="margin-bottom:16px;display:inline-flex">← Назад</a>' : '') +
        '<div class="vault-grid">' +
          // Documents first
          documents.map(function(d) {
            var preview = (d.content || '').replace(/<[^>]*>/g, '').substring(0, 80);
            return '<div class="vault-item vault-item--doc" style="position:relative" onclick="location.hash=\'#/doc/' + d.id + '\'">' +
              '<span class="vault-icon">📝</span>' +
              '<span class="vault-name">' + esc(d.title) + '</span>' +
              (preview ? '<span class="vault-doc-preview">' + esc(preview) + '</span>' : '<span class="vault-doc-preview" style="opacity:0.3">Празен документ</span>') +
              '<span class="hint">' + (d.author_name ? esc(d.author_name) + ' · ' : '') + timeAgo(d.updated_at) + '</span>' +
              (canDel ? '<button onclick="event.stopPropagation();deleteVaultDocument(' + d.id + ')" style="position:absolute;top:6px;right:6px;background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:14px;opacity:0;transition:opacity .15s" class="vault-del-btn" title="Изтрий документ">✕</button>' : '') +
            '</div>';
          }).join('') +
          // Folders
          folders.map(function(f) {
            return '<div class="vault-item folder" style="position:relative">' +
              '<a href="#/docs/' + boardId + '/' + f.id + '" style="display:contents"><span class="vault-icon">📁</span><span class="vault-name">' + esc(f.name) + '</span></a>' +
              (canDel ? '<button onclick="deleteVaultFolder(' + f.id + ')" style="position:absolute;top:6px;right:6px;background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:14px;opacity:0;transition:opacity .15s" class="vault-del-btn" title="Изтрий папка">✕</button>' : '') +
            '</div>';
          }).join('') +
          // Files
          files.map(function(f) {
            var mime = (f.mime_type || '').toLowerCase();
            var isImage = mime.startsWith('image/');
            var isVideo = mime.startsWith('video/');
            var isPdf = mime.includes('pdf');
            var canPreview = isImage || isPdf;
            var thumbHtml = isImage
              ? '<div class="vault-thumb"><img src="/api/vault/files/' + f.id + '/preview" alt="' + esc(f.original_name) + '" loading="lazy"></div>'
              : isVideo
                ? '<div class="vault-icon" style="position:relative">' + getFileIcon(f.mime_type) + '<span class="vault-play-badge">&#9654;</span></div>'
                : '<span class="vault-icon">' + getFileIcon(f.mime_type) + '</span>';
            var clickAttr = canPreview
              ? 'onclick="openVaultPreview(' + f.id + ',\'' + esc(f.original_name).replace(/'/g, "\\'") + '\',\'' + f.storage_path + '\',\'' + f.mime_type + '\')" style="cursor:pointer"'
              : 'onclick="window.open(\'' + f.storage_path + '\',\'_blank\')" style="cursor:pointer"';
            return '<div class="vault-item file" style="position:relative" ' + clickAttr + '>' +
              thumbHtml +
              '<span class="vault-name">' + esc(f.original_name) + '</span>' +
              '<span class="hint">' + formatFileSize(f.size_bytes) + '</span>' +
              (canDel ? '<button onclick="event.stopPropagation();deleteVaultFile(' + f.id + ')" style="position:absolute;top:6px;right:6px;background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:14px;opacity:0;transition:opacity .15s" class="vault-del-btn" title="Изтрий файл">✕</button>' : '') +
            '</div>';
          }).join('') +
          (isEmpty ? '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-dim)">Празна папка — създай документ, добави файлове или папки</div>' : '') +
        '</div>' +
      '</div>';
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка при зареждане</div>'; }
}
function createDocsFolder(boardId, parentFolderId) {
  showPromptModal('Нова папка', 'Въведи название…', '', async function(name) {
    try {
      await fetch('/api/vault/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, parent_id: parentFolderId }) });
      showToast('Папката е създадена', 'success');
      router();
    } catch { showToast('Грешка при създаване на папка', 'error'); }
  });
}
function uploadDocsFile(input, folderId) {
  if (!input.files || !input.files.length) return;
  var promises = [];
  for (var i = 0; i < input.files.length; i++) {
    var f = new FormData();
    f.append('file', input.files[i]);
    if (folderId && folderId !== 'null') f.append('folder_id', folderId);
    promises.push(fetch('/api/vault/upload', { method: 'POST', body: f }));
  }
  Promise.all(promises).then(function() {
    showToast(input.files.length > 1 ? input.files.length + ' файла качени' : 'Файлът е качен', 'success');
    router();
  }).catch(function() { showToast('Грешка при качване', 'error'); });
}

// ─── Vault Documents ───
function createVaultDocument(folderId) {
  showPromptModal('Нов документ', 'Заглавие на документа…', '', async function(title) {
    try {
      var fid = (folderId && folderId !== 'null') ? folderId : null;
      var res = await fetch('/api/vault/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title, folder_id: fid }) });
      var doc = await res.json();
      showToast('Документът е създаден', 'success');
      location.hash = '#/doc/' + doc.id;
    } catch { showToast('Грешка при създаване', 'error'); }
  });
}
function deleteVaultDocument(id) {
  showConfirmModal('Изтрий документа?', async function() {
    try { await fetch('/api/vault/documents/' + id, { method: 'DELETE' }); showToast('Документът е изтрит', 'success'); router(); }
    catch { showToast('Грешка при изтриване', 'error'); }
  }, true);
}

var _docAutoSaveTimer = null;
async function renderDocument(el, docId) {
  el.className = '';
  try {
    var doc = await (await fetch('/api/vault/documents/' + docId)).json();
    if (doc.error) { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Документът не е намерен</div>'; return; }
    setBreadcrumb([{ label: '📝 ' + (doc.title || 'Документ') }]);

    el.innerHTML =
      '<div class="home-content-box" style="max-width:860px">' +
        '<div class="doc-header">' +
          '<input class="doc-title-input" id="docTitleInput" value="' + esc(doc.title || '').replace(/"/g, '&quot;') + '" placeholder="Заглавие…" onchange="docSave(' + docId + ')">' +
          '<div class="doc-meta">' +
            (doc.author_name ? esc(doc.author_name) : '') +
            (doc.editor_name && doc.editor_name !== doc.author_name ? ' · Редактирано от ' + esc(doc.editor_name) : '') +
            ' · ' + timeAgo(doc.updated_at) +
          '</div>' +
        '</div>' +
        '<div class="doc-editor-wrap">' +
          '<input type="hidden" id="docTrixInput" value="' + esc(doc.content || '').replace(/"/g, '&quot;') + '">' +
          '<trix-editor input="docTrixInput" class="trix-dark" id="docTrixEditor" placeholder="Пиши тук…"></trix-editor>' +
        '</div>' +
        '<div class="doc-footer">' +
          '<span class="doc-save-status" id="docSaveStatus"></span>' +
          '<button class="btn btn-primary btn-sm" onclick="docSave(' + docId + ')">Запази</button>' +
        '</div>' +
      '</div>';

    // Auto-save on content change (debounced 2s)
    var trixEl = document.getElementById('docTrixEditor');
    if (trixEl) {
      trixEl.addEventListener('trix-change', function() {
        clearTimeout(_docAutoSaveTimer);
        var st = document.getElementById('docSaveStatus');
        if (st) st.textContent = 'Незапазени промени…';
        _docAutoSaveTimer = setTimeout(function() { docSave(docId); }, 2000);
      });
      // Inject color button
      setTimeout(function() { if (typeof injectTrixColorButton === 'function') injectTrixColorButton(trixEl); }, 100);
    }
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка при зареждане</div>'; }
}

async function docSave(docId) {
  try {
    var titleEl = document.getElementById('docTitleInput');
    var trixInput = document.getElementById('docTrixInput');
    var title = titleEl ? titleEl.value.trim() : null;
    var content = trixInput ? trixInput.value : null;
    await fetch('/api/vault/documents/' + docId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || undefined, content: content })
    });
    var st = document.getElementById('docSaveStatus');
    if (st) { st.textContent = 'Запазено'; setTimeout(function() { if (st) st.textContent = ''; }, 2000); }
  } catch {
    var st2 = document.getElementById('docSaveStatus');
    if (st2) st2.textContent = 'Грешка при запазване';
  }
}

// ==================== CAMPFIRE (Group Chat) ====================
