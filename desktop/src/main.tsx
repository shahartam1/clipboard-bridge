import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

const isNotification = new URLSearchParams(window.location.search).has("notif");

// Lazy-load so the notification window never imports the main app store
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
