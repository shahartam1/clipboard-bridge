/**
 * In-memory device registry.
 * Maps deviceId (UUID) → { ws, deviceName, publicKey, pairedWith: Set<deviceId> }
 * Pairings survive reconnects (preserved across re-registrations).
 * No persistence to disk — intentional. Privacy by design.
 */

const devices = new Map();

export const registry = {
  register(deviceId, ws, { deviceName, publicKey }) {
    // Preserve existing pairings if device is re-registering after reconnect
    const existing = devices.get(deviceId);
    const pairedWith = existing ? existing.pairedWith : new Set();
    devices.set(deviceId, { ws, deviceName, publicKey, pairedWith });
    ws.id = deviceId;
  },

  // Called when a device registers with a list of previously-paired peer IDs.
  // This rebuilds pairings after a server restart without needing a full re-pair.
  restorePairings(deviceId, peerIds = []) {
    const device = devices.get(deviceId);
    if (!device) return;
    for (const peerId of peerIds) {
      device.pairedWith.add(peerId);
      // If the peer is already online, restore the link on their side too
      const peer = devices.get(peerId);
      if (peer) peer.pairedWith.add(deviceId);
    }
  },

  unregister(deviceId) {
    devices.delete(deviceId);
  },

  get(deviceId) {
    return devices.get(deviceId) ?? null;
  },

  isOnline(deviceId) {
    return devices.has(deviceId);
  },

  count() {
    return devices.size;
  },

  addPairing(deviceIdA, deviceIdB) {
    devices.get(deviceIdA)?.pairedWith.add(deviceIdB);
    devices.get(deviceIdB)?.pairedWith.add(deviceIdA);
  },

  arePaired(deviceIdA, deviceIdB) {
    return devices.get(deviceIdA)?.pairedWith.has(deviceIdB) ?? false;
  },
};
