const { WebSocketServer } = require('ws');
const { verifyFromCookieHeader } = require('../middleware/auth');

let wss = null;
const clients = new Map(); // userId -> Set<ws>

function setupWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const user = verifyFromCookieHeader(req.headers.cookie);
    if (!user) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    ws.userId = user.userId;
    ws.userName = user.name;
    ws.isAlive = true;

    if (!clients.has(ws.userId)) clients.set(ws.userId, new Set());
    clients.get(ws.userId).add(ws);

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => {
      const userSockets = clients.get(ws.userId);
      if (userSockets) {
        userSockets.delete(ws);
        if (userSockets.size === 0) clients.delete(ws.userId);
      }
    });
  });

  // Heartbeat every 30s
  setInterval(() => {
    if (!wss) return;
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  console.log('  WebSocket server ready on /ws');
}

// Broadcast event to all connected clients (except excludeUserId)
function broadcast(event, excludeUserId = null) {
  if (!wss) return;
  const message = JSON.stringify(event);
  for (const [userId, sockets] of clients) {
    if (userId === excludeUserId) continue;
    for (const ws of sockets) {
      if (ws.readyState === 1) {
        try { ws.send(message); } catch {}
      }
    }
  }
}

// Send to specific user
function sendToUser(userId, event) {
  const sockets = clients.get(userId);
  if (!sockets) return;
  const message = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === 1) {
      try { ws.send(message); } catch {}
    }
  }
}

function getConnectedCount() {
  let count = 0;
  for (const sockets of clients.values()) count += sockets.size;
  return count;
}

module.exports = { setupWebSocket, broadcast, sendToUser, getConnectedCount };
