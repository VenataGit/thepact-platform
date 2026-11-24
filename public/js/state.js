// ==================== GLOBAL STATE ====================
// Споделено състояние между всички feature модули.
// Зарежда се ПЪРВИ в <script> реда в index.html.
let currentUser = null, ws = null, wsReconnectDelay = 1000;
let allUsers = [], allBoards = [], allProjects = [];
let onlineUsers = new Set();
let _platformConfig = {};
let pendingShortcut = null, typingTimeout = null;

// Avatar color palette (shared)
var _avColors = ['#2da562','#e8912d','#3b82f6','#ef4444','#a855f7','#eab308','#06b6d4','#ec4899'];

// Влачене: обща защита (беше в kanban.js до чистенето на 24.11.2026; sos.js и websocket.js я ползват).
let dragCardId = null;
function _clearAllDragOver() {
  document.querySelectorAll('.drag-over, .col-drag-over, .dash-drop-over').forEach(function(el) {
    el.classList.remove('drag-over', 'col-drag-over', 'dash-drop-over');
  });
  document.querySelectorAll('.dragging').forEach(function(el) { el.classList.remove('dragging'); });
}
