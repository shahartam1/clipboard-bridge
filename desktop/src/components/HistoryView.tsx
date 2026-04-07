import { open } from "@tauri-apps/plugin-shell";
import { useAppStore } from "../store/appStore";
import "./HistoryView.css";

export default function HistoryView() {
  const clipHistory      = useAppStore(s => s.clipHistory);
  const copyToClipboard  = useAppStore(s => s.copyToClipboard);
  const dismissClip      = useAppStore(s => s.dismissClip);

  return (
    <div>
      <h2 className="view-title">Clipboard History</h2>

      {clipHistory.length === 0 ? (
        <div className="card empty-state">
          <p>No items yet.</p>
          <p className="muted">Received clipboard items will appear here.</p>
        </div>
      ) : (
        clipHistory.map(item => (
          <div key={item.id} className="card clip-card">
            <div className="clip-meta">
              <span className="clip-from">{item.fromName}</span>
              <span className="clip-time">{new Date(item.receivedAt).toLocaleTimeString()}</span>
            </div>
            <p className="clip-content">{item.content}</p>
            <div className="clip-actions">
              <button className="btn-ghost" onClick={() => copyToClipboard(item.content)}>Copy</button>
              {item.dataType === "url" && (
                <button className="btn-ghost" onClick={() => open(item.content).catch(() => window.open(item.content, "_blank"))}>Open URL</button>
              )}
              <button className="btn-ghost" onClick={() => dismissClip(item.id)}>Dismiss</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
