/**
 * Full-screen OCR capture overlay.
 *
 * Flow:
 *  1. Mounts → calls `get_screen_capture` to get the base64 PNG taken by Rust.
 *  2. Renders the screenshot full-screen with a dim overlay.
 *  3. User click-drags to mark a region (dim clears inside selection).
 *  4. Mouse-up → crop → Tesseract OCR → emitTo("main", "ocr-text-ready", { text }) → hide.
 *  5. Esc cancels.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo } from "@tauri-apps/api/event";
import Tesseract from "tesseract.js";
import "./OcrOverlay.css";

const TESS_OPTS = {
  workerPath: "/tesseract-worker.min.js",
  workerBlobURL: false,
};

interface Rect { x: number; y: number; w: number; h: number; }

export default function OcrOverlay() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const imgRef      = useRef<HTMLImageElement | null>(null);
  const dragStart   = useRef<{ x: number; y: number } | null>(null);

  const [ready,      setReady]      = useState(false);
  const [dragging,   setDragging]   = useState(false);
  const [_rect,      setRect]       = useState<Rect | null>(null);
  const [status,     setStatus]     = useState("Click and drag to select a region  •  Esc to cancel");
  const [processing, setProcessing] = useState(false);

  // ── Load screenshot ──────────────────────────────────────────────────
  useEffect(() => {
    invoke<string | null>("get_screen_capture")
      .then((dataUrl) => {
        if (!dataUrl) {
          setStatus("No screenshot available — close and try again.");
          return;
        }
        const img = new Image();
        img.onload = () => { imgRef.current = img; setReady(true); };
        img.onerror = () => setStatus("Failed to load screenshot.");
        // dataUrl may be a full "data:image/jpeg;base64,..." or bare base64
        img.src = dataUrl.startsWith("data:") ? dataUrl : `data:image/png;base64,${dataUrl}`;
      })
      .catch((err) => setStatus(`Error: ${String(err)}`));

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") getCurrentWindow().hide().catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Canvas redraw ───────────────────────────────────────────────────
  const redraw = useCallback((r: Rect | null) => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (r && r.w > 1 && r.h > 1) {
      const { x, y, w, h } = r;
      const sx = img.naturalWidth  / canvas.width;
      const sy = img.naturalHeight / canvas.height;

      ctx.drawImage(img, x * sx, y * sy, w * sx, h * sy, x, y, w, h);

      ctx.strokeStyle = "#7c6af7";
      ctx.lineWidth   = 2;
      ctx.strokeRect(x, y, w, h);

      const hs = 8;
      ctx.fillStyle = "#7c6af7";
      for (const [cx, cy] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]] as [number,number][]) {
        ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
      }

      const label = `${Math.round(w)} × ${Math.round(h)}`;
      const lw    = ctx.measureText(label).width;
      ctx.font = "12px -apple-system, sans-serif";
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(x + w / 2 - lw / 2 - 4, y + h + 4, lw + 8, 18);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x + w / 2 - lw / 2, y + h + 16);
    }
  }, []);

  useEffect(() => { if (ready) redraw(null); }, [ready, redraw]);

  // ── Mouse handlers ──────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent) {
    if (processing) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
    setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragging || !dragStart.current) return;
    const r = {
      x: Math.min(dragStart.current.x, e.clientX),
      y: Math.min(dragStart.current.y, e.clientY),
      w: Math.abs(e.clientX - dragStart.current.x),
      h: Math.abs(e.clientY - dragStart.current.y),
    };
    setRect(r);
    redraw(r);
  }

  async function onMouseUp(e: React.MouseEvent) {
    if (!dragging || !dragStart.current) return;
    setDragging(false);

    const x = Math.min(dragStart.current.x, e.clientX);
    const y = Math.min(dragStart.current.y, e.clientY);
    const w = Math.abs(e.clientX - dragStart.current.x);
    const h = Math.abs(e.clientY - dragStart.current.y);
    dragStart.current = null;

    if (w < 10 || h < 10) {
      setStatus("Selection too small — try again, or Esc to cancel.");
      redraw(null);
      setRect(null);
      return;
    }

    setProcessing(true);
    setStatus("Loading OCR engine…");

    const img    = imgRef.current!;
    const canvas = canvasRef.current!;
    const sx     = img.naturalWidth  / canvas.width;
    const sy     = img.naturalHeight / canvas.height;

    const crop    = document.createElement("canvas");
    crop.width    = Math.round(w * sx);
    crop.height   = Math.round(h * sy);
    const cctx    = crop.getContext("2d")!;
    cctx.drawImage(img, x * sx, y * sy, w * sx, h * sy, 0, 0, crop.width, crop.height);

    try {
      const result = await Tesseract.recognize(crop, "eng", {
        ...TESS_OPTS,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "loading tesseract core")       setStatus("Loading OCR engine…");
          if (m.status === "initializing tesseract")       setStatus("Initializing…");
          if (m.status === "loading language traineddata") setStatus("Downloading language data (first run)…");
          if (m.status === "recognizing text")
            setStatus(`Recognizing…  ${Math.round(m.progress * 100)}%`);
        },
      });

      const text = result.data.text.trim();
      await emitTo("main", "ocr-text-ready", { text });
      getCurrentWindow().hide().catch(() => {});
    } catch (err) {
      setStatus(`OCR error: ${String(err)}  •  Esc to close`);
      setProcessing(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div
      className="ocr-root"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      <canvas ref={canvasRef} className="ocr-canvas" />

      <div className={`ocr-status${processing ? " ocr-status--processing" : ""}`}>
        {processing && <span className="ocr-spinner" />}
        {status}
      </div>

      {!ready && (
        <div className="ocr-loading">
          <span className="ocr-spinner" style={{ width: 20, height: 20 }} />
          Preparing capture…
        </div>
      )}
    </div>
  );
}
