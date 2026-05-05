import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Tesseract from "tesseract.js";
import { useAppStore } from "../store/appStore";
import "./SendView.css";

export default function SendView() {
  const peers      = useAppStore(s => s.peers);
  const sendClip   = useAppStore(s => s.sendClip);
  const settings   = useAppStore(s => s.settings);

  const [text, setText]             = useState("");
  const [selectedPeer, setSelectedPeer] = useState<string>("");
  const [ocrState, setOcrState]     = useState<"idle" | "capturing" | "ocring">("idle");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [dropHighlight, setDropHighlight] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // ── Listen for OCR result from the overlay window ─────────────────────
  useEffect(() => {
    const unlisten = listen<{ text: string }>("ocr-text-ready", (ev) => {
      setText(ev.payload.text);
      setOcrState("idle");
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // ── Listen for global OCR shortcut trigger ────────────────────────────
  useEffect(() => {
    const unlisten = listen("trigger-ocr-capture", () => {
      handleOcrCapture();
    });
    return () => { unlisten.then(fn => fn()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Screenshot + overlay capture ──────────────────────────────────────
  async function handleOcrCapture() {
    try {
      setOcrState("capturing");
      await invoke("start_ocr_capture");
      // Overlay window opens; result comes back via "ocr-text-ready" event
    } catch (err) {
      console.error("OCR capture error:", err);
      setOcrState("idle");
    }
  }

  // ── Image file → OCR ──────────────────────────────────────────────────
  const runOcrOnFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setOcrState("ocring");
    setOcrProgress(0);
    try {
      const result = await Tesseract.recognize(file, "eng", {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setOcrProgress(Math.round(m.progress * 100));
          }
        },
      });
      setText(result.data.text.trim());
    } catch (err) {
      console.error("OCR error:", err);
    } finally {
      setOcrState("idle");
    }
  }, []);

  // ── Drag-and-drop handlers ────────────────────────────────────────────
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDropHighlight(true);
  }

  function onDragLeave() {
    setDropHighlight(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropHighlight(false);
    const file = e.dataTransfer.files[0];
    if (file) runOcrOnFile(file);
  }

  // ── File picker (upload button) ───────────────────────────────────────
  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) runOcrOnFile(file);
    e.target.value = "";
  }

  // ── Send ──────────────────────────────────────────────────────────────
  function handleSend() {
    if (!text.trim() || !selectedPeer) return;
    sendClip(selectedPeer, text.trim(), text.startsWith("http") ? "url" : "text");
    setText("");
  }

  // ── OCR button label ──────────────────────────────────────────────────
  const ocrBtnLabel =
    ocrState === "capturing"
      ? "Opening capture…"
      : ocrState === "ocring"
      ? `Extracting… ${ocrProgress}%`
      : "Extract text from picture";

  const shortcutHint = settings.ocrShortcut
    ? ` (${formatShortcut(settings.ocrShortcut)})`
    : "";

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
          {/* ── Device picker ── */}
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

          {/* ── Content area ── */}
          <div className="field">
            <div className="field-label-row">
              <label className="field-label">Content</label>
              <div className="ocr-actions">
                {/* Screenshot capture */}
                <button
                  className="btn-ocr"
                  onClick={handleOcrCapture}
                  disabled={ocrState !== "idle"}
                  title={`Capture a region of the screen and extract its text${shortcutHint}`}
                >
                  📷 {ocrBtnLabel}
                </button>
                {/* File upload */}
                <label
                  className="btn-ocr btn-ocr--upload"
                  title="Upload an image file to extract its text"
                >
                  🖼 Upload image
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleFileInput}
                    disabled={ocrState !== "idle"}
                  />
                </label>
              </div>
            </div>

            {/* Drop zone wrapper */}
            <div
              ref={dropRef}
              className={`drop-zone${dropHighlight ? " drop-zone--active" : ""}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <textarea
                className="text-input"
                placeholder={
                  dropHighlight
                    ? "Drop image here to extract text…"
                    : "Paste text or a URL here, or drop an image to extract its text…"
                }
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && e.metaKey) handleSend(); }}
                rows={5}
              />
              {dropHighlight && (
                <div className="drop-overlay">
                  <span className="drop-icon">🖼</span>
                  <span>Drop image to extract text</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Send row ── */}
          <div className="send-row">
            <button
              className="btn-primary"
              onClick={handleSend}
              disabled={!text.trim() || !selectedPeer}
            >
              Send  ⌘↵
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Convert a Tauri shortcut string to a human-readable label. */
function formatShortcut(sc: string): string {
  return sc
    .replace("CommandOrControl", navigator.platform.includes("Mac") ? "⌘" : "Ctrl")
    .replace("Shift", "⇧")
    .replace("Alt", navigator.platform.includes("Mac") ? "⌥" : "Alt")
    .replace(/\+/g, "");
}
