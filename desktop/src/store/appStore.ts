import { create } from "zustand";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { storage, type PeerInfo, type Identity } from "../lib/storage";
import { encrypt, decrypt, type EncryptedPayload } from "../lib/crypto";
import { connect, onMessage, sendMsg } from "../lib/ws";

const SERVER_HTTP = (import.meta.env.VITE_SERVER_URL ?? "ws://localhost:8787").replace(/^ws/, 'http');
function remoteLog(data: Record<string, unknown>) {
  fetch(`${SERVER_HTTP}/debug-log`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => {});
}

export type Tab = "send" | "devices" | "pair" | "history" | "settings";

export interface ClipItem {
  id: string;
  fromId: string;
  fromName: string;
  dataType: "text" | "url" | "file_meta";
  content: string;
  fileName?: string;
  fileSize?: number;
  receivedAt: number;
}

interface AppState {
  identity: Identity;
  peers: PeerInfo[];
  connected: boolean;
  activeTab: Tab;
  clipHistory: ClipItem[];
  pairingToken: string | null;
  pairingStatus: "idle" | "waiting" | "joining" | "success" | "error";
  pairingError: string | null;
  sendStatus: Record<string, "sending" | "delivered" | "offline">;

  // Quick Send Picker (hotkey flow)
  pickerOpen: boolean;
  pickerText: string | null;

