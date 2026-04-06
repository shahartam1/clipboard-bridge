import { registry } from './registry.js';
import { pairing } from './pairing.js';
import { log } from './logger.js';

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function sendToDevice(deviceId, obj) {
  const device = registry.get(deviceId);
  if (device) {
    device.ws.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

export function handleMessage(ws, msg) {
  const { type } = msg;

  // Log every incoming message so we can see what the server actually receives
  log('info', 'msg_received', { type, from: ws.id ?? '(unregistered)', to: msg.to ?? null });

  switch (type) {

    // ── Registration ─────────────────────────────────────────────────────────
    case 'REGISTER': {
      const { deviceId, deviceName, publicKey, peerIds } = msg;
      if (!deviceId || !publicKey) {
        return send(ws, { type: 'ERROR', error: 'missing_fields' });
      }
      registry.register(deviceId, ws, { deviceName: deviceName || 'Unknown Device', publicKey });
      // Restore previously-known pairings (sent by client from localStorage)
      if (Array.isArray(peerIds) && peerIds.length > 0) {
        registry.restorePairings(deviceId, peerIds);
      }
      send(ws, { type: 'REGISTERED', deviceId });
      log('info', 'registered', { deviceId, deviceName, peers: peerIds?.length ?? 0 });
      break;
    }

    // ── Pairing: host generates token ─────────────────────────────────────────
    case 'PAIR_CREATE': {
      if (!ws.id) return send(ws, { type: 'ERROR', error: 'not_registered' });
      const { publicKey } = registry.get(ws.id);
      const token = pairing.createToken(ws.id, publicKey);
      send(ws, { type: 'PAIR_TOKEN', token });
      break;
    }

    // ── Pairing: guest submits token ──────────────────────────────────────────
    case 'PAIR_JOIN': {
      if (!ws.id) return send(ws, { type: 'ERROR', error: 'not_registered' });
      const { token } = msg;
      const { publicKey: guestPublicKey } = registry.get(ws.id);
      const result = pairing.consumeToken(token, ws.id, guestPublicKey);

      if (!result.ok) {
        return send(ws, { type: 'PAIR_ERROR', error: result.error });
      }

      // Notify both sides with each other's public key
      send(ws, {
        type: 'PAIR_SUCCESS',
        peerId: result.hostId,
        peerPublicKey: result.hostPublicKey,
      });

      sendToDevice(result.hostId, {
        type: 'PAIR_SUCCESS',
        peerId: result.guestId,
        peerPublicKey: result.guestPublicKey,
      });
      break;
    }

    // ── Relay: blind forward (server never decrypts payload) ─────────────────
    case 'RELAY': {
      if (!ws.id) return send(ws, { type: 'ERROR', error: 'not_registered' });
      const { to, msgId, payload } = msg;

      const paired = registry.arePaired(ws.id, to);
      const targetOnline = registry.isOnline(to);
      log('info', 'relay_attempt', { from: ws.id, to, paired, targetOnline, msgId });

      if (!paired) {
        log('warn', 'relay_rejected_not_paired', { from: ws.id, to });
        return send(ws, { type: 'ERROR', error: 'not_paired' });
      }

      const delivered = sendToDevice(to, {
        type: 'RELAY',
        from: ws.id,
        msgId,
        payload, // opaque encrypted blob — server never sees plaintext
        ts: Date.now(),
      });

      send(ws, {
        type: 'ACK',
        msgId,
        status: delivered ? 'delivered' : 'peer_offline',
      });
      break;
    }

    // ── WebRTC signaling (for P2P upgrade) ───────────────────────────────────
    case 'WEBRTC_OFFER':
    case 'WEBRTC_ANSWER':
    case 'ICE_CANDIDATE': {
      if (!ws.id) return send(ws, { type: 'ERROR', error: 'not_registered' });
      const { to } = msg;
      if (!registry.arePaired(ws.id, to)) {
        return send(ws, { type: 'ERROR', error: 'not_paired' });
      }
      sendToDevice(to, { ...msg, from: ws.id });
      break;
    }

    // ── Heartbeat ────────────────────────────────────────────────────────────
    case 'PING': {
      send(ws, { type: 'PONG', ts: Date.now() });
      break;
    }

    default:
      send(ws, { type: 'ERROR', error: `unknown_type:${type}` });
  }
}
