import { useAppStore } from "../store/appStore";
import { storage } from "../lib/storage";
import "./DevicesView.css";

export default function DevicesView() {
  const peers   = useAppStore(s => s.peers);
  const setPeers = () => useAppStore.setState({ peers: storage.getPeers() });

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
            <div className="device-icon">📱</div>
            <div className="device-info">
              <span className="device-name">{peer.name}</span>
              <span className="device-subtext">{peer.id.slice(0, 16)}…</span>
              <span className="device-subtext">Paired {new Date(peer.addedAt).toLocaleDateString()}</span>
            </div>
            <button className="btn-danger" onClick={() => removePeer(peer.id)}>
              Remove
            </button>
          </div>
        ))
      )}
    </div>
  );
}
