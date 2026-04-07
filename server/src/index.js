import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { registry } from './registry.js';
import { handleMessage } from './router.js';
import { log } from './logger.js';

const PORT = parseInt(process.env.PORT || '8787');

const httpServer = createServer((req, res) => {
  // CORS for debug endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.writeHead(204).end();
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', devices: registry.count() }));

  } else if (req.url === '/debug-log' && req.method === 'POST') {
    // Client posts log messages here so we can see them in server stdout
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const entry = JSON.parse(body);
        log('info', 'client_log', entry);
      } catch {
        log('info', 'client_log', { raw: body.slice(0, 200) });
      }
      res.writeHead(204).end();
    });

  } else {
    res.writeHead(404).end();
  }
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  ws.id = null;
  log('info', 'ws_open', { ip: req.socket.remoteAddress });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString('utf8'));
      handleMessage(ws, msg);
    } catch {
      ws.send(JSON.stringify({ type: 'ERROR', error: 'invalid_json' }));
    }
  });

  ws.on('close', (code) => {
    if (ws.id) {
      registry.unregister(ws.id);
      log('info', 'ws_close', { deviceId: ws.id, code });
    }
  });

  ws.on('error', (err) => log('error', 'ws_error', { message: err.message }));

  // Heartbeat — drop dead connections
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Ping all clients every 30s, drop any that haven't responded
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30_000);

wss.on('close', () => clearInterval(interval));

httpServer.listen(PORT, () => {
  log('info', 'server_start', { port: PORT });
});
