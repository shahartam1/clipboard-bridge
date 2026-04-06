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
    if (registrationPayload) ws!.send(JSON.stringify(registrationPayload));
  };

  ws.onmessage = (event) => {
    try {
      dispatch(JSON.parse(event.data as string));
    } catch { /* ignore malformed */ }
  };

  ws.onclose = () => {
    dispatch({ type: "DISCONNECTED" });
    setTimeout(_connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  };

  ws.onerror = () => ws?.close();
}

export function sendMsg(payload: Record<string, unknown>) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function isConnected() {
  return ws?.readyState === WebSocket.OPEN;
}
