/**
 * In-memory device registry.
 * Maps deviceId (UUID) → { ws, deviceName, publicKey, pairedWith: Set<deviceId> }
 * No persistence — intentional. Privacy by design.
 */

const devices = new Map();

export const registry = {
  register(deviceId, ws, { deviceName, publicKey }) {
    devices.set(deviceId, { ws, deviceName, publicKey, pairedWith: new Set() });
    ws.id = deviceId;
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
