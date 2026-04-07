// ==================== AUTH ====================
async function checkAuth() {
  try {
    const res = await fetch('/auth/status');
    if (!res.ok) throw new Error();
    currentUser = (await res.json()).user;
    document.getElementById('navAvatar').innerHTML = _avInner(currentUser.name, currentUser.avatar_url);
    try { allUsers = await (await fetch('/api/users/team')).json(); } catch {}
    try { allBoards = await (await fetch('/api/boards')).json(); } catch {}
    updateHeyBadge();
    updatePingsBadge();
    return true;
  } catch { window.location.href = '/login.html'; return false; }
}
function canManage() { return currentUser?.role === 'admin' || currentUser?.role === 'moderator'; }
function canEdit() { return !!currentUser; }
async function logout() { await fetch('/auth/logout', { method: 'POST' }); window.location.href = '/login.html'; }
