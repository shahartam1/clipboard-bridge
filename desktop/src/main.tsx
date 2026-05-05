import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

// Detect which Tauri window we are running in (synchronous via __TAURI_INTERNALS__).
// Falls back to URL params for browser-based development.
const tauriLabel =
  (window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? "";
const params = new URLSearchParams(window.location.search);

const isNotification =
  tauriLabel === "clipnotif" || params.has("notif");

const isOcrOverlay =
  tauriLabel === "ocr-overlay" || params.has("ocr");

const Root = isNotification
  ? React.lazy(() => import("./components/NotificationWindow"))
  : isOcrOverlay
  ? React.lazy(() => import("./components/OcrOverlay"))
  : React.lazy(() => import("./App"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>
      <Root />
    </React.Suspense>
  </React.StrictMode>
);
