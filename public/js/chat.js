// ==================== CHAT / PINGS / CAMPFIRE ====================
const _chatColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
function _chatColor(id) { return _chatColors[(id||0) % _chatColors.length]; }
function _chatChannelName(ch) { if (ch.name) return ch.name; var others = (ch.members||[]).filter(function(m){return m.id!==currentUser.id}); return others.map(function(m){return m.name}).join(', ') || 'Чат'; }
function _chatAvatar(ch) {
  var others = (ch.members||[]).filter(function(m){return m.id!==currentUser.id});
  if (ch.avatar_url) return '<img src="'+ch.avatar_url+'" class="chat-av-img">';
  if (ch.type==='dm' && others.length===1) {
    var o = others[0];
    if (o.avatar_url) return '<img src="'+o.avatar_url+'" class="chat-av-img">';
    return '<div class="chat-av-initials" style="background:'+_chatColor(o.id)+'">'+initials(o.name)+'</div>';
  }
  // Group: composite
  var shown = others.slice(0,4);
  if (shown.length===0) return '<div class="chat-av-initials" style="background:#555">G</div>';
  return '<div class="chat-av-composite chat-av-composite--'+shown.length+'">'+shown.map(function(u){
    if (u.avatar_url) return '<img src="'+u.avatar_url+'" class="chat-av-piece">';
    return '<div class="chat-av-piece" style="background:'+_chatColor(u.id)+'">'+initials(u.name)+'</div>';
  }).join('')+'</div>';
}

// --- Pings badge ---
async function updatePingsBadge() {
  try {
    var r = await (await fetch('/api/chat/unread-count')).json();
    var b = document.getElementById('pingsBadge');
    if (r.count > 0) { b.textContent = r.count > 99 ? '99+' : r.count; b.style.display = ''; } else b.style.display = 'none';
  } catch {}
}

