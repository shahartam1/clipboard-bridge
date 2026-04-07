import { useState } from "react";
import { useAppStore } from "../store/appStore";
import "./SendView.css";

export default function SendView() {
  const peers      = useAppStore(s => s.peers);
  const sendClip   = useAppStore(s => s.sendClip);
  const sendStatus = useAppStore(s => s.sendStatus);
  const [text, setText] = useState("");
  const [selectedPeer, setSelectedPeer] = useState<string>("");
  const [lastMsgId, setLastMsgId] = useState<string | null>(null);

  function handleSend() {
    if (!text.trim() || !selectedPeer) return;
    sendClip(selectedPeer, text.trim(), text.startsWith("http") ? "url" : "text");
    setText("");
  }

  // Dev-only: quick test button — auto-fills and sends to first peer
  function handleTestSend() {
    const firstPeer = peers[0];
    if (!firstPeer) return;
    const testMsg = "🧪 Test from ClipBridge @ " + new Date().toLocaleTimeString();
    console.log("[TEST] Sending to", firstPeer.id, firstPeer.name);
    sendClip(firstPeer.id, testMsg, "text");
  }

  const status = lastMsgId ? sendStatus[lastMsgId] : null;

  return (
    <div>
      <h2 className="view-title">Send Clipboard</h2>

      {peers.length === 0 ? (
        <div className="card empty-state">
          <p>No paired devices yet.</p>
          <p className="muted">Go to <strong>Pair</strong> to connect a device.</p>
        </div>
      ) : (
        <div className="card">
          <div className="peer-selector">
            <label className="field-label">Send to</label>
            <div className="peer-chips">
              {peers.map(peer => (
                <button
                  key={peer.id}
                  className={`chip ${selectedPeer === peer.id ? "selected" : ""}`}
                  onClick={() => setSelectedPeer(peer.id)}
                >
                  {peer.name}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label">Content</label>
            <textarea
              className="text-input"
              placeholder="Paste text or a URL here…"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && e.metaKey) handleSend(); }}
              rows={5}
            />
          </div>

          <div className="send-row">
            <button
              className="btn-primary"
              onClick={handleSend}
              disabled={!text.trim() || !selectedPeer}
            >
              Send  ⌘↵
            </button>
            {import.meta.env.DEV && peers.length > 0 && (
              <button
                className="btn-ghost"
                style={{ marginLeft: 8, fontSize: 12 }}
                onClick={handleTestSend}
                title="Dev only: auto-send test message to first peer"
              >
                🧪 Test Send
              </button>
            )}
            {status === "sending"   && <span className="status-hint">Sending…</span>}
            {status === "delivered" && <span className="status-hint green">✓ Delivered</span>}
            {status === "offline"   && <span className="status-hint red">Device offline</span>}
          </div>
        </div>
      )}

    </div>
  );
}
