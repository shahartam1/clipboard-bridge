import { useAppStore } from "../store/appStore";
import "./IncomingToast.css";

export default function IncomingToast() {
  const clipHistory     = useAppStore(s => s.clipHistory);
  const copyToClipboard = useAppStore(s => s.copyToClipboard);
  const dismissClip     = useAppStore(s => s.dismissClip);

  // Show the most recent unread item as a toast overlay
  const latest = clipHistory[0];
  if (!latest) return null;

  // Only show if received within the last 8s
  if (Date.now() - latest.receivedAt > 8000) return null;

  return (
    <div className="toast">
      <div className="toast-header">
        <span className="toast-from">📋 From {latest.fromName}</span>
        <button className="toast-close" onClick={() => dismissClip(latest.id)}>✕</button>
      </div>
      <p className="toast-content">{latest.content.slice(0, 120)}{latest.content.length > 120 ? "…" : ""}</p>
      <div className="toast-actions">
        <button className="btn-primary toast-btn" onClick={() => { copyToClipboard(latest.content); dismissClip(latest.id); }}>
          Copy
        </button>
        {latest.dataType === "url" && (
          <button className="btn-ghost toast-btn" onClick={() => { window.open(latest.content, "_blank"); dismissClip(latest.id); }}>
            Open
          </button>
        )}
      </div>
    </div>
  );
}
