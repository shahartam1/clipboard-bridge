import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { storage } from "../lib/storage";
import "./DevicesView.css";

export default function DevicesView() {
  const peers      = useAppStore(s => s.peers);
  const renamePeer = useAppStore(s => s.renamePeer);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName]   = useState("");

  function startEdit(peerId: string, currentName: string) {
    setEditingId(peerId);
    setEditName(currentName);
  }

  function saveEdit(peerId: string) {
    if (editName.trim()) renamePeer(peerId, editName.trim());
    setEditingId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function removePeer(id: string) {
    storage.removePeer(id);
    useAppStore.setState({ peers: storage.getPeers() });
  }

  return (
    <div>
      <h2 className="view-title">Paired Devices</h2>

      {peers.length === 0 ? (
        <div className="card empty-state">
          <p>No devices paired yet.</p>
          <p className="muted">Use the <strong>Pair</strong> tab to add a device.</p>
        </div>
      ) : (
        peers.map(peer => (
          <div key={peer.id} className="card device-card">
            <div className="device-icon">💻</div>
            <div className="device-info">

              {editingId === peer.id ? (
                <div className="device-rename">
                  <input
                    className="rename-input"
                    value={editName}
                    autoFocus
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") saveEdit(peer.id);
                      if (e.key === "Escape") cancelEdit();
                    }}
                  />
                  <div className="rename-actions">
                    <button className="btn-primary" style={{ padding: "4px 12px", fontSize: 13 }} onClick={() => saveEdit(peer.id)}>Save</button>
                    <button className="btn-ghost"   style={{ padding: "4px 10px", fontSize: 13 }} onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="device-name-row">
                  <span className="device-name">{peer.name}</span>
                  <button
                    className="btn-icon"
                    title="Rename this device"
                    onClick={() => startEdit(peer.id, peer.name)}
                  >✏️</button>
                </div>
              )}

              <span className="device-subtext muted" style={{ fontSize: 11 }}>
                ID: {peer.id.slice(0, 16)}…
              </span>
              <span className="device-subtext muted" style={{ fontSize: 11 }}>
                Paired {new Date(peer.addedAt).toLocaleDateString()}
              </span>
            </div>
            <button className="btn-danger" onClick={() => removePeer(peer.id)}>
              Remove
            </button>
          </div>
        ))
      )}

      <div className="card" style={{ marginTop: 16, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          💡 <strong>Tip:</strong> The name you see here is your local nickname for that device. Click ✏️ to rename it to something more descriptive. Your own device name (what others see) is set in <strong>Settings</strong>.
        </p>
      </div>
    </div>
  );
}
