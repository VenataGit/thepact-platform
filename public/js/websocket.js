// ==================== PROFILE ====================
async function openProfile() { const m=document.getElementById('profileModal'); m.style.display='flex'; try{ const u=await(await fetch('/api/profile')).json(); const av=document.getElementById('profileAvatar'); if(u.avatar_url)av.innerHTML=`<img src="${u.avatar_url}" style="width:100%;height:100%;object-fit:cover">`; else av.textContent=initials(u.name); document.getElementById('profileName').textContent=u.name; document.getElementById('profileEmail').textContent=u.email; document.getElementById('profileRole').innerHTML=u.role==='admin'?'<span class="badge badge-accent">АДМИН</span>':u.role==='moderator'?'<span class="badge badge-blue">МОДЕРАТОР</span>':'<span class="badge">ЧЛЕН</span>'; document.getElementById('profileNameInput').value=u.name; }catch{} }
function closeProfile() { document.getElementById('profileModal').style.display='none'; }
async function saveProfileName() { const n=document.getElementById('profileNameInput').value.trim(); if(!n)return; try{const u=await(await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n})})).json(); document.getElementById('profileName').textContent=u.name; document.getElementById('navAvatar').innerHTML=_avInner(u.name, u.avatar_url); currentUser.name=u.name; showToast('\u0418\u043c\u0435\u0442\u043e \u0435 \u0437\u0430\u043f\u0430\u0437\u0435\u043d\u043e', 'success');}catch{ showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u0437\u0430\u043f\u0430\u0437\u0432\u0430\u043d\u0435', 'error'); } }
async function uploadAvatar(input) { if(!input.files[0])return; const f=new FormData(); f.append('avatar',input.files[0]); try{const u=await(await fetch('/api/profile/avatar',{method:'POST',body:f})).json(); document.getElementById('profileAvatar').innerHTML=`<img src="${u.avatar_url}" style="width:100%;height:100%;object-fit:cover">`; document.getElementById('navAvatar').innerHTML=_avInner(u.name, u.avatar_url); currentUser.avatar_url=u.avatar_url; showToast('\u0410\u0432\u0430\u0442\u0430\u0440\u044a\u0442 \u0435 \u0441\u043c\u0435\u043d\u0435\u043d', 'success');}catch{ showToast('\u0413\u0440\u0435\u0448\u043a\u0430 \u043f\u0440\u0438 \u043a\u0430\u0447\u0432\u0430\u043d\u0435 \u043d\u0430 \u0430\u0432\u0430\u0442\u0430\u0440', 'error'); } }
async function changePassword() { const msg=document.getElementById('pwdMsg'),c=document.getElementById('currentPwd').value,n=document.getElementById('newPwd').value; if(!c||!n){msg.textContent='Попълни и двете полета';msg.style.color='var(--red)';return;} try{const r=await fetch('/api/profile/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:c,newPassword:n})}); const d=await r.json(); if(r.ok){msg.textContent='Сменена';msg.style.color='var(--green)';}else{msg.textContent=d.error;msg.style.color='var(--red)';}}catch{msg.textContent='Грешка';msg.style.color='var(--red)';} }
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeProfile();closeAddColumnModal();}});
document.getElementById('profileModal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)closeProfile()});

// ==================== WEBSOCKET ====================
function connectWS() { const p=location.protocol==='https:'?'wss':'ws'; ws=new WebSocket(`${p}://${location.host}/ws`); ws.onopen=()=>{wsReconnectDelay=1000;document.getElementById('wsStatusDot').className='status-dot online';document.getElementById('wsStatus').textContent='live'}; ws.onmessage=e=>{try{handleWSEvent(JSON.parse(e.data))}catch{}}; ws.onclose=()=>{document.getElementById('wsStatusDot').className='status-dot offline';document.getElementById('wsStatus').textContent='';setTimeout(connectWS,wsReconnectDelay);wsReconnectDelay=Math.min(wsReconnectDelay*2,30000)}; ws.onerror=()=>ws.close(); }
let _wsRouterTimeout = null;
let _suppressWsRerender = 0;
function wsRouter() {
  if (Date.now() < _suppressWsRerender) return;
  if (dragCardId) return; // never re-render while a drag is active
  clearTimeout(_wsRouterTimeout);
  _wsRouterTimeout = setTimeout(router, 150);
}
function handleWSEvent(ev) {
  const t = ev.type || '';
  // Card editing presence — handle without re-render
  if (t === 'card:editing') {
    cardEditingPresence.set(ev.cardId, { userId: ev.userId, userName: ev.userName });
    updateCardEditingBanner(ev.cardId);
    return;
  }
  if (t === 'card:editing:stop') {
    cardEditingPresence.delete(ev.cardId);
    updateCardEditingBanner(ev.cardId);
    return;
  }
  if (t === 'sos:alert') { showSosAlert(ev); return; }
  if (t === 'sos:resolved') { document.querySelectorAll('.sos-alert-banner[data-alert-id="' + ev.alertId + '"]').forEach(function(b) { b.remove(); }); return; }
  // Live-update Production Calendar when a card is moved (Post-Production checkmark)
  if (t === 'card:moved' && location.hash === '#/calendar' && typeof _pcLoadEntries === 'function') {
    _pcLoadEntries().then(function() { _pcRefreshWeekView(); });
  }
  // Core data events — re-render current page
  if (t.startsWith('card:') || t.startsWith('board:') || t.startsWith('column:') || t.startsWith('step:') || t.startsWith('comment:')) wsRouter();
  if (t === 'chat:message') { updatePingsBadge(); if (location.hash.startsWith('#/chat/' + ev.channelId)) { if (ev.message) appendChatMsg(ev.message); fetch('/api/chat/channels/'+ev.channelId+'/read',{method:'PUT'}).catch(function(){}); } return; }
  if (t === 'chat:channel:updated' || t === 'chat:member:added' || t === 'chat:member:removed') { if (location.hash.startsWith('#/chat')) wsRouter(); return; }
  if (t === 'campfire:message' && location.hash.startsWith('#/campfire/')) { if (ev.message) appendCampfireMsg(ev.message); return; }
  if (t === 'checkin:reminder') wsRouter();
  // Presence
  if (t === 'presence:online') { onlineUsers.add(ev.userId); updatePresenceDots(); }
  if (t === 'presence:offline') { onlineUsers.delete(ev.userId); updatePresenceDots(); }
  // Typing indicators
  if (t === 'typing:start') showTypingIndicator(ev);
  if (t === 'typing:stop') hideTypingIndicator(ev);
  updateHeyBadge();
}
function updatePresenceDots() {
  document.querySelectorAll('[data-user-id]').forEach(el => {
    const dot = el.querySelector('.presence-dot');
    if (dot) dot.className = `presence-dot ${onlineUsers.has(parseInt(el.dataset.userId)) ? 'online' : ''}`;
  });
}
function showTypingIndicator(ev) {
  const el = document.getElementById('campfireTyping') || document.getElementById('chatTyping');
  if (el) el.textContent = `${ev.userName || 'Някой'} пише...`;
  clearTimeout(window._typingClearTimeout);
  window._typingClearTimeout = setTimeout(() => { if (el) el.textContent = ''; }, 3000);
}
function hideTypingIndicator(ev) {
  const el = document.getElementById('campfireTyping') || document.getElementById('chatTyping');
  if (el) el.textContent = '';
}
