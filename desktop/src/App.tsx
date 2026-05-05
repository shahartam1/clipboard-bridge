import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "./store/appStore";
import Sidebar from "./components/Sidebar";
import SendView from "./components/SendView";
import DevicesView from "./components/DevicesView";
import PairView from "./components/PairView";
import HistoryView from "./components/HistoryView";
import SettingsView from "./components/SettingsView";
import QuickSendPicker from "./components/QuickSendPicker";
import "./App.css";

export default function App() {
  const init                  = useAppStore(s => s.init);
  const setTab                = useAppStore(s => s.setTab);
  const activeTab             = useAppStore(s => s.activeTab);
  const triggerOcrCapture     = useAppStore(s => s.triggerOcrCapture);

  useEffect(() => { init(); }, [init]);

  // ── Global OCR shortcut listener ────────────────────────────────────────
  // Lives here (always mounted) so pressing the shortcut from any tab works.
  // It switches to the Send tab and sets a flag that SendView reacts to.
  useEffect(() => {
    const unlisten = listen("trigger-ocr-capture", () => {
      setTab("send");
      triggerOcrCapture();
    });
    return () => { unlisten.then(fn => fn()); };
  }, [setTab, triggerOcrCapture]);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        {activeTab === "send"     && <SendView />}
        {activeTab === "devices"  && <DevicesView />}
        {activeTab === "pair"     && <PairView />}
        {activeTab === "history"  && <HistoryView />}
        {activeTab === "settings" && <SettingsView />}
      </main>
      <QuickSendPicker />
    </div>
  );
}
