// ==================== AUTH ====================
async function checkAuth() {
  try {
    const res = await fetch('/auth/status');
    if (!res.ok) throw new Error();
    currentUser = (await res.json()).user;
    document.getElementById('navAvatar').innerHTML = _avInner(currentUser.name, currentUser.avatar_url);
    // Cache essential user info so the nav bootstrap script (in index.html) can
    // pre-populate the avatar on next reload — prevents the flash of an empty
    // avatar circle before JS finishes loading.
    try {
      localStorage.setItem('thepact-user', JSON.stringify({
        name: currentUser.name,
        avatar_url: currentUser.avatar_url || null,
        role: currentUser.role,
      }));
    } catch (e) { /* quota / private mode */ }
    try { allUsers = await (await fetch('/api/users/team')).json(); } catch {}
    try { allBoards = await (await fetch('/api/boards')).json(); } catch {}
    updateHeyBadge();
    updatePingsBadge();
    return true;
  } catch { window.location.href = '/login.html'; return false; }
}
function canManage() { return currentUser?.role === 'admin' || currentUser?.role === 'moderator'; }
function canEdit() { return !!currentUser; }
async function logout() {
  try { localStorage.removeItem('thepact-user'); } catch (e) {}
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}
