import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store/appStore";
import "./QuickSendPicker.css";

export default function QuickSendPicker() {
  const peers       = useAppStore(s => s.peers);
  const sendClip    = useAppStore(s => s.sendClip);
  const pickerText  = useAppStore(s => s.pickerText);
  const pickerOpen  = useAppStore(s => s.pickerOpen);
  const closePicker = useAppStore(s => s.closePicker);

  const [sentTo, setSentTo] = useState<string | null>(null); // device name after send

  // Listen for the Rust event fired by the global hotkey
  useEffect(() => {
    const unlisten = listen<string>("quick-send-triggered", (event) => {
      setSentTo(null);
      useAppStore.setState({ pickerText: event.payload, pickerOpen: true });
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePicker();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pickerOpen, closePicker]);

  if (!pickerOpen || !pickerText) return null;

  const isUrl  = pickerText.startsWith("http://") || pickerText.startsWith("https://");
  const preview = pickerText.length > 120 ? pickerText.slice(0, 120) + "…" : pickerText;

  function handleSend(peerId: string, peerName: string) {
    try {
      sendClip(peerId, pickerText!, isUrl ? "url" : "text");
      setSentTo(peerName);
      // Brief "Sent!" flash, then close
      setTimeout(() => closePicker(), 800);
    } catch {
      // Even if send fails, always close
      closePicker();
    }
  }

  // ── Sent confirmation screen ────────────────────────────────────────────
  if (sentTo) {
    return (
      <div className="picker-backdrop">
        <div className="picker-modal picker-modal--sent">
          <div className="sent-icon">✓</div>
          <p className="sent-label">Sent to <strong>{sentTo}</strong></p>
        </div>
      </div>
    );
  }

  // ── Picker screen ───────────────────────────────────────────────────────
  return (
    <div
      className="picker-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) closePicker(); }}
    >
      <div className="picker-modal">
        {/* Header */}
        <div className="picker-header">
          <span className="picker-title">{isUrl ? "🔗" : "📋"} Quick Send</span>
          <button className="picker-close" onClick={closePicker}>✕</button>
        </div>

        {/* Clipboard preview */}
        <div className="picker-preview">
          <span className="picker-preview-label">{isUrl ? "URL" : "Text"} from clipboard</span>
          <p className="picker-preview-text">{preview}</p>
        </div>

        {/* Device list */}
        <div className="picker-devices-label">Send to</div>

        {peers.length === 0 ? (
          <div className="picker-empty">
            No paired devices. Go to the <strong>Pair</strong> tab first.
          </div>
        ) : (
          <div className="picker-devices">
            {peers.map(peer => (
              <button
                key={peer.id}
                className="picker-device-btn"
                onClick={() => handleSend(peer.id, peer.name)}
              >
                <span className="picker-device-icon">💻</span>
                <span className="picker-device-name">{peer.name}</span>
                <span className="picker-device-arrow">→</span>
              </button>
            ))}
          </div>
        )}

        <p className="picker-hint">Press Esc to cancel</p>
      </div>
    </div>
  );
}
