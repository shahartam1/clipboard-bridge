/**
 * Custom ClipBridge notification window.
 * Loaded in the pre-defined "clipnotif" Tauri window (hidden at startup).
 *
 * Data arrives via two channels (whichever fires first wins):
 *  1. window.__cb_notif  — set synchronously via win.eval() from Rust
 *  2. "clip-notification" Tauri event — emitted right after the eval
 *
 * The dismiss timer starts only when the card becomes visible, so the user
 * always sees the full 3 seconds regardless of any async delivery delay.
 */
import { useEffect, useState } from "react";
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

  // ── Data delivery ─────────────────────────────────────────────────────────
  useEffect(() => {
    function apply(data: NotifPayload) {
      setFading(false);
      setNotif(data);
    }

    // Check for data that was eval-injected before React mounted
    const pending = (window as any).__cb_notif as NotifPayload | undefined;
    if (pending) {
      delete (window as any).__cb_notif;
      apply(pending);
    }

    // Callback invoked by Rust eval when data arrives after React mounts
    (window as any).__cb_notif_cb = () => {
      const d = (window as any).__cb_notif as NotifPayload | undefined;
      if (d) {
        delete (window as any).__cb_notif;
        apply(d);
      }
    };

    // Tauri event as a belt-and-suspenders fallback
    const unlisten = listen<NotifPayload>("clip-notification", (ev) =>
      apply(ev.payload)
    );

    return () => {
      delete (window as any).__cb_notif_cb;
      unlisten.then((fn) => fn());
    };
  }, []);

  // ── Auto-dismiss timer — resets on every new notification ────────────────
  useEffect(() => {
    if (!notif) return;
    const fadeTimer = setTimeout(() => setFading(true), 3000);
    const closeTimer = setTimeout(() => {
      getCurrentWindow()
        .hide()
        .catch(() => {});
      setNotif(null);
    }, 3500);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(closeTimer);
    };
  }, [notif]);

  // ── Actions ───────────────────────────────────────────────────────────────
  function dismiss() {
    getCurrentWindow()
      .hide()
      .catch(() => {});
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
    notif.content.length > 90
      ? notif.content.slice(0, 90) + "…"
      : notif.content;

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
