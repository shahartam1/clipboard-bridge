import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Tesseract from "tesseract.js";
import { useAppStore } from "../store/appStore";
import "./SendView.css";

// Ship the tesseract worker locally so Tauri's WebView can load it without
// hitting CDN-blob-importScripts restrictions.
const TESS_OPTS = {
  workerPath: "/tesseract-worker.min.js",
  workerBlobURL: false,
};

export default function SendView() {
  const peers                  = useAppStore(s => s.peers);
  const sendClip               = useAppStore(s => s.sendClip);
  const connected              = useAppStore(s => s.connected);
  const settings               = useAppStore(s => s.settings);
  const ocrCapturePending      = useAppStore(s => s.ocrCapturePending);
  const clearOcrCapturePending = useAppStore(s => s.clearOcrCapturePending);

  const [text, setText]               = useState("");
  const [selectedPeer, setSelectedPeer] = useState<string>("");
  const [ocrState, setOcrState]       = useState<"idle" | "capturing" | "ocring">("idle");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrLog, setOcrLog]           = useState("");
  const [error, setError]             = useState<string | null>(null);
  const [sendFeedback, setSendFeedback] = useState<string | null>(null);
  const [dropHighlight, setDropHighlight] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // ── Auto-clear banners ─────────────────────────────────────────────────
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 7000);
    return () => clearTimeout(t);
  }, [error]);
  useEffect(() => {
    if (!sendFeedback) return;
    const t = setTimeout(() => setSendFeedback(null), 3000);
    return () => clearTimeout(t);
  }, [sendFeedback]);

  // ── OCR result from overlay window ─────────────────────────────────────
  useEffect(() => {
    const unlisten = listen<{ text: string }>("ocr-text-ready", (ev) => {
      const extracted = ev.payload.text;
      setText(extracted);
      setOcrState("idle");
      if (!extracted) setError("OCR found no text in that region. Try selecting a different area.");
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // ── Global OCR shortcut flag (set by App.tsx) ───────────────────────────
  // When the global shortcut fires from any tab, App.tsx sets ocrCapturePending.
  // We react here now that SendView is mounted.
  useEffect(() => {
    if (!ocrCapturePending) return;
    clearOcrCapturePending();
    handleOcrCapture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocrCapturePending]);

  // ── Screenshot capture via browser getDisplayMedia API ─────────────────
  // This uses the WebView's built-in screen-capture permission dialog,
  // which is properly attributed to the app bundle (no manual Privacy pane needed).
  async function handleOcrCapture() {
    setError(null);
    setOcrState("capturing");

    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Screen capture API not available in this environment.");
      }

      // Ask the browser/OS for a screen stream.
      // The system will show "ClipBridge wants to record your screen" and then a
      // screen-picker. User should choose "Entire Screen" (or any monitor).
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          // Hint to the picker that we want the whole monitor, not a window
          displaySurface: "monitor",
          frameRate: 1,
        } as MediaTrackConstraints,
        audio: false,
      });

      // Draw one video frame to a canvas
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await new Promise<void>((res, rej) => {
        video.oncanplay  = () => res();
        video.onerror    = () => rej(new Error("Video element failed to load stream"));
      });
      await video.play();
      // Give the WebView one extra frame to paint
      await new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())));

      const canvas = document.createElement("canvas");
      canvas.width  = video.videoWidth  || 1920;
      canvas.height = video.videoHeight || 1080;
      canvas.getContext("2d")!.drawImage(video, 0, 0);

      // Stop the stream before showing the overlay so it doesn't appear in the shot
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;

      // Encode as JPEG (good OCR quality, ~10× smaller than PNG for full screens)
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);

      // Hand off to Rust, then open the overlay
      await invoke("set_screen_capture", { data: dataUrl });
      await invoke("show_ocr_overlay");

      // ocrState stays "capturing" until "ocr-text-ready" event fires
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      if (
        msg.includes("Permission denied") ||
        msg.includes("NotAllowedError") ||
        msg.includes("not allowed")
      ) {
        setError(
          "Screen recording permission was denied. " +
          "Open System Settings → Privacy & Security → Screen Recording " +
          "and enable it for this app, then try again."
        );
      } else if (
        msg.includes("cancelled") ||
        msg.includes("AbortError") ||
        msg.includes("NotFoundError")
      ) {
        // User hit Cancel in the screen picker — silent, just reset
        setError(null);
      } else {
        setError(`Screen capture failed: ${msg}`);
      }
      setOcrState("idle");
    }
  }

  // ── Image file → OCR ───────────────────────────────────────────────────
  const runOcrOnFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please drop an image file (PNG, JPG, etc.).");
      return;
    }
    setError(null);
    setOcrState("ocring");
    setOcrProgress(0);
    setOcrLog("Loading OCR engine…");
    try {
      const result = await Tesseract.recognize(file, "eng", {
        ...TESS_OPTS,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "loading tesseract core")       setOcrLog("Loading OCR engine…");
          if (m.status === "initializing tesseract")       setOcrLog("Initializing…");
          if (m.status === "loading language traineddata") setOcrLog("Downloading language data…");
          if (m.status === "recognizing text") {
            setOcrLog("Recognizing text…");
            setOcrProgress(Math.round(m.progress * 100));
          }
        },
      });
      const extracted = result.data.text.trim();
      setText(extracted);
      if (!extracted) setError("No text found in this image.");
    } catch (err: unknown) {
      setError(`OCR failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOcrState("idle");
    }
  }, []);

  // ── Drag-and-drop ──────────────────────────────────────────────────────
  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setDropHighlight(true); };
  const onDragLeave = () => setDropHighlight(false);
  const onDrop      = (e: React.DragEvent) => {
    e.preventDefault();
    setDropHighlight(false);
    const file = e.dataTransfer.files[0];
    if (file) runOcrOnFile(file);
  };

  // ── File picker ────────────────────────────────────────────────────────
  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) runOcrOnFile(file);
    e.target.value = "";
  }

  // ── Send ───────────────────────────────────────────────────────────────
  function handleSend() {
    if (!text.trim() || !selectedPeer) return;
    if (!connected) {
      setSendFeedback("⚠ Not connected to server. Check your network or server address.");
      return;
    }
    sendClip(selectedPeer, text.trim(), text.startsWith("http") ? "url" : "text");
    setSendFeedback("✓ Sent!");
    setText("");
  }

  // ── Derived labels ─────────────────────────────────────────────────────
  const isBusy = ocrState !== "idle";
  const ocrBtnLabel =
    ocrState === "capturing" ? "Opening capture…" :
    ocrState === "ocring"    ? `${ocrLog} ${ocrProgress > 0 ? ocrProgress + "%" : ""}`.trim() :
    "Extract text from picture";

  const shortcutHint = settings.ocrShortcut
    ? ` (${formatShortcut(settings.ocrShortcut)})` : "";

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
          {/* Error / feedback banners */}
          {error && (
            <div className="send-banner send-banner--error" onClick={() => setError(null)}>
              ⚠ {error}
            </div>
          )}
          {sendFeedback && (
            <div className={`send-banner ${sendFeedback.startsWith("✓") ? "send-banner--ok" : "send-banner--error"}`}>
              {sendFeedback}
            </div>
          )}

          {/* Device selector */}
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

          {/* Content area */}
          <div className="field">
            <div className="field-label-row">
              <label className="field-label">Content</label>
              <div className="ocr-actions">
                <button
                  className="btn-ocr"
                  onClick={handleOcrCapture}
                  disabled={isBusy}
                  title={`Capture a region of your screen and extract its text${shortcutHint}`}
                >
                  📷 {ocrBtnLabel}
                </button>
                <label className="btn-ocr btn-ocr--upload" title="Upload an image to extract its text">
                  🖼 Upload image
                  <input
                    type="file" accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleFileInput}
                    disabled={isBusy}
                  />
                </label>
              </div>
            </div>

            <div
              ref={dropRef}
              className={`drop-zone${dropHighlight ? " drop-zone--active" : ""}`}
              onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
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

          {/* Send row */}
          <div className="send-row">
            <button
              className="btn-primary"
              onClick={handleSend}
              disabled={!text.trim() || !selectedPeer}
              title={
                !selectedPeer ? "Select a device above first" :
                !text.trim()  ? "Enter some text above" : ""
              }
            >
              Send  ⌘↵
            </button>
            {!connected && (
              <span className="status-hint red">Not connected — check server</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatShortcut(sc: string): string {
  return sc
    .replace("CommandOrControl", navigator.platform.includes("Mac") ? "⌘" : "Ctrl")
    .replace("Shift", "⇧")
    .replace("Alt", navigator.platform.includes("Mac") ? "⌥" : "Alt")
    .replace(/\+/g, "");
}
