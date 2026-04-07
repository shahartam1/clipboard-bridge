import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { useAppStore } from "../store/appStore";
import "./IncomingToast.css";

export default function IncomingToast() {
  const clipHistory = useAppStore(s => s.clipHistory);

  // Track which item ID is currently shown — prevents re-showing after manual dismiss
  const [shownId, setShownId] = useState<string | null>(null);

  const latest = clipHistory[0];

  // When a brand-new item arrives, show it
  useEffect(() => {
    if (latest && latest.id !== shownId) {
      setShownId(latest.id);
    }
  }, [latest?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss after 8 s
  useEffect(() => {
    if (!shownId) return;
    const t = setTimeout(() => setShownId(null), 8000);
    return () => clearTimeout(t);
  }, [shownId]);

  const visible = latest && latest.id === shownId;
  if (!visible) return null;

  const isUrl   = latest.dataType === "url";
  const preview = latest.content.length > 100
    ? latest.content.slice(0, 100) + "…"
    : latest.content;

  function dismiss() {
    setShownId(null);
    // item stays in History tab — only the toast is hidden
  }

  async function openUrl() {
    try {
      await open(latest.content);   // Tauri shell plugin — works on Mac & Windows
    } catch {
      window.open(latest.content, "_blank"); // dev fallback
    }
    dismiss();
  }

  return (
    <div className="toast">
      <div className="toast-header">
        <span className="toast-icon">{isUrl ? "🔗" : "📋"}</span>
        <span className="toast-from">From {latest.fromName}</span>
        <button className="toast-close" onClick={dismiss} title="Dismiss">✕</button>
      </div>

      <p className="toast-content">{preview}</p>
      <p className="toast-hint">{isUrl ? "URL" : "Text"} copied to clipboard ✓</p>

      <div className="toast-actions">
        {isUrl && (
          <button className="btn-primary toast-btn" onClick={openUrl}>
            Open URL
          </button>
        )}
        <button className="btn-ghost toast-btn" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
