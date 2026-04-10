/**
 * Custom ClipBridge notification window.
 * Loaded in a separate frameless Tauri window (label: "clipnotif").
 * Receives clip data via URL query params.
 */
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-shell";
import "./NotificationWindow.css";

export default function NotificationWindow() {
  const [fading, setFading] = useState(false);

  // Parse clip data from URL params
  const params  = new URLSearchParams(window.location.search);
  const fromName = params.get("from")    ?? "Unknown";
  const dataType = params.get("type")    ?? "text";
  const content  = params.get("content") ?? "";
  const isUrl    = dataType === "url";

  useEffect(() => {
    // Fade out 0.5 s before closing
    const fadeTimer  = setTimeout(() => setFading(true),  3000);
    const closeTimer = setTimeout(() => getCurrentWindow().close(), 3500);
    return () => { clearTimeout(fadeTimer); clearTimeout(closeTimer); };
  }, []);

  function dismiss() {
    getCurrentWindow().close();
  }

  async function handleOpenUrl() {
    try { await open(content); } catch { window.open(content, "_blank"); }
    dismiss();
  }

  const preview = content.length > 90 ? content.slice(0, 90) + "…" : content;

  return (
    <div className={`cb-notif${fading ? " cb-notif--fading" : ""}`}>
      {/* Header */}
      <div className="cb-notif__header">
        <div className="cb-notif__brand">
          <span className="cb-notif__logo">📋</span>
          <span className="cb-notif__app">ClipBridge</span>
        </div>
        <span className="cb-notif__from">from {fromName}</span>
        <button className="cb-notif__close" onClick={dismiss} title="Dismiss">✕</button>
      </div>

      {/* Content */}
      <div className="cb-notif__body">
        <span className="cb-notif__type-icon">{isUrl ? "🔗" : "📄"}</span>
        <p className="cb-notif__text">{preview}</p>
      </div>

      {/* Footer hint + actions */}
      <div className="cb-notif__footer">
        <span className="cb-notif__hint">
          {isUrl ? "URL copied to clipboard" : "Text copied to clipboard"}
        </span>
        <div className="cb-notif__actions">
          {isUrl && (
            <button className="cb-notif__btn cb-notif__btn--primary" onClick={handleOpenUrl}>
              Open URL
            </button>
          )}
          <button className="cb-notif__btn cb-notif__btn--ghost" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
