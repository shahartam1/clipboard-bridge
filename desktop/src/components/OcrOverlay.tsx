/**
 * Full-screen OCR capture overlay.
 *
 * Flow:
 *  1. Mounts → calls `get_screen_capture` Rust command to get base64 PNG.
 *  2. Renders the screenshot full-screen with a dimming overlay on top.
 *  3. User click-drags to select a region (the selected region clears the dim).
 *  4. On mouse-up: crops the region, runs Tesseract OCR, emits "ocr-text-ready"
 *     to the main window, then hides itself.
 *  5. Esc cancels and hides the window.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo } from "@tauri-apps/api/event";
import Tesseract from "tesseract.js";
import "./OcrOverlay.css";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function OcrOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [status, setStatus] = useState("Click and drag to select a region  •  Esc to cancel");
  const [processing, setProcessing] = useState(false);

  // ── Load screenshot on mount ─────────────────────────────────────────────
  useEffect(() => {
    invoke<string | null>("get_screen_capture")
      .then((b64) => {
        if (!b64) {
          setStatus("No screenshot available — close and try again.");
          return;
        }
        const img = new Image();
        img.onload = () => {
          imgRef.current = img;
          setReady(true);
        };
        img.src = `data:image/png;base64,${b64}`;
      })
      .catch((err) => setStatus(`Error loading screenshot: ${err}`));

    // Esc key cancels
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        getCurrentWindow().hide().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Redraw canvas whenever screenshot or selection changes ───────────────
  const redraw = useCallback(
    (currentRect: Rect | null) => {
      const canvas = canvasRef.current;
      const img = imgRef.current;
      if (!canvas || !img) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Canvas logical size = window size (CSS px)
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      // Draw screenshot scaled to fill the canvas
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Dim the whole canvas
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (currentRect && currentRect.w > 1 && currentRect.h > 1) {
        const { x, y, w, h } = currentRect;

        // Cut-out: redraw original screenshot in the selected region
        const scaleX = img.naturalWidth / canvas.width;
        const scaleY = img.naturalHeight / canvas.height;

        ctx.drawImage(
          img,
          x * scaleX,
          y * scaleY,
          w * scaleX,
          h * scaleY,
          x,
          y,
          w,
          h
        );

        // Accent border
        ctx.strokeStyle = "#7c6af7";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        // Corner handles
        const hs = 8;
        ctx.fillStyle = "#7c6af7";
        for (const [cx, cy] of [
          [x, y], [x + w, y], [x, y + h], [x + w, y + h],
        ]) {
          ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
        }

        // Size label
        ctx.font = "12px -apple-system, sans-serif";
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        const label = `${Math.round(w)} × ${Math.round(h)}`;
        const lw = ctx.measureText(label).width;
        ctx.fillRect(x + w / 2 - lw / 2 - 4, y + h + 4, lw + 8, 18);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, x + w / 2 - lw / 2, y + h + 16);
      }
    },
    []
  );

  // Trigger redraw when ready (screenshot loaded)
  useEffect(() => {
    if (ready) redraw(rect);
  }, [ready, redraw]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mouse events ─────────────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent) {
    if (processing) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
    setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragging || !dragStart.current) return;
    const x = Math.min(dragStart.current.x, e.clientX);
    const y = Math.min(dragStart.current.y, e.clientY);
    const w = Math.abs(e.clientX - dragStart.current.x);
    const h = Math.abs(e.clientY - dragStart.current.y);
    const newRect = { x, y, w, h };
    setRect(newRect);
    redraw(newRect);
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
    setStatus("Extracting text…  0%");

    const img = imgRef.current!;
    const canvas = canvasRef.current!;

    // Crop the selected region from the original screenshot
    const scaleX = img.naturalWidth / canvas.width;
    const scaleY = img.naturalHeight / canvas.height;

    const crop = document.createElement("canvas");
    crop.width = Math.round(w * scaleX);
    crop.height = Math.round(h * scaleY);
    const cctx = crop.getContext("2d")!;
    cctx.drawImage(
      img,
      x * scaleX,
      y * scaleY,
      w * scaleX,
      h * scaleY,
      0,
      0,
      crop.width,
      crop.height
    );

    try {
      const result = await Tesseract.recognize(crop, "eng", {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setStatus(`Extracting text…  ${Math.round(m.progress * 100)}%`);
          }
        },
      });

      const text = result.data.text.trim();

      // Send result to main window, then hide
      await emitTo("main", "ocr-text-ready", { text });
      getCurrentWindow().hide().catch(() => {});
    } catch (err) {
      setStatus(`OCR error: ${err}  — Esc to close.`);
      setProcessing(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
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
      {!ready && <div className="ocr-loading">Preparing capture…</div>}
    </div>
  );
}
