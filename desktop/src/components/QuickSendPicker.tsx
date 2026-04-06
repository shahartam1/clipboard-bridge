import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useAppStore } from "../store/appStore";
import "./QuickSendPicker.css";

export default function QuickSendPicker() {
  const peers        = useAppStore(s => s.peers);
  const sendClip     = useAppStore(s => s.sendClip);
  const pickerText   = useAppStore(s => s.pickerText);
  const pickerOpen   = useAppStore(s => s.pickerOpen);
  const closePicker  = useAppStore(s => s.closePicker);
  const overlayRef   = useRef<HTMLDivElement>(null);

  // Listen for the Rust event fired by the global hotkey
  useEffect(() => {
    const unlisten = listen<string>("quick-send-triggered", (event) => {
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

  const isUrl = pickerText.startsWith("http://") || pickerText.startsWith("https://");
  const preview = pickerText.length > 120 ? pickerText.slice(0, 120) + "…" : pickerText;

  function handleSend(peerId: string) {
    sendClip(peerId, pickerText!, isUrl ? "url" : "text");
    closePicker();
  }

  return (
    <div className="picker-backdrop" onClick={(e) => { if (e.target === overlayRef.current) closePicker(); }}>
      <div className="picker-modal" ref={overlayRef as React.RefObject<HTMLDivElement>} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="picker-header">
          <span className="picker-title">
            {isUrl ? "🔗" : "📋"} Quick Send
          </span>
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
                onClick={() => handleSend(peer.id)}
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