  // Actions
  init: () => void;
  setTab: (tab: Tab) => void;
  setDeviceName: (name: string) => void;
  requestPairToken: () => void;
  joinPairToken: (token: string) => void;
  sendClip: (peerId: string, content: string, dataType?: "text" | "url") => void;
  copyToClipboard: (content: string) => void;
  dismissClip: (id: string) => void;
  closePicker: () => void;
  renamePeer: (peerId: string, newName: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  identity: storage.getOrCreateIdentity(),
  peers: storage.getPeers(),
  connected: false,
  activeTab: "send",
  clipHistory: [],
  pairingToken: null,
  pairingStatus: "idle",
  pairingError: null,
  sendStatus: {},
  pickerOpen: false,
  pickerText: null,

  init() {
    const { identity, peers } = get();
    // Pass peer IDs so server can restore pairings after restart
    const peerIds = peers.map(p => p.id);
    connect(identity.deviceId, identity.deviceName, identity.keyPair.publicKey, peerIds);

    // Dev helper: window.testSend() — call from WebKit inspector console to test relay
    if (import.meta.env.DEV) {
      (window as any).testSend = () => {
        const { peers: ps } = get();
        if (ps.length === 0) { console.error('[testSend] No peers!'); return; }
        const msg = '🧪 Test ' + new Date().toLocaleTimeString();
        console.log('[testSend] Sending to', ps[0].id, msg);
        get().sendClip(ps[0].id, msg, 'text');
        console.log('[testSend] Called sendClip ✓');
      };
      console.log('%c[ClipBridge Dev] Call window.testSend() to test relay delivery', 'color: cyan; font-weight: bold');

      // Auto-test: fire once, 4 seconds after startup, if there are peers
      const autoTestKey = '__cbAutoTested_v4';
      if (!(window as any)[autoTestKey]) {
        (window as any)[autoTestKey] = true;
        setTimeout(() => {
          const { peers: ps } = get();
          if (ps.length === 0) {
            remoteLog({ event: 'auto_test_skip', reason: 'no_peers' });
            return;
          }
          const msg = '🧪 Auto-test ' + new Date().toLocaleTimeString();
          remoteLog({ event: 'auto_test_start', to: ps[0].id, msg });
          console.log('[auto-test] Firing test send to', ps[0].id);
          get().sendClip(ps[0].id, msg, 'text');
        }, 4000);
      }
    }

    onMessage((msg) => {
      const type = msg.type as string;

      if (type === "REGISTERED") set({ connected: true });
      if (type === "DISCONNECTED") set({ connected: false });

      if (type === "PAIR_TOKEN") {
        set({ pairingToken: msg.token as string, pairingStatus: "waiting" });
      }

      if (type === "PAIR_SUCCESS") {
        const peerId = msg.peerId as string;
        const peerPublicKey = msg.peerPublicKey as string;
        const newPeer: PeerInfo = {
          id: peerId,
          name: (msg.peerName as string | undefined) ?? `Device-${peerId.slice(0, 6)}`,
          publicKey: peerPublicKey,
          addedAt: Date.now(),
        };
        storage.addPeer(newPeer);
        set({ peers: storage.getPeers(), pairingStatus: "success", pairingToken: null });
      }

      if (type === "PAIR_ERROR") {
        set({ pairingStatus: "error", pairingError: msg.error as string });
      }

      if (type === "RELAY") {
        const fromId = msg.from as string;
        const peers = get().peers;
        const peer = peers.find(p => p.id === fromId);
        if (!peer) return;

        const { identity } = get();
        const payloadStr = decrypt(
          msg.payload as EncryptedPayload,
          identity.keyPair.secretKey,
          peer.publicKey
        );
        if (!payloadStr) return;

        const inner = JSON.parse(payloadStr) as {
          dataType: "text" | "url" | "file_meta";
          content: string;
          fileName?: string;
          fileSize?: number;
        };

        const item: ClipItem = {
          id: msg.msgId as string,
          fromId,
          fromName: peer.name,
          dataType: inner.dataType,
          content: inner.content,
          fileName: inner.fileName,
          fileSize: inner.fileSize,
          receivedAt: Date.now(),
        };

        // ── Auto-copy to system clipboard on receive ──────────────
        writeText(inner.content).catch(() => {
          navigator.clipboard.writeText(inner.content).catch(() => {});
        });

        // ── OS notification ──────────────────────────────────────
        (async () => {
          try {
            let granted = await isPermissionGranted();
            if (!granted) {
              const perm = await requestPermission();
              granted = perm === "granted";
            }
            if (granted) {
              const isUrl = inner.dataType === "url";
              sendNotification({
                title: `📋 ClipBridge — from ${item.fromName}`,
                body: isUrl
                  ? `🔗 ${inner.content.slice(0, 80)}`
                  : inner.content.slice(0, 100),
              });
            }
          } catch { /* notifications not available in dev browser */ }
        })();

        set(s => ({ clipHistory: [item, ...s.clipHistory].slice(0, 50) }));
      }

      if (type === "ACK") {
        const msgId = msg.msgId as string;
        const status = msg.status as string;
        set(s => ({
          sendStatus: {
            ...s.sendStatus,
            [msgId]: status === "delivered" ? "delivered" : "offline",
          },
        }));
      }

      if (type === "ERROR") {
        // Log server errors so they're visible in devtools console
        console.error("[ClipBridge server error]", msg.error);
      }
    });
  },

  setTab(tab) { set({ activeTab: tab }); },

  setDeviceName(name) {
    storage.setDeviceName(name);
    set(s => ({ identity: { ...s.identity, deviceName: name } }));
  },

  requestPairToken() {
    set({ pairingStatus: "waiting", pairingToken: null, pairingError: null });
    sendMsg({ type: "PAIR_CREATE" });
  },

  joinPairToken(token) {
    set({ pairingStatus: "joining", pairingError: null });
    sendMsg({ type: "PAIR_JOIN", token });
  },

  sendClip(peerId, content, dataType = "text") {
    const { identity, peers } = get();
    const peer = peers.find(p => p.id === peerId);
    const logBase = { fn: 'sendClip', to: peerId, peerFound: !!peer, myId: identity.deviceId, peerList: peers.map(p => p.id) };
    console.log('[sendClip] to:', peerId, '| peer found:', !!peer, '| myId:', identity.deviceId);
    remoteLog(logBase);

    if (!peer) {
      console.error('[sendClip] ABORTED — peer not found in list. peers:', peers.map(p => p.id));
      remoteLog({ ...logBase, result: 'ABORTED_PEER_NOT_FOUND' });
      return;
    }

    const msgId = crypto.randomUUID();
    const inner = JSON.stringify({ dataType, content });

    let payload;
    try {
      payload = encrypt(inner, identity.keyPair.secretKey, peer.publicKey);
      remoteLog({ ...logBase, result: 'encrypt_ok', msgId, peerPubKey: peer.publicKey.slice(0, 12) });
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error('[sendClip] encrypt() THREW:', errMsg);
      remoteLog({ ...logBase, result: 'encrypt_THREW', error: errMsg, msgId });
      return;
    }

    console.log('[sendClip] calling sendMsg RELAY msgId:', msgId);
    remoteLog({ ...logBase, result: 'calling_sendMsg', msgId });
    set(s => ({ sendStatus: { ...s.sendStatus, [msgId]: "sending" } }));
    try {
      sendMsg({ type: "RELAY", to: peerId, msgId, payload });
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      remoteLog({ ...logBase, result: 'sendMsg_THREW', error: errMsg, msgId });
    }
  },

  copyToClipboard(content) {
    writeText(content).catch(() => {
      navigator.clipboard.writeText(content).catch(() => {});
    });
  },

  dismissClip(id) {
    set(s => ({ clipHistory: s.clipHistory.filter(c => c.id !== id) }));
  },

  closePicker() {
    set({ pickerOpen: false, pickerText: null });
  },

  renamePeer(peerId, newName) {
    const peers = get().peers;
    const peer = peers.find(p => p.id === peerId);
    if (!peer) return;
    storage.addPeer({ ...peer, name: newName.trim() || peer.name });
    set({ peers: storage.getPeers() });
  },
}));
