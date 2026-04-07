/**
 * WebSocket client — connects to the signaling/relay server.
 * Auto-reconnects with exponential backoff.
 *
 * IMPORTANT: All mutable state lives on `window.__cb*` so that Vite HMR
 * module reloads don't create duplicate connections or lose the socket reference.
 * Each HMR reload re-executes this file, but window-level vars survive.
 */

type MessageHandler = (msg: Record<string, unknown>) => void;

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:8787";
const HTTP_URL = SERVER_URL.replace(/^ws/, 'http');

// ── Window-level singleton state (survives Vite HMR reloads) ─────────────────
declare global {
  interface Window {
    __cbWs: WebSocket | null;
    __cbInitialized: boolean;
    __cbReconnectDelay: number;
    __cbRegistration: Record<string, unknown> | null;
    __cbHandler: MessageHandler | null;
  }
}

if (window.__cbInitialized === undefined) {
  window.__cbWs = null;
  window.__cbInitialized = false;
  window.__cbReconnectDelay = 1000;
  window.__cbRegistration = null;
  window.__cbHandler = null;
}

// Helpers — always read/write through window
function getWs()   { return window.__cbWs; }
function setWs(v: WebSocket | null) { window.__cbWs = v; }

function remoteLog(data: Record<string, unknown>) {
  fetch(`${HTTP_URL}/debug-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(() => {});
}

// ── Public API ────────────────────────────────────────────────────────────────

export function onMessage(h: MessageHandler) {
  window.__cbHandler = h; // always replaces — no duplicates on HMR
}

function dispatch(msg: Record<string, unknown>) {
  window.__cbHandler?.(msg);
}

export function connect(
  deviceId: string,
  deviceName: string,
  publicKey: string,
  peerIds: string[] = [],
) {
  // Update registration payload every time (peerIds might change)
  window.__cbRegistration = { type: 'REGISTER', deviceId, deviceName, publicKey, peerIds };

  if (window.__cbInitialized) {
    console.log('[ws] already initialized — skipping duplicate connect(). HMR-safe.');
    // If socket is open, re-register immediately (e.g., if peerIds changed)
    const ws = getWs();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(window.__cbRegistration));
    }
    return;
  }

  window.__cbInitialized = true;
  _connect();
}

function _connect() {
  const old = getWs();
  if (old) { old.onclose = null; old.close(); }

  const ws = new WebSocket(SERVER_URL);
  setWs(ws);

  ws.onopen = () => {
    window.__cbReconnectDelay = 1000;
    console.log('[ws] connected to', SERVER_URL);
    remoteLog({ event: 'ws_connected', url: SERVER_URL });
    if (window.__cbRegistration) {
      console.log('[ws] → REGISTER', window.__cbRegistration);
      ws.send(JSON.stringify(window.__cbRegistration));
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      console.log('[ws] ← received', msg.type, msg);
      if (msg.type === 'ERROR') {
        remoteLog({ event: 'ws_server_error', error: msg.error });
      }
      dispatch(msg);
    } catch { /* ignore malformed */ }
  };

  ws.onclose = (e) => {
    console.warn('[ws] disconnected — code:', e.code, '— reconnecting in', window.__cbReconnectDelay, 'ms');
    remoteLog({ event: 'ws_closed', code: e.code });
    dispatch({ type: 'DISCONNECTED' });
    setTimeout(_connect, window.__cbReconnectDelay);
    window.__cbReconnectDelay = Math.min(window.__cbReconnectDelay * 2, 30_000);
  };

  ws.onerror = (e) => {
    console.error('[ws] socket error', e);
    remoteLog({ event: 'ws_error' });
    ws.close();
  };
}

export function sendMsg(payload: Record<string, unknown>) {
  const ws = getWs();
  const state = ws?.readyState;
  const isOpen = state === WebSocket.OPEN;
  console.log('[ws] sendMsg', payload.type, '| readyState:', state, '| isOpen:', isOpen);
  remoteLog({ event: 'sendMsg', type: payload.type, to: payload.to ?? null, readyState: state, isOpen });

  if (isOpen) {
    ws!.send(JSON.stringify(payload));
    console.log('[ws] sendMsg sent ✓', payload.type);
    remoteLog({ event: 'sendMsg_ok', type: payload.type });
  } else {
    console.error('[ws] sendMsg DROPPED — state:', state, '(0=CONNECTING 1=OPEN 2=CLOSING 3=CLOSED)');
    remoteLog({ event: 'sendMsg_DROPPED', type: payload.type, state });
  }
}

export function isConnected() {
  return getWs()?.readyState === WebSocket.OPEN;
}
