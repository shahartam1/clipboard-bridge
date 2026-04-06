/**
 * WebSocket client — connects to the signaling/relay server.
 * Auto-reconnects with exponential backoff.
 * Singleton: only one handler can be registered (the store).
 * This prevents duplicate handlers on Vite HMR reloads.
 */

type MessageHandler = (msg: Record<string, unknown>) => void;

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:8787";

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let handler: MessageHandler | null = null;  // single handler, not an array
let registrationPayload: Record<string, unknown> | null = null;
let initialized = false;

export function onMessage(h: MessageHandler) {
  handler = h; // always replaces — no duplicates on HMR
}

function dispatch(msg: Record<string, unknown>) {
  handler?.(msg);
}

export function connect(
  deviceId: string,
  deviceName: string,
  publicKey: string,
  peerIds: string[] = [],
) {
  // Guard: only connect once per app session (HMR-safe)
  if (initialized) {
    registrationPayload = { type: "REGISTER", deviceId, deviceName, publicKey, peerIds };
    return;
  }
  initialized = true;
  registrationPayload = { type: "REGISTER", deviceId, deviceName, publicKey, peerIds };
  _connect();
}

function _connect() {
  if (ws) { ws.onclose = null; ws.close(); }

  ws = new WebSocket(SERVER_URL);

  ws.onopen = () => {
    reconnectDelay = 1000;
    console.log('[ws] connected to', SERVER_URL);
    if (registrationPayload) {
      console.log('[ws] → sending REGISTER', registrationPayload);
      ws!.send(JSON.stringify(registrationPayload));
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      console.log('[ws] ← received', msg.type, msg);
      dispatch(msg);
    } catch { /* ignore malformed */ }
  };

  ws.onclose = (e) => {
    console.warn('[ws] disconnected — code:', e.code, 'reason:', e.reason, '— reconnecting in', reconnectDelay, 'ms');
    dispatch({ type: "DISCONNECTED" });
    setTimeout(_connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  };

  ws.onerror = (e) => {
    console.error('[ws] socket error', e);
    ws?.close();
  };
}

export function sendMsg(payload: Record<string, unknown>) {
  const state = ws?.readyState;
  console.log('[ws] sendMsg', payload.type, '| readyState:', state,
    '| OPEN=', WebSocket.OPEN, '| isOpen:', state === WebSocket.OPEN);
  if (state === WebSocket.OPEN) {
    ws!.send(JSON.stringify(payload));
    console.log('[ws] sendMsg sent ✓', payload.type);
  } else {
    console.error('[ws] sendMsg DROPPED — ws not open. state:', state,
      '(0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)');
  }
}

export function isConnected() {
  return ws?.readyState === WebSocket.OPEN;
}
