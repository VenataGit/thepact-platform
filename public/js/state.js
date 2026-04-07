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
