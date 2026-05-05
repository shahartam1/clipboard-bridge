import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Tesseract from "tesseract.js";
import { useAppStore } from "../store/appStore";
import "./SendView.css";

// ── Tesseract options: use the worker we ship locally so Tauri's WebView
//    doesn't have to fetch it from a CDN (blob importScripts can be blocked).
//    Language data is still downloaded from CDN on first use (~3 MB, cached).
const TESS_OPTS = {
  workerPath: "/tesseract-worker.min.js",
  workerBlobURL: false,     // skip blob wrapper → direct Worker("/tesseract-worker.min.js")
};

export default function SendView() {
  const peers      = useAppStore(s => s.peers);
  const sendClip   = useAppStore(s => s.sendClip);
  const connected  = useAppStore(s => s.connected);
  const settings   = useAppStore(s => s.settings);

  const [text, setText]             = useState("");
  const [selectedPeer, setSelectedPeer] = useState<string>("");
  const [ocrState, setOcrState]     = useState<"idle" | "capturing" | "ocring">("idle");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrLog, setOcrLog]         = useState(""); // current OCR phase label
  const [error, setError]           = useState<string | null>(null);
  const [sendFeedback, setSendFeedback] = useState<string | null>(null);
  const [dropHighlight, setDropHighlight] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // ── Auto-clear error after 5 s ─────────────────────────────────────────
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  // ── Auto-clear send feedback ───────────────────────────────────────────
  useEffect(() => {
    if (!sendFeedback) return;
    const t = setTimeout(() => setSendFeedback(null), 3000);
    return () => clearTimeout(t);
  }, [sendFeedback]);

  // ── Listen for OCR result from the overlay window ─────────────────────
  useEffect(() => {
    const unlisten = listen<{ text: string }>("ocr-text-ready", (ev) => {
      const extracted = ev.payload.text;
      setText(extracted);
      setOcrState("idle");
      if (!extracted) setError("OCR found no text in that region. Try a clearer area.");
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // ── Listen for global OCR shortcut ────────────────────────────────────
  useEffect(() => {
    const unlisten = listen("trigger-ocr-capture", () => { handleOcrCapture(); });
    return () => { unlisten.then(fn => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Screenshot + overlay capture ──────────────────────────────────────
  async function handleOcrCapture() {
    setError(null);
    setOcrState("capturing");
    try {
      await invoke("start_ocr_capture");
      // Overlay opens; result arrives via "ocr-text-ready" event
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("screencapture")
          ? "Screen capture failed. On macOS, go to System Settings → Privacy & Security → Screen Recording and allow ClipBridge."
          : `Screen capture error: ${msg}`
      );
      setOcrState("idle");
    }
  }

  // ── Image file → OCR ──────────────────────────────────────────────────
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
          if (m.status === "loading tesseract core")      setOcrLog("Loading OCR engine…");
          if (m.status === "initializing tesseract")      setOcrLog("Initializing OCR…");
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

  // ── Drag-and-drop handlers ────────────────────────────────────────────
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDropHighlight(true);
  }
  function onDragLeave() { setDropHighlight(false); }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropHighlight(false);
    const file = e.dataTransfer.files[0];
    if (file) runOcrOnFile(file);
  }

  // ── File picker ────────────────────────────────────────────────────────
  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) runOcrOnFile(file);
    e.target.value = "";
  }

  // ── Send ──────────────────────────────────────────────────────────────
  function handleSend() {
    if (!text.trim() || !selectedPeer) return;
    if (!connected) {
      setSendFeedback("⚠ Not connected to server. Check your network or server URL.");
      return;
    }
    sendClip(selectedPeer, text.trim(), text.startsWith("http") ? "url" : "text");
    setSendFeedback("✓ Sent!");
    setText("");
  }

  // ── Derived ──────────────────────────────────────────────────────────
  const isBusy     = ocrState !== "idle";
  const ocrBtnLabel =
    ocrState === "capturing" ? "Opening capture…" :
    ocrState === "ocring"    ? `${ocrLog} ${ocrProgress > 0 ? ocrProgress + "%" : ""}`.trim() :
    "Extract text from picture";

  const shortcutHint = settings.ocrShortcut
    ? ` (${formatShortcut(settings.ocrShortcut)})`
    : "";

  const canSend = !!text.trim() && !!selectedPeer;

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
          {/* ── Error banner ── */}
          {error && (
            <div className="send-banner send-banner--error">
              ⚠ {error}
            </div>
          )}
          {sendFeedback && (
            <div className={`send-banner ${sendFeedback.startsWith("✓") ? "send-banner--ok" : "send-banner--error"}`}>
              {sendFeedback}
            </div>
          )}

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
                <button
                  className="btn-ocr"
                  onClick={handleOcrCapture}
                  disabled={isBusy}
                  title={`Capture a region of the screen and extract its text${shortcutHint}`}
                >
                  📷 {ocrBtnLabel}
                </button>
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
                    disabled={isBusy}
                  />
                </label>
              </div>
            </div>

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
              disabled={!canSend}
              title={
                !selectedPeer ? "Select a device above first" :
                !text.trim() ? "Enter some text above" :
                !connected ? "Not connected to server" : ""
              }
            >
              Send  ⌘↵
            </button>
            {!connected && canSend && (
              <span className="status-hint red">Not connected to server</span>
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
