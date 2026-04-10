import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

// Detect if this is the notification window.
// In Tauri: check the window label (synchronous via __TAURI_INTERNALS__).
// In browser dev: fall back to URL param check.
const tauriLabel = (window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? "";
const isNotification =
  tauriLabel === "clipnotif" ||
  new URLSearchParams(window.location.search).has("notif");

const Root = isNotification
  ? React.lazy(() => import("./components/NotificationWindow"))
  : React.lazy(() => import("./App"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>
      <Root />
    </React.Suspense>
  </React.StrictMode>
);
