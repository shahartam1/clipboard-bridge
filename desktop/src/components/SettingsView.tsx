import { useState } from "react";
import { useAppStore } from "../store/appStore";
import "./SettingsView.css";

export default function SettingsView() {
  const identity      = useAppStore(s => s.identity);
  const setDeviceName = useAppStore(s => s.setDeviceName);

  const [name, setName] = useState(identity.deviceName);
  const [saved, setSaved] = useState(false);

  function save() {
    setDeviceName(name);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <h2 className="view-title">Settings</h2>

      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>This Device</h3>

        <div className="field">
          <label className="field-label">Device Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") save(); }}
            placeholder="My MacBook"
          />
        </div>

        <div className="field">
          <label className="field-label">Device ID</label>
          <div className="mono-box">{identity.deviceId}</div>
        </div>

        <div className="field">
          <label className="field-label">Public Key</label>
          <div className="mono-box truncate">{identity.keyPair.publicKey}</div>
        </div>

        <button className="btn-primary" onClick={save} disabled={!name.trim()}>
          {saved ? "✓ Saved" : "Save"}
        </button>
      </div>

      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>Server</h3>
        <p className="muted">
          Connect to your own signaling server by setting <code>VITE_SERVER_URL</code> in a <code>.env</code> file.
        </p>
        <p className="muted" style={{ marginTop: 8 }}>
          Default: <code>ws://localhost:8787</code>
        </p>
      </div>
    </div>
  );
}
