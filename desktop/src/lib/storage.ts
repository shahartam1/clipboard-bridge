/**
 * Persistent local storage for device identity and paired peers.
 * In production this would use the OS keychain via Tauri's credential plugin.
 * For PoC we use localStorage (acceptable since this is a desktop app with no shared profile).
 */

import { generateDeviceId, generateKeyPair, type KeyPair } from "./crypto";

const KEYS = {
  DEVICE_ID: "cb_device_id",
  KEY_PAIR: "cb_key_pair",
  DEVICE_NAME: "cb_device_name",
  PEERS: "cb_peers",
} as const;

export interface PeerInfo {
  id: string;
  name: string;
  publicKey: string;
  addedAt: number;
}

export interface Identity {
  deviceId: string;
  deviceName: string;
  keyPair: KeyPair;
}

export const storage = {
  getOrCreateIdentity(): Identity {
    let deviceId = localStorage.getItem(KEYS.DEVICE_ID);
    let keyPairRaw = localStorage.getItem(KEYS.KEY_PAIR);
    let deviceName = localStorage.getItem(KEYS.DEVICE_NAME);

    if (!deviceId || !keyPairRaw) {
      deviceId = generateDeviceId();
      const keyPair = generateKeyPair();
      keyPairRaw = JSON.stringify(keyPair);
      localStorage.setItem(KEYS.DEVICE_ID, deviceId);
      localStorage.setItem(KEYS.KEY_PAIR, keyPairRaw);
    }

    if (!deviceName) {
      deviceName = `Device-${deviceId.slice(0, 6)}`;
      localStorage.setItem(KEYS.DEVICE_NAME, deviceName);
    }

    return {
      deviceId,
      deviceName,
      keyPair: JSON.parse(keyPairRaw) as KeyPair,
    };
  },

  setDeviceName(name: string) {
    localStorage.setItem(KEYS.DEVICE_NAME, name);
  },

  getPeers(): PeerInfo[] {
    const raw = localStorage.getItem(KEYS.PEERS);
    return raw ? (JSON.parse(raw) as PeerInfo[]) : [];
  },

  addPeer(peer: PeerInfo) {
    const peers = storage.getPeers().filter(p => p.id !== peer.id);
    peers.push(peer);
    localStorage.setItem(KEYS.PEERS, JSON.stringify(peers));
  },

  removePeer(peerId: string) {
    const peers = storage.getPeers().filter(p => p.id !== peerId);
    localStorage.setItem(KEYS.PEERS, JSON.stringify(peers));
  },
};
