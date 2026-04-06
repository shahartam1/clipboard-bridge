/**
 * WebSocket client — connects to the signaling/relay server.
 * Auto-reconnects with exponential backoff.
 */

type MessageHandler = (msg: Record<string, unknown>) => void;

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:8787";

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let handlers: MessageHandler[] = [];
let registrationPayload: Record<string, string> | null = null;

export function onMessage(handler: MessageHandler) {
  handlers.push(handler);
  return () => { handlers = handlers.filter(h => h !== handler); };
}

function dispatch(msg: Record<string, unknown>) {
  handlers.forEach(h => h(msg));
}

export function connect(deviceId: string, deviceName: string, publicKey: string) {
  registrationPayload = { type: "REGISTER", deviceId, deviceName, publicKey };
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
