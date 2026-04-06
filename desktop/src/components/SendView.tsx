import { useState } from "react";
import { useAppStore } from "../store/appStore";
import "./SendView.css";

export default function SendView() {
  const peers      = useAppStore(s => s.peers);
  const sendClip   = useAppStore(s => s.sendClip);
  const sendStatus = useAppStore(s => s.sendStatus);
  const clipHistory = useAppStore(s => s.clipHistory);
  const copyToClipboard = useAppStore(s => s.copyToClipboard);
  const dismissClip = useAppStore(s => s.dismissClip);

  const [text, setText] = useState("");
  const [selectedPeer, setSelectedPeer] = useState<string>("");
  const [lastMsgId, setLastMsgId] = useState<string | null>(null);

  function handleSend() {
    if (!text.trim() || !selectedPeer) return;
    const msgId = crypto.randomUUID();
    sendClip(selectedPeer, text.trim(), text.startsWith("http") ? "url" : "text");
    setLastMsgId(msgId);
    setText("");
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
            {status === "sending"   && <span className="status-hint">Sending…</span>}
            {status === "delivered" && <span className="status-hint green">✓ Delivered</span>}
            {status === "offline"   && <span className="status-hint red">Device offline</span>}
          </div>
        </div>
      )}

      {clipHistory.length > 0 && (
        <>
          <h3 className="section-title">Received</h3>
          {clipHistory.map(item => (
            <div key={item.id} className="card clip-card">
              <div className="clip-meta">
                <span className="clip-from">{item.fromName}</span>
                <span className="clip-time">{new Date(item.receivedAt).toLocaleTimeString()}</span>
              </div>
              <p className="clip-content">{item.content}</p>
              <div className="clip-actions">
                <button className="btn-ghost" onClick={() => copyToClipboard(item.content)}>
                  Copy
                </button>
                {item.dataType === "url" && (
                  <button className="btn-ghost" onClick={() => window.open(item.content, "_blank")}>
                    Open URL
                  </button>
                )}
                <button className="btn-ghost" onClick={() => dismissClip(item.id)}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
