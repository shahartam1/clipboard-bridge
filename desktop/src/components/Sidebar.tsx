import { useAppStore, type Tab } from "../store/appStore";
import "./Sidebar.css";

const NAV: { id: Tab; label: string; icon: string }[] = [
  { id: "send",     label: "Send",    icon: "⬆" },
  { id: "devices",  label: "Devices", icon: "📱" },
  { id: "pair",     label: "Pair",    icon: "🔗" },
  { id: "history",  label: "History", icon: "🕒" },
  { id: "settings", label: "Settings",icon: "⚙" },
];

export default function Sidebar() {
  const activeTab  = useAppStore(s => s.activeTab);
  const setTab     = useAppStore(s => s.setTab);
  const connected  = useAppStore(s => s.connected);
  const identity   = useAppStore(s => s.identity);

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="logo-icon">📋</span>
        <span className="logo-text">ClipBridge</span>
      </div>

      <nav className="sidebar-nav">
        {NAV.map(item => (
          <button
            key={item.id}
            className={`nav-item ${activeTab === item.id ? "active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className={`status-dot ${connected ? "online" : "offline"}`} />
        <span className="status-label">{connected ? "Connected" : "Connecting…"}</span>
        <div className="device-id" title={identity.deviceId}>
          {identity.deviceName}
        </div>
      </div>
    </aside>
  );
}
