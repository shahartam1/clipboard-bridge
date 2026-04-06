import { useEffect } from "react";
import { useAppStore } from "./store/appStore";
import Sidebar from "./components/Sidebar";
import SendView from "./components/SendView";
import DevicesView from "./components/DevicesView";
import PairView from "./components/PairView";
import SettingsView from "./components/SettingsView";
import IncomingToast from "./components/IncomingToast";
import QuickSendPicker from "./components/QuickSendPicker";
import "./App.css";

export default function App() {
  const init = useAppStore(s => s.init);
  const activeTab = useAppStore(s => s.activeTab);

  useEffect(() => { init(); }, [init]);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        {activeTab === "send"     && <SendView />}
        {activeTab === "devices"  && <DevicesView />}
        {activeTab === "pair"     && <PairView />}
        {activeTab === "settings" && <SettingsView />}
      </main>
      <IncomingToast />
      <QuickSendPicker />
    </div>
  );
}