// --- Pings dropdown ---
// Basecamp-style Pings grid: large composite avatars in a 4-column grid,
// name centered below each tile, group chats show "X души" subtitle.
// No previews, no timestamps — just visual recognition by avatar.
async function populatePings(el) {
  _chatSelectedUsers = [];
  try {
    var channels = await (await fetch('/api/chat/recent')).json();
    var html = '<div class="pings-dd">';
    // Search input row (still uses chips for multi-select)
    html += '<div class="pings-dd__new" onclick="event.stopPropagation()">';
    html += '<div class="pings-dd__chips" id="pingsChips"><input id="pingsNewInput" placeholder="Започни личен чат с..." autocomplete="off" oninput="pingsFilterUsers()" onfocus="pingsShowSuggestions()"></div>';
    html += '<button class="btn btn-primary btn-sm pings-dd__start-btn" id="pingsStartBtn" onclick="pingsStartChat(event)" style="display:none">Започни</button>';
    html += '<div class="pings-dd__suggestions" id="pingsSuggestions" style="display:none"></div>';
    html += '</div>';
    // Grid of chat tiles
    if (channels.length > 0) {
      html += '<div class="pings-dd__grid">';
      channels.forEach(function(ch) {
        var name = _chatChannelName(ch);
        var unread = parseInt(ch.unread_count) || 0;
        var memberCount = parseInt(ch.member_count) || (ch.members ? ch.members.length : 0);
        // Show "X души" subtitle only for group chats (3+ members or has explicit name)
        var isGroup = memberCount > 2 || !!ch.name;
        var subtitle = isGroup ? memberCount + ' души' : '';
        html += '<a class="pings-dd__tile'+(unread?' pings-dd__tile--unread':'')+'" href="#/chat/'+ch.id+'" onclick="closeAllDropdowns()" title="'+esc(name)+'">';
        html += '<div class="pings-dd__tile-av">'+_chatAvatar(ch);
        if (unread) html += '<span class="pings-dd__tile-badge">'+(unread > 99 ? '99+' : unread)+'</span>';
        html += '</div>';
        html += '<div class="pings-dd__tile-name">'+esc(name)+'</div>';
        if (subtitle) html += '<div class="pings-dd__tile-meta">'+subtitle+'</div>';
        html += '</a>';
      });
      html += '</div>';
    } else {
      html += '<div class="pings-dd__empty">Все още нямате чатове. Започни нов отгоре.</div>';
    }
    // Prominent "View all chats" footer — opens the full chat page
    html += '<div class="pings-dd__footer-section">';
    html += '<span class="pings-dd__footer-text">Показват се най-скорошните чатове.</span>';
    html += '<a class="pings-dd__footer-btn" href="#/chat" onclick="closeAllDropdowns()">💬 Виж всички чатове</a>';
    html += '</div>';
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    console.warn('[pings] populate failed:', e.message);
    el.innerHTML = '<div class="nav-dropdown__empty">Грешка при зареждане</div>';
  }
}
function pingsShowSuggestions() {
  var el = document.getElementById('pingsSuggestions');
  if (!el) return;
  var selectedIds = _chatSelectedUsers.map(function(u){return u.id});
  var html = allUsers.filter(function(u){return u.id!==currentUser.id && selectedIds.indexOf(u.id)===-1}).map(function(u){
    var av = u.avatar_url ? '<img src="'+u.avatar_url+'" class="chat-av-img">' : '<div class="chat-av-initials" style="background:'+_chatColor(u.id)+'">'+initials(u.name)+'</div>';
    return '<div class="pings-dd__sug-item" onmousedown="pingsSelectUser('+u.id+',\''+esc(u.name).replace(/'/g,"\\'")+'\')">'+av+'<span>'+esc(u.name)+'</span></div>';
  }).join('');
  el.innerHTML = html;
  el.style.display = html ? 'block' : 'none';
}
function pingsFilterUsers() {
  var q = (document.getElementById('pingsNewInput')?.value || '').toLowerCase().trim();
  var el = document.getElementById('pingsSuggestions');
  if (!el) return;
  var selectedIds = _chatSelectedUsers.map(function(u){return u.id});
  var filtered = allUsers.filter(function(u){
    return u.id!==currentUser.id && selectedIds.indexOf(u.id)===-1 && (!q || u.name.toLowerCase().indexOf(q) !== -1);
  });
  el.innerHTML = filtered.map(function(u){
    var av = u.avatar_url ? '<img src="'+u.avatar_url+'" class="chat-av-img">' : '<div class="chat-av-initials" style="background:'+_chatColor(u.id)+'">'+initials(u.name)+'</div>';
    return '<div class="pings-dd__sug-item" onmousedown="pingsSelectUser('+u.id+',\''+esc(u.name).replace(/'/g,"\\'")+'\')">'+av+'<span>'+esc(u.name)+'</span></div>';
  }).join('');
  el.style.display = filtered.length ? 'block' : 'none';
}
function pingsSelectUser(id, name) {
  if (_chatSelectedUsers.find(function(u){return u.id===id})) return;
  _chatSelectedUsers.push({id:id, name:name});
  _pingsRenderChips();
}
function pingsRemoveUser(id) {
  _chatSelectedUsers = _chatSelectedUsers.filter(function(u){return u.id!==id});
  _pingsRenderChips();
}
function _pingsRenderChips() {
  var container = document.getElementById('pingsChips');
  if (!container) return;
  var html = _chatSelectedUsers.map(function(u){
    return '<span class="pings-dd__chip">'+esc(u.name)+'<button onclick="pingsRemoveUser('+u.id+')">&times;</button></span>';
  }).join('');
  html += '<input id="pingsNewInput" placeholder="'+(_chatSelectedUsers.length?'Добави още...':'Започни личен чат с...')+'" autocomplete="off" oninput="pingsFilterUsers()" onfocus="pingsShowSuggestions()" onblur="setTimeout(function(){document.getElementById(\'pingsSuggestions\')&&(document.getElementById(\'pingsSuggestions\').style.display=\'none\')},200)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();pingsStartChat(event);}if(event.key===\'Backspace\'&&!this.value&&_chatSelectedUsers.length){pingsRemoveUser(_chatSelectedUsers[_chatSelectedUsers.length-1].id);}">';
  container.innerHTML = html;
  var btn = document.getElementById('pingsStartBtn');
  if (btn) btn.style.display = _chatSelectedUsers.length ? '' : 'none';
  var inp = document.getElementById('pingsNewInput');
  if (inp) inp.focus();
}
async function pingsStartChat(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (_chatSelectedUsers.length === 0) return;
  var ids = _chatSelectedUsers.map(function(u){return u.id});
  var type = ids.length === 1 ? 'dm' : 'group';
  var name = ids.length > 1 ? _chatSelectedUsers.map(function(u){return u.name.split(' ')[0]}).join(', ') : null;
  try {
    var ch = await (await fetch('/api/chat/channels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:type,member_ids:ids,name:name})})).json();
    closeAllDropdowns();
    location.hash = '#/chat/'+ch.id;
  } catch {}
}

// --- Full Chat Page ---
async function renderChatList(el) {
  setBreadcrumb(null); el.className = 'page-chat'; window.scrollTo(0, 0);
  try {
    var channels = await (await fetch('/api/chat/channels')).json();
    el.innerHTML = '<div class="chat-layout"><div class="chat-sidebar" id="chatSidebar">'+_renderChatSidebar(channels)+'</div><div class="chat-main" id="chatMain"><div class="chat-empty"><div class="chat-empty__icon">💬</div><p>Избери чат отляво или започни нов</p></div></div></div>';
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}
function _renderChatSidebar(channels) {
  var html = '<div class="chat-sb__header"><h3>Чатове</h3><button class="btn btn-primary btn-sm" onclick="chatNewFromSidebar()">+ Нов</button></div>';
  html += '<input class="chat-sb__search" placeholder="Търси чат..." oninput="chatFilterSidebar(this.value)">';
  html += '<div class="chat-sb__list" id="chatSbList">';
  if (channels.length === 0) {
    html += '<div class="chat-sb__empty">Няма чатове</div>';
  } else {
    channels.forEach(function(ch) {
      var name = _chatChannelName(ch);
      var preview = ch.last_message || '';
      if (preview.length > 45) preview = preview.substring(0,45)+'…';
      var unread = parseInt(ch.unread_count) || 0;
      var active = _activeChatChannel === ch.id ? ' chat-sb__item--active' : '';
      html += '<a class="chat-sb__item'+active+(unread?' chat-sb__item--unread':'')+'" href="#/chat/'+ch.id+'" data-chat-id="'+ch.id+'" data-chat-name="'+esc(name).toLowerCase()+'">';
      html += '<div class="chat-sb__av">'+_chatAvatar(ch)+'</div>';
      html += '<div class="chat-sb__info"><div class="chat-sb__name">'+esc(name)+'</div>';
      if (preview) html += '<div class="chat-sb__preview">'+(ch.last_message_user_name?esc(ch.last_message_user_name.split(' ')[0])+': ':'')+esc(preview)+'</div>';
      html += '</div>';
      if (ch.last_message_at) html += '<div class="chat-sb__meta"><span class="chat-sb__time">'+timeAgo(ch.last_message_at)+'</span>'+(unread?'<span class="chat-sb__badge">'+unread+'</span>':'')+'</div>';
      html += '</a>';
    });
  }
  html += '</div>';
  return html;
}
function chatFilterSidebar(q) {
  q = q.toLowerCase().trim();
  document.querySelectorAll('.chat-sb__item').forEach(function(el) {
    el.style.display = (!q || (el.dataset.chatName||'').indexOf(q) !== -1) ? '' : 'none';
  });
}
function chatNewFromSidebar() {
  // Open modal for new chat with multi-select
  var ov = document.createElement('div'); ov.className = 'modal-overlay';
  var colors = _chatColors;
  ov.innerHTML = '<div class="confirm-modal-box" style="max-width:420px" onclick="event.stopPropagation()">'+
    '<p class="confirm-modal-msg">Нов чат</p>'+
    '<div class="pings-dd__chips" id="newChatChips" style="margin-bottom:8px"><input id="newChatInput" placeholder="Търси човек..." autocomplete="off" oninput="newChatFilter()"></div>'+
    '<div class="pings-dd__suggestions" id="newChatSuggestions" style="position:relative;max-height:200px;overflow-y:auto;display:block">'+
      allUsers.filter(function(u){return u.id!==currentUser.id}).map(function(u){
        var av = u.avatar_url ? '<img src="'+u.avatar_url+'" class="chat-av-img">' : '<div class="chat-av-initials" style="background:'+_chatColor(u.id)+'">'+initials(u.name)+'</div>';
        return '<div class="pings-dd__sug-item" data-uid="'+u.id+'" data-uname="'+esc(u.name)+'" onclick="newChatToggleUser(this,'+u.id+',\''+esc(u.name).replace(/'/g,"\\'")+'\')">'+av+'<span>'+esc(u.name)+'</span></div>';
      }).join('')+
    '</div>'+
    '<div class="confirm-modal-actions"><button class="btn btn-primary" id="newChatOk">Започни чат</button><button class="btn btn-ghost" onclick="this.closest(\'.modal-overlay\').remove()">Откажи</button></div>'+
  '</div>';
  document.body.appendChild(ov);
  ov.onclick = function(e){if(e.target===ov)ov.remove()};
  window._newChatSelected = [];
  ov.querySelector('#newChatOk').onclick = async function() {
    if (window._newChatSelected.length===0) return;
    var ids = window._newChatSelected.map(function(u){return u.id});
    var type = ids.length===1 ? 'dm' : 'group';
    var name = ids.length>1 ? window._newChatSelected.map(function(u){return u.name.split(' ')[0]}).join(', ') : null;
    try {
      var ch = await (await fetch('/api/chat/channels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:type,member_ids:ids,name:name})})).json();
      ov.remove();
      location.hash = '#/chat/'+ch.id;
    } catch {}
  };
  setTimeout(function(){document.getElementById('newChatInput')?.focus()},50);
}
window.newChatToggleUser = function(el, id, name) {
  var idx = window._newChatSelected.findIndex(function(u){return u.id===id});
  if (idx !== -1) { window._newChatSelected.splice(idx,1); el.classList.remove('selected'); }
  else { window._newChatSelected.push({id:id,name:name}); el.classList.add('selected'); }
  // Update chips
  var chips = document.getElementById('newChatChips');
  if (!chips) return;
  var html = window._newChatSelected.map(function(u){return '<span class="pings-dd__chip">'+esc(u.name)+'<button onclick="newChatRemoveUser('+u.id+')">&times;</button></span>';}).join('');
  html += '<input id="newChatInput" placeholder="'+(window._newChatSelected.length?'Добави още...':'Търси човек...')+'" autocomplete="off" oninput="newChatFilter()">';
  chips.innerHTML = html;
  document.getElementById('newChatInput')?.focus();
};
window.newChatRemoveUser = function(id) {
  window._newChatSelected = window._newChatSelected.filter(function(u){return u.id!==id});
  document.querySelectorAll('#newChatSuggestions .pings-dd__sug-item[data-uid="'+id+'"]').forEach(function(el){el.classList.remove('selected')});
  var chips = document.getElementById('newChatChips');
  if (!chips) return;
  var html = window._newChatSelected.map(function(u){return '<span class="pings-dd__chip">'+esc(u.name)+'<button onclick="newChatRemoveUser('+u.id+')">&times;</button></span>';}).join('');
  html += '<input id="newChatInput" placeholder="'+(window._newChatSelected.length?'Добави още...':'Търси човек...')+'" autocomplete="off" oninput="newChatFilter()">';
  chips.innerHTML = html;
};
window.newChatFilter = function() {
  var q = (document.getElementById('newChatInput')?.value||'').toLowerCase().trim();
  document.querySelectorAll('#newChatSuggestions .pings-dd__sug-item').forEach(function(el){
    var name = el.dataset.uname || '';
    el.style.display = (!q || name.toLowerCase().indexOf(q)!==-1) ? '' : 'none';
  });
};

// --- Chat conversation page ---
async function renderChatChannel(el, channelId) {
  _activeChatChannel = channelId;
  setBreadcrumb(null); el.className = 'page-chat'; window.scrollTo(0, 0);
  try {
    var [msgs, channels] = await Promise.all([
      (await fetch('/api/chat/channels/'+channelId+'/messages')).json(),
      (await fetch('/api/chat/channels')).json()
    ]);
    var ch = channels.find(function(c){return c.id===channelId});
    if (!ch) { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Чатът не е намерен</div>'; return; }
    var name = _chatChannelName(ch);
    var others = (ch.members||[]).filter(function(m){return m.id!==currentUser.id});
    var isGroup = ch.type === 'group';
    var memberCount = (ch.members||[]).length;

    // Mark as read
    fetch('/api/chat/channels/'+channelId+'/read', {method:'PUT'}).catch(function(){});
    updatePingsBadge();

    // Build layout
    var sidebarHtml = _renderChatSidebar(channels);

    // Compact header (horizontal bar)
    var headerHtml = '<div class="chat-hd">' +
      '<button class="chat-hd__back" onclick="location.hash=\'#/chat\'">←</button>' +
      '<div class="chat-hd__av">'+_chatAvatar(ch)+'</div>' +
      '<div class="chat-hd__info"><div class="chat-hd__name">'+esc(name)+'</div>' +
        (isGroup ? '<div class="chat-hd__meta">'+memberCount+' участника</div>' : '') +
      '</div>' +
      (isGroup ? '<button class="chat-hd__settings" onclick="chatGroupSettings('+channelId+')">···</button>' : '') +
    '</div>';

    // Messages with date dividers
    var msgsHtml = _renderMessagesWithDividers(msgs, channelId);

    // Input footer — Trix editor (same as card notes), emoji/GIF/file actions
    var inputHtml = '<div class="chat-footer">' +
      '<div class="chat-editor-wrap bc-editor">' +
        '<input id="chatTrixInput" type="hidden" value="">' +
        '<trix-editor input="chatTrixInput" class="trix-dark" placeholder="Напиши съобщение\u2026"></trix-editor>' +
      '</div>' +
      '<div class="chat-input__actions">' +
        '<button class="chat-input__btn chat-input__btn--text" onclick="chatToggleFormatting()" title="Форматиране">A</button>' +
        '<button class="chat-input__btn" onclick="chatToggleEmoji()" title="Емоджи">😊</button>' +
        '<button class="chat-input__btn chat-input__btn--gif" onclick="chatToggleGif()" title="GIF">GIF</button>' +
        '<button class="chat-input__btn" onclick="document.getElementById(\'chatFileInput\').click()" title="Прикачи файл">📎</button>' +
        '<input type="file" id="chatFileInput" multiple style="display:none" onchange="chatUploadFiles(this,'+channelId+')">' +
        '<div class="chat-emoji-picker" id="chatEmojiPicker"></div>' +
        '<div class="chat-gif-picker" id="chatGifPicker"></div>' +
        '<button class="chat-input__send" onclick="sendChatMsg('+channelId+')" title="Изпрати (Enter)">➤</button>' +
      '</div>' +
    '</div>' +
    '<div class="chat-typing" id="chatTyping"></div>';

    el.innerHTML = '<div class="chat-layout">' +
      '<div class="chat-main" id="chatMain">' + headerHtml +
        '<div class="chat-messages" id="chatMessages">'+msgsHtml+'</div>' +
        inputHtml +
      '</div></div>';

    var msgsEl = document.getElementById('chatMessages');
    if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;

    // Setup Trix editor for chat (inject color button, handle Enter-to-send)
    setTimeout(function() { chatSetupTrix(channelId); }, 300);
  } catch(e) { console.error(e); el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка</div>'; }
}

function _renderChatMessage(m, channelId) {
  var isOwn = m.user_id === currentUser.id;
  var isSystem = m.message_type === 'system';
  if (isSystem) {
    return '<div class="chat-msg chat-msg--system"><div class="chat-msg-sys-text">'+esc(m.content)+'</div></div>';
  }
  var av = m.user_avatar ? '<img src="'+m.user_avatar+'" class="chat-av-img">' : '<div class="chat-av-initials" style="background:'+_chatColor(m.user_id)+'">'+initials(m.user_name)+'</div>';
  var time = new Date(m.created_at).toLocaleTimeString('bg',{hour:'2-digit',minute:'2-digit'});
  var editedTag = m.is_edited ? ' <span class="chat-msg-edited">(редактирано)</span>' : '';
  var displayName = isOwn ? 'Me' : esc(m.user_name);
  var contentHtml = '';
  if (m.message_type === 'attachment' && m.attachment_url) {
    var isImage = (m.attachment_mime||'').startsWith('image/');
    if (isImage) {
      contentHtml = '<div class="chat-msg-attachment"><img src="'+m.attachment_url+'" class="chat-msg-img" onclick="window.open(\''+m.attachment_url+'\',\'_blank\')"></div>';
    } else {
      contentHtml = '<div class="chat-msg-attachment"><a href="'+m.attachment_url+'" target="_blank" class="chat-msg-file">📄 '+esc(m.attachment_name||'Файл')+'</a></div>';
    }
    if (m.content) contentHtml += '<div class="chat-msg-text">'+_chatFormatText(m.content)+editedTag+'</div>';
  } else {
    contentHtml = '<div class="chat-msg-text">'+_chatFormatText(m.content)+editedTag+'</div>';
  }
  // Actions menu (edit/delete) for own messages
  var actionsHtml = '';
  if (isOwn && m.message_type !== 'system') {
    actionsHtml = '<button class="chat-msg-menu-btn" onclick="chatMsgMenu('+m.id+',this,'+channelId+')" title="Опции">⋮</button>';
  }
  return '<div class="chat-msg'+(isOwn?' chat-msg--own':' chat-msg--other')+'" data-msg-id="'+m.id+'" data-msg-content="'+esc(m.content || '')+'">' +
    '<div class="chat-msg-av">'+av+'</div>' +
    '<div class="chat-msg-body">' +
      '<div class="chat-msg-meta"><span class="chat-msg-name">'+displayName+'</span><span class="chat-msg-time">'+time+'</span>'+actionsHtml+'</div>' +
      contentHtml +
      '<div class="chat-msg-reactions"><button class="chat-msg-boost-trigger" onclick="chatBoostMsg('+m.id+',this)" title="Реагирай">😊</button></div>' +
    '</div>' +
  '</div>';
}
function _renderDateDivider(dateStr) {
  var d = new Date(dateStr);
  var opts = {weekday:'long', day:'numeric', month:'long', year:'numeric'};
  var label = d.toLocaleDateString('bg-BG', opts);
  return '<div class="chat-date-divider"><span>'+label+'</span></div>';
}
function _renderMessagesWithDividers(msgs, channelId) {
  var html = '', lastDate = '';
  msgs.forEach(function(m) {
    var msgDate = (m.created_at||'').split('T')[0];
    if (msgDate && msgDate !== lastDate) {
      html += _renderDateDivider(msgDate+'T00:00:00');
      lastDate = msgDate;
    }
    html += _renderChatMessage(m, channelId);
  });
  return html;
}
function chatBoostMsg(msgId, btn) {
  var boostEmojis = ['❤️','👍','🔥','😂','🎉','👏'];
  var existing = btn.closest('.chat-msg-reactions').querySelector('.chat-boost-picker');
  if (existing) { existing.remove(); return; }
  var picker = document.createElement('div');
  picker.className = 'chat-boost-picker';
  picker.style.cssText = 'display:flex;gap:2px;padding:4px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.3);position:absolute;z-index:50';
  picker.innerHTML = boostEmojis.map(function(e){ return '<button style="border:none;background:none;font-size:18px;cursor:pointer;padding:2px 4px;border-radius:4px" onmousedown="event.preventDefault()" onclick="chatAddReaction('+msgId+',\''+e+'\',this)">'+e+'</button>'; }).join('');
  btn.parentElement.style.position = 'relative';
  btn.parentElement.appendChild(picker);
  setTimeout(function(){ document.addEventListener('click', function handler(){ picker.remove(); document.removeEventListener('click', handler); }); }, 10);
}
function chatAddReaction(msgId, emoji, btn) {
  // Visual-only reaction for now
  var picker = btn.closest('.chat-boost-picker');
  var reactions = picker.parentElement;
  picker.remove();
  var existing = reactions.querySelector('.chat-msg-react-btn[data-emoji="'+emoji+'"]');
  if (existing) {
    var cnt = existing.querySelector('.chat-msg-react-count');
    cnt.textContent = parseInt(cnt.textContent||'1') + 1;
  } else {
    var rb = document.createElement('button');
    rb.className = 'chat-msg-react-btn active';
    rb.dataset.emoji = emoji;
    rb.innerHTML = emoji + '<span class="chat-msg-react-count">1</span>';
    reactions.insertBefore(rb, reactions.querySelector('.chat-msg-boost-trigger'));
  }
}
function _chatFormatText(text) {
  if (!text) return '';
  var s = esc(text);
  // Code blocks (triple backticks) — process first to avoid inner formatting
  s = s.replace(/```\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Inline formatting
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/`(.+?)`/g, '<code>$1</code>');
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank">$1</a>');
  // Blockquotes (lines starting with >)
  s = s.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  // Numbered lists
  s = s.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // Bullet lists
  s = s.replace(/^• (.+)$/gm, '<li>$1</li>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

// --- Chat input (Trix-based) ---
function chatSetupTrix(channelId) {
  var trixEl = document.querySelector('trix-editor[input="chatTrixInput"]');
  if (!trixEl) return;

  // Enter = send, Shift+Enter = new line
  trixEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMsg(channelId);
    }
    // Typing indicator
    if (ws && ws.readyState === 1) {
      clearTimeout(typingTimeout);
      ws.send(JSON.stringify({type:'typing:start', channelId: channelId}));
      typingTimeout = setTimeout(function(){ ws.send(JSON.stringify({type:'typing:stop', channelId: channelId})); }, 2000);
    }
  });

  // Handle file attachments via Trix drag/paste
  trixEl.addEventListener('trix-attachment-add', function(e) {
    if (e.attachment.file) chatUploadTrixFile(channelId, e.attachment);
  });

  // Inject color button (same as card notes)
  if (typeof injectTrixColorButton === 'function') injectTrixColorButton(trixEl);
}

function chatUploadTrixFile(chId, attachment) {
  var fd = new FormData();
  fd.append('file', attachment.file);
  fetch('/api/chat/channels/'+chId+'/upload', {method:'POST', body: fd})
    .then(function(r){ return r.json(); })
    .then(function(uploaded) {
      // Remove from Trix editor, send as chat attachment instead
      attachment.remove();
      return fetch('/api/chat/channels/'+chId+'/messages', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
        content: '', message_type: 'attachment',
        attachment_url: uploaded.url, attachment_name: uploaded.name, attachment_mime: uploaded.mime, attachment_size: uploaded.size
      })});
    })
    .then(function(r){ return r.json(); })
    .then(function(msg) { if (msg && msg.id) appendChatMsg(msg); })
    .catch(function() { showToast('Грешка при качване', 'error'); });
}

async function sendChatMsg(chId) {
  var trixEl = document.querySelector('trix-editor[input="chatTrixInput"]');
  if (!trixEl || !trixEl.editor) return;
  var html = document.getElementById('chatTrixInput').value.trim();
  if (!html || html === '<div><br></div>' || html === '<br>') return;
  var text = _htmlToMarkdown(html);
  if (!text.trim()) return;
  var savedHtml = html;
  trixEl.editor.loadHTML('');
  try {
    var res = await fetch('/api/chat/channels/'+chId+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:text})});
    if (!res.ok) { trixEl.editor.loadHTML(savedHtml); showToast('Грешка при изпращане','error'); return; }
    var msg = await res.json();
    if (msg && msg.id) appendChatMsg(msg);
    else { trixEl.editor.loadHTML(savedHtml); showToast('Грешка при изпращане','error'); }
  } catch(err) { console.error('Chat send error:', err); trixEl.editor.loadHTML(savedHtml); showToast('Грешка при изпращане','error'); }
}
function _htmlToMarkdown(html) {
  var tmp = document.createElement('div');
  tmp.innerHTML = html;
  // Convert block elements (div, p) to newlines before inline processing
  tmp.querySelectorAll('div, p').forEach(function(el){
    el.insertAdjacentText('afterend', '\n');
  });
  // Blockquotes → > prefix
  tmp.querySelectorAll('blockquote').forEach(function(el){
    var lines = el.textContent.split('\n').map(function(l){ return '> ' + l; }).join('\n');
    el.replaceWith(lines + '\n');
  });
  // Code blocks → triple backticks
  tmp.querySelectorAll('pre').forEach(function(el){
    el.replaceWith('```\n' + el.textContent + '\n```\n');
  });
  // Links → preserve URL
  tmp.querySelectorAll('a').forEach(function(el){
    el.replaceWith(el.getAttribute('href') || el.textContent);
  });
  tmp.querySelectorAll('li').forEach(function(el){
    var parent = el.closest('ol');
    if (parent) {
      var idx = Array.from(parent.children).indexOf(el) + 1;
      el.insertAdjacentText('beforebegin', idx + '. ');
    } else {
      el.insertAdjacentText('beforebegin', '• ');
    }
    el.insertAdjacentText('afterend', '\n');
  });
  // Convert basic formatting
  tmp.querySelectorAll('b,strong').forEach(function(el){ el.replaceWith('**'+el.textContent+'**'); });
  tmp.querySelectorAll('i,em').forEach(function(el){ el.replaceWith('*'+el.textContent+'*'); });
  tmp.querySelectorAll('s,del,strike').forEach(function(el){ el.replaceWith('~~'+el.textContent+'~~'); });
  tmp.querySelectorAll('code').forEach(function(el){ el.replaceWith('`'+el.textContent+'`'); });
  tmp.querySelectorAll('br').forEach(function(el){ el.replaceWith('\n'); });
  // Clean up multiple consecutive newlines
  var text = tmp.textContent || tmp.innerText || '';
  return text.replace(/\n{3,}/g, '\n\n');
}
function appendChatMsg(msg) {
  var msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  var div = document.createElement('div');
  var chId = _activeChatChannel || 0;
  div.outerHTML; // force
  var tmp = document.createElement('div');
  tmp.innerHTML = _renderChatMessage(msg, chId);
  if (tmp.firstChild) msgs.appendChild(tmp.firstChild);
  msgs.scrollTop = msgs.scrollHeight;
}

// --- Message edit/delete ---
function chatMsgMenu(msgId, btn, channelId) {
  // Remove any existing menu
  var existing = document.querySelector('.chat-msg-dropdown');
  if (existing) { existing.remove(); return; }
  var dd = document.createElement('div');
  dd.className = 'chat-msg-dropdown';
  dd.innerHTML =
    '<button onclick="chatEditMsg('+msgId+','+channelId+')"><span>✏️</span> Редактирай</button>' +
    '<button class="chat-msg-dropdown--danger" onclick="chatDeleteMsg('+msgId+','+channelId+')"><span>🗑</span> Изтрий</button>';
  btn.parentElement.style.position = 'relative';
  btn.parentElement.appendChild(dd);
  setTimeout(function(){
    document.addEventListener('click', function handler(e) {
      if (!dd.contains(e.target) && e.target !== btn) { dd.remove(); document.removeEventListener('click', handler); }
    });
  }, 10);
}

function chatEditMsg(msgId, channelId) {
  // Close dropdown
  var dd = document.querySelector('.chat-msg-dropdown');
  if (dd) dd.remove();
  var msgEl = document.querySelector('.chat-msg[data-msg-id="'+msgId+'"]');
  if (!msgEl) return;
  var textEl = msgEl.querySelector('.chat-msg-text');
  if (!textEl) return;
  var rawContent = msgEl.getAttribute('data-msg-content') || '';
  // Save original HTML for cancel
  var originalHtml = textEl.innerHTML;
  // Replace with edit form
  textEl.innerHTML = '<textarea class="chat-msg-edit-input" rows="3">'+esc(rawContent)+'</textarea>' +
    '<div class="chat-msg-edit-actions">' +
      '<button class="chat-msg-edit-save" onclick="chatSaveEdit('+msgId+','+channelId+')">Запази</button>' +
      '<button class="chat-msg-edit-cancel" onclick="chatCancelEdit('+msgId+')">Откажи</button>' +
    '</div>';
  textEl.dataset.originalHtml = originalHtml;
  var textarea = textEl.querySelector('textarea');
  if (textarea) { textarea.focus(); textarea.setSelectionRange(textarea.value.length, textarea.value.length); }
}

async function chatSaveEdit(msgId, channelId) {
  var msgEl = document.querySelector('.chat-msg[data-msg-id="'+msgId+'"]');
  if (!msgEl) return;
  var textarea = msgEl.querySelector('.chat-msg-edit-input');
  if (!textarea) return;
  var newContent = textarea.value.trim();
  if (!newContent) return;
  try {
    var res = await fetch('/api/chat/channels/'+channelId+'/messages/'+msgId, {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ content: newContent })
    });
    if (!res.ok) { showToast('Грешка при редактиране','error'); return; }
    var updated = await res.json();
    // Re-render the message in place
    var textEl = msgEl.querySelector('.chat-msg-text');
    var editedTag = '<span class="chat-msg-edited">(редактирано)</span>';
    textEl.innerHTML = _chatFormatText(updated.content) + editedTag;
    delete textEl.dataset.originalHtml;
    msgEl.setAttribute('data-msg-content', updated.content || '');
  } catch(e) { showToast('Грешка при редактиране','error'); }
}

function chatCancelEdit(msgId) {
  var msgEl = document.querySelector('.chat-msg[data-msg-id="'+msgId+'"]');
  if (!msgEl) return;
  var textEl = msgEl.querySelector('.chat-msg-text');
  if (!textEl || !textEl.dataset.originalHtml) return;
  textEl.innerHTML = textEl.dataset.originalHtml;
  delete textEl.dataset.originalHtml;
}

async function chatDeleteMsg(msgId, channelId) {
  var dd = document.querySelector('.chat-msg-dropdown');
  if (dd) dd.remove();
  if (!confirm('Сигурен ли си, че искаш да изтриеш това съобщение?')) return;
  try {
    var res = await fetch('/api/chat/channels/'+channelId+'/messages/'+msgId, { method: 'DELETE' });
    if (!res.ok) { showToast('Грешка при изтриване','error'); return; }
    var msgEl = document.querySelector('.chat-msg[data-msg-id="'+msgId+'"]');
    if (msgEl) msgEl.remove();
  } catch(e) { showToast('Грешка при изтриване','error'); }
}

// Handle WS events for edit/delete (called from websocket.js)
function chatHandleEdited(ev) {
  if (!ev.message) return;
  var msgEl = document.querySelector('.chat-msg[data-msg-id="'+ev.message.id+'"]');
  if (!msgEl) return;
  var textEl = msgEl.querySelector('.chat-msg-text');
  if (!textEl) return;
  var editedTag = '<span class="chat-msg-edited">(редактирано)</span>';
  textEl.innerHTML = _chatFormatText(ev.message.content) + editedTag;
  msgEl.setAttribute('data-msg-content', ev.message.content || '');
}
function chatHandleDeleted(ev) {
  var msgEl = document.querySelector('.chat-msg[data-msg-id="'+ev.messageId+'"]');
  if (msgEl) msgEl.remove();
}

// --- Formatting toggle (show/hide Trix toolbar) ---
function chatToggleFormatting() {
  var wrap = document.querySelector('.chat-editor-wrap.bc-editor');
  var btn = document.querySelector('.chat-input__btn--text');
  if (!wrap) return;
  var isOpen = wrap.classList.contains('toolbar-visible');
  if (isOpen) {
    wrap.classList.remove('toolbar-visible');
    if (btn) btn.classList.remove('active');
  } else {
    wrap.classList.add('toolbar-visible');
    if (btn) btn.classList.add('active');
  }
}

// --- Emoji, GIF, files ---
function chatToggleEmoji() {
  var picker = document.getElementById('chatEmojiPicker');
  if (!picker) return;
  var isOpen = picker.classList.contains('open');
  if (isOpen) { picker.classList.remove('open'); return; }
  if (!picker.innerHTML) {
    var emojis = ['😀','😂','🤣','😊','😍','🥰','😘','🤔','😎','🤩','😤','😢','😭','🔥','❤️','👍','👎','👏','🙏','💪','🎉','🎊','✅','❌','⚡','💡','📌','🚀','⭐','💯'];
    picker.innerHTML = '<div class="chat-emoji-grid">'+emojis.map(function(e){return '<button class="chat-emoji-btn" onclick="chatInsertEmoji(\''+e+'\')">'+e+'</button>';}).join('')+'</div>';
  }
  picker.classList.add('open');
  // Close on outside click
  setTimeout(function(){ document.addEventListener('click', function handler(e) { if (!picker.contains(e.target) && !e.target.closest('.chat-input__btn')) { picker.classList.remove('open'); document.removeEventListener('click', handler); } }); }, 10);
}
function chatInsertEmoji(emoji) {
  var trixEl = document.querySelector('trix-editor[input="chatTrixInput"]');
  if (trixEl && trixEl.editor) {
    trixEl.editor.insertString(emoji);
    trixEl.focus();
  }
  var picker = document.getElementById('chatEmojiPicker');
  if (picker) picker.classList.remove('open');
}
async function chatUploadFiles(input, chId) {
  if (!input.files || !input.files.length) return;
  for (var i = 0; i < input.files.length; i++) {
    var file = input.files[i];
    var fd = new FormData();
    fd.append('file', file);
    try {
      var uploaded = await (await fetch('/api/chat/channels/'+chId+'/upload', {method:'POST', body: fd})).json();
      var msg = await (await fetch('/api/chat/channels/'+chId+'/messages', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
        content: '', message_type: 'attachment',
        attachment_url: uploaded.url, attachment_name: uploaded.name, attachment_mime: uploaded.mime, attachment_size: uploaded.size
      })})).json();
      if (msg && msg.id) appendChatMsg(msg);
    } catch {}
  }
  input.value = '';
}
// --- GIF search & send ---
var _gifSearchTimeout;
function chatToggleGif() {
  var picker = document.getElementById('chatGifPicker');
  if (!picker) return;
  var isOpen = picker.classList.contains('open');
  // Close emoji if open
  var emojiPicker = document.getElementById('chatEmojiPicker');
  if (emojiPicker) emojiPicker.classList.remove('open');
  if (isOpen) { picker.classList.remove('open'); return; }
  if (!picker.innerHTML) {
    picker.innerHTML = '<div class="gif-picker">' +
      '<div class="gif-picker__header"><input class="gif-picker__search" placeholder="Търси GIF..." oninput="chatSearchGif(this.value)"></div>' +
      '<div class="gif-picker__results" id="gifResults"><div class="gif-picker__loading">Зареждане...</div></div>' +
      '<div class="gif-picker__powered">Powered by GIPHY</div>' +
    '</div>';
    _chatDoGifSearch('');
  }
  picker.classList.add('open');
  setTimeout(function(){
    var inp = picker.querySelector('.gif-picker__search');
    if (inp) inp.focus();
    document.addEventListener('click', function handler(e) {
      if (!picker.contains(e.target) && !e.target.closest('.chat-input__btn--gif')) {
        picker.classList.remove('open');
        document.removeEventListener('click', handler);
      }
    });
  }, 10);
}
function chatSearchGif(query) {
  clearTimeout(_gifSearchTimeout);
  _gifSearchTimeout = setTimeout(function() { _chatDoGifSearch(query); }, 350);
}
async function _chatDoGifSearch(query) {
  var results = document.getElementById('gifResults');
  if (!results) return;
  results.innerHTML = '<div class="gif-picker__loading">Зареждане...</div>';
  try {
    var url = '/api/chat/gif-search?q=' + encodeURIComponent(query || '');
    var data = await (await fetch(url)).json();
    if (!data.results || !data.results.length) {
      results.innerHTML = '<div class="gif-picker__empty">Няма резултати</div>';
      return;
    }
    results.innerHTML = data.results.map(function(gif) {
      return '<img class="gif-picker__img" src="'+gif.preview+'" data-url="'+gif.url+'" onclick="chatSendGif(\''+gif.url.replace(/'/g,"\\'")+'\')" title="'+esc(gif.title || '')+'" loading="lazy">';
    }).join('');
  } catch(e) {
    console.error('[gif-search]', e);
    results.innerHTML = '<div class="gif-picker__empty">Грешка при търсене</div>';
  }
}
async function chatSendGif(gifUrl) {
  var chId = _activeChatChannel;
  if (!chId) return;
  var picker = document.getElementById('chatGifPicker');
  if (picker) picker.classList.remove('open');
  try {
    var msg = await (await fetch('/api/chat/channels/'+chId+'/messages', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        content: '', message_type: 'attachment',
        attachment_url: gifUrl, attachment_name: 'GIF', attachment_mime: 'image/gif'
      })
    })).json();
    if (msg && msg.id) appendChatMsg(msg);
  } catch(e) {
    showToast('Грешка при изпращане на GIF', 'error');
  }
}

// --- Group settings ---
async function chatGroupSettings(channelId) {
  try {
    var channels = await (await fetch('/api/chat/channels')).json();
    var ch = channels.find(function(c){return c.id===channelId});
    if (!ch) return;
    var name = _chatChannelName(ch);
    var members = ch.members || [];
    var ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'chatSettingsModal';
    ov.innerHTML = '<div class="confirm-modal-box" style="max-width:440px" onclick="event.stopPropagation()">'+
      '<p class="confirm-modal-msg">Настройки на групата</p>'+
      '<div style="margin-bottom:16px"><label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Име на групата</label>'+
      '<div style="display:flex;gap:8px"><input id="chatGrpName" class="confirm-modal-input" value="'+esc(name)+'" style="margin-bottom:0;flex:1"><button class="btn btn-primary btn-sm" onclick="chatRenameSave('+channelId+')">Запази</button></div></div>'+
      '<div style="margin-bottom:16px"><label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px">Снимка на групата</label>'+
      '<div style="display:flex;align-items:center;gap:12px"><div class="chat-hd__av" style="width:48px;height:48px;font-size:18px">'+_chatAvatar(ch)+'</div>'+
      '<label class="btn btn-sm" style="cursor:pointer">Избери снимка<input type="file" accept="image/*" style="display:none" onchange="chatUploadGroupAvatar(this,'+channelId+')"></label></div></div>'+
      '<div style="margin-bottom:16px"><label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:8px">Участници ('+members.length+')</label>'+
      '<div id="chatGrpMembers">'+members.map(function(m){
        var av = m.avatar_url ? '<img src="'+m.avatar_url+'" style="width:32px;height:32px;border-radius:50%;object-fit:cover">' : '<div class="chat-av-initials" style="background:'+_chatColor(m.id)+';width:32px;height:32px;font-size:11px">'+initials(m.name)+'</div>';
        return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0">'+ av +'<span style="flex:1;font-size:14px">'+esc(m.name)+(m.id===ch.created_by?' <span style="color:var(--text-dim);font-size:11px">(създател)</span>':'')+'</span>'+
        (m.id!==currentUser.id && m.id!==ch.created_by ? '<button class="btn btn-sm" style="color:var(--red);font-size:11px" onclick="chatRemoveMember('+channelId+','+m.id+',\''+esc(m.name).replace(/'/g,"\\'")+'\')">Премахни</button>' : '')+
        '</div>';
      }).join('')+'</div>'+
      '<div style="margin-top:8px"><input id="chatAddMemberInput" class="confirm-modal-input" placeholder="Добави човек..." oninput="chatAddMemberFilter()" style="margin-bottom:4px">'+
      '<div id="chatAddMemberSuggestions" style="max-height:120px;overflow-y:auto"></div></div></div>'+
      '<div class="confirm-modal-actions"><button class="btn btn-ghost" style="color:var(--red)" onclick="chatLeaveGroup('+channelId+')">Напусни групата</button>'+
      '<button class="btn btn-ghost" onclick="this.closest(\'.modal-overlay\').remove()">Затвори</button></div>'+
    '</div>';
    document.body.appendChild(ov);
    ov.onclick = function(e){if(e.target===ov)ov.remove()};
  } catch {}
}
async function chatRenameSave(chId) {
  var name = document.getElementById('chatGrpName')?.value?.trim();
  if (!name) return;
  try {
    await fetch('/api/chat/channels/'+chId, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:name})});
    showToast('Групата е преименувана','success');
    document.getElementById('chatSettingsModal')?.remove();
    router();
  } catch {}
}
async function chatUploadGroupAvatar(input, chId) {
  if (!input.files[0]) return;
  var fd = new FormData(); fd.append('avatar', input.files[0]);
  try {
    await fetch('/api/chat/channels/'+chId+'/avatar', {method:'POST', body: fd});
    showToast('Снимката е сменена','success');
    document.getElementById('chatSettingsModal')?.remove();
    router();
  } catch {}
}
window.chatAddMemberFilter = function() {
  var q = (document.getElementById('chatAddMemberInput')?.value||'').toLowerCase().trim();
  var el = document.getElementById('chatAddMemberSuggestions');
  if (!el || !q) { if(el)el.innerHTML=''; return; }
  var existing = [];
  document.querySelectorAll('#chatGrpMembers [data-uid]').forEach(function(m){existing.push(parseInt(m.dataset.uid))});
  var filtered = allUsers.filter(function(u){return u.id!==currentUser.id && u.name.toLowerCase().indexOf(q)!==-1});
  el.innerHTML = filtered.map(function(u){
    return '<div class="pings-dd__sug-item" onclick="chatAddMember(_activeChatChannel,'+u.id+')"><span>'+esc(u.name)+'</span></div>';
  }).join('');
};
async function chatAddMember(chId, userId) {
  try {
    await fetch('/api/chat/channels/'+chId+'/members', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({user_id:userId})});
    showToast('Добавен','success');
    document.getElementById('chatSettingsModal')?.remove();
    router();
  } catch {}
}
async function chatRemoveMember(chId, userId, name) {
  if (!confirm('Премахни '+name+' от групата?')) return;
  try {
    await fetch('/api/chat/channels/'+chId+'/members/'+userId, {method:'DELETE'});
    showToast(name+' е премахнат','success');
    document.getElementById('chatSettingsModal')?.remove();
    router();
  } catch {}
}
async function chatLeaveGroup(chId) {
  if (!confirm('Напусни тази група?')) return;
  try {
    await fetch('/api/chat/channels/'+chId+'/members/'+currentUser.id, {method:'DELETE'});
    showToast('Напусна групата','success');
    document.getElementById('chatSettingsModal')?.remove();
    location.hash = '#/chat';
  } catch {}
}

// ==================== MESSAGE BOARD ====================
async function renderCampfire(el, roomId) {
  setBreadcrumb([{label:'🔥 Campfire',href:`#/campfire/${roomId}`}]);
  el.className = '';
  try {
    const msgs = await (await fetch(`/api/campfire/rooms/${roomId}/messages?limit=100`)).json();
    const campColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];
    el.innerHTML = `
      <div class="chat-page">
        <div class="chat-header">
          <span style="font-size:24px">🔥</span>
          <h2>Campfire</h2>
          <span style="color:var(--text-dim);font-size:12px;margin-left:auto">${onlineUsers.size} онлайн</span>
        </div>
        <div class="chat-messages" id="campfireMessages">
          ${msgs.length === 0 ? '<div style="text-align:center;color:var(--text-dim);padding:40px">🔥 Добре дошли в Campfire!<br>Тук целият екип може да говори.</div>' : ''}
          ${msgs.map(m => {
            const isSystem = !m.user_id;
            const mc = isSystem ? '#1a3040' : (m.user_avatar ? 'none' : campColors[(m.user_name||'').length % campColors.length]);
            const avatarContent = isSystem ? '📊' : _avInner(m.user_name, m.user_avatar);
            const msgContent = parseCampfireMarkdown(m.content || '');
            return `<div class="chat-msg${isSystem ? ' campfire-system-msg' : ''}">
              <div class="chat-msg-avatar" style="background:${mc};color:#fff">${avatarContent}</div>
              <div class="chat-msg-body">
                <div class="chat-msg-name">${esc(m.user_name || 'Система')} <span class="hint">${new Date(m.created_at).toLocaleTimeString('bg',{hour:'2-digit',minute:'2-digit'})}</span></div>
                <div class="chat-msg-text">${msgContent}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
        <div id="campfireTyping" style="font-size:11px;color:var(--text-dim);padding:0 4px;min-height:18px"></div>
        <div class="chat-input-row">
          <textarea id="campfireInput" placeholder="Напиши на екипа..." rows="2"
            oninput="sendTypingIndicator('campfire',${roomId})"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendCampfireMsg(${roomId})}"></textarea>
          <button class="btn btn-primary" onclick="sendCampfireMsg(${roomId})">Изпрати</button>
        </div>
      </div>`;
    const m = document.getElementById('campfireMessages'); if(m) m.scrollTop = m.scrollHeight;
  } catch { el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-dim)">Грешка при зареждане</div>'; }
}
function parseCampfireMarkdown(text) {
  return esc(text)
    .replace(/\n/g, '<br>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}
async function sendCampfireMsg(roomId) {
  const i = document.getElementById('campfireInput'), c = i?.value?.trim(); if(!c) return;
  i.value = '';
  try {
    const res = await fetch(`/api/campfire/rooms/${roomId}/messages`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:c})});
    const msg = await res.json();
    if (msg && msg.id) appendCampfireMsg(msg);
  } catch {}
}
function appendCampfireMsg(msg) {
  const msgs = document.getElementById('campfireMessages');
  if (!msgs) return;
  const isSystem = !msg.user_id;
  const mc = isSystem ? '#1a3040' : (msg.user_avatar ? 'none' : _avColor(msg.user_name));
  const avatarContent = isSystem ? '📊' : _avInner(msg.user_name, msg.user_avatar);
  const msgContent = parseCampfireMarkdown(msg.content || '');
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isSystem ? ' campfire-system-msg' : '');
  div.innerHTML = '<div class="chat-msg-avatar" style="background:' + mc + ';color:#fff">' + avatarContent + '</div>' +
    '<div class="chat-msg-body"><div class="chat-msg-name">' + esc(msg.user_name || 'Система') +
    ' <span class="hint">' + new Date(msg.created_at).toLocaleTimeString('bg',{hour:'2-digit',minute:'2-digit'}) + '</span></div>' +
    '<div class="chat-msg-text">' + msgContent + '</div></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}
function sendTypingIndicator(type, id) {
  if (!ws || ws.readyState !== 1) return;
  clearTimeout(typingTimeout);
  const key = type === 'campfire' ? 'roomId' : 'channelId';
  ws.send(JSON.stringify({type:'typing:start', [key]: id}));
  typingTimeout = setTimeout(() => {
    if (ws?.readyState === 1) ws.send(JSON.stringify({type:'typing:stop', [key]: id}));
  }, 2000);
}

