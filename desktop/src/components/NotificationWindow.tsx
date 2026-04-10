/**
 * Custom ClipBridge notification window.
 * Loaded in the pre-defined "clipnotif" Tauri window (hidden at startup).
 * Receives clip data via the "clip-notification" Tauri event from Rust.
 */
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import "./NotificationWindow.css";

interface NotifPayload {
  from: string;
  dataType: string;
  content: string;
}

export default function NotificationWindow() {
  const [notif, setNotif] = useState<NotifPayload | null>(null);
  const [fading, setFading] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Listen for notification data emitted from Rust
  useEffect(() => {
    const unlisten = listen<NotifPayload>("clip-notification", (event) => {
      // Cancel any in-progress dismiss timers
      timers.current.forEach(clearTimeout);
      timers.current = [];

      setFading(false);
      setNotif(event.payload);

      // Auto-dismiss after 3.5 s
      timers.current.push(setTimeout(() => setFading(true), 3000));
      timers.current.push(
        setTimeout(() => {
          getCurrentWindow().hide().catch(() => {});
          setNotif(null);
        }, 3500)
      );
    });
    return () => {
      unlisten.then((fn) => fn());
      timers.current.forEach(clearTimeout);
    };
  }, []);

  function dismiss() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    getCurrentWindow().hide().catch(() => {});
    setNotif(null);
  }

  async function handleOpenUrl() {
    if (!notif) return;
    try {
      await open(notif.content);
    } catch {
      window.open(notif.content, "_blank");
    }
    dismiss();
  }

  if (!notif) return null;

  const isUrl = notif.dataType === "url";
  const preview =
    notif.content.length > 90 ? notif.content.slice(0, 90) + "…" : notif.content;

  return (
    <div className={`cb-notif${fading ? " cb-notif--fading" : ""}`}>
      {/* Header */}
      <div className="cb-notif__header">
        <div className="cb-notif__brand">
          <span className="cb-notif__logo">📋</span>
          <span className="cb-notif__app">ClipBridge</span>
        </div>
        <span className="cb-notif__from">from {notif.from}</span>
        <button className="cb-notif__close" onClick={dismiss} title="Dismiss">
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="cb-notif__body">
        <span className="cb-notif__type-icon">{isUrl ? "🔗" : "📄"}</span>
        <p className="cb-notif__text">{preview}</p>
      </div>

      {/* Footer */}
      <div className="cb-notif__footer">
        <span className="cb-notif__hint">
          {isUrl ? "URL copied to clipboard" : "Text copied to clipboard"}
        </span>
        <div className="cb-notif__actions">
          {isUrl && (
            <button
              className="cb-notif__btn cb-notif__btn--primary"
              onClick={handleOpenUrl}
            >
              Open URL
            </button>
          )}
          <button
            className="cb-notif__btn cb-notif__btn--ghost"
            onClick={dismiss}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
