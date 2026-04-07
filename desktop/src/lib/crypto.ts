/**
 * Crypto layer — X25519 key exchange + XSalsa20-Poly1305 (via TweetNaCl)
 * Everything here runs client-side only. Server never sees plaintext.
 *
 * NOTE: We use the native TextEncoder/TextDecoder instead of tweetnacl-util's
 * encodeUTF8/decodeUTF8 because the latter returns a plain String in some Vite/ESM
 * environments, which causes nacl.box.after to throw "unexpected type, use Uint8Array".
 */
import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";

export interface KeyPair {
  publicKey: string;  // base64
  secretKey: string;  // base64
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}

export function generateDeviceId(): string {
  const bytes = nacl.randomBytes(16);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "4" + hex.slice(13, 16),  // version 4
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** Derive a shared key from our secret key + peer's public key */
function sharedKey(mySecretKey: string, peerPublicKey: string): Uint8Array {
  return nacl.box.before(decodeBase64(peerPublicKey), decodeBase64(mySecretKey));
}

export interface EncryptedPayload {
  nonce: string;   // base64
  box: string;     // base64
}

export function encrypt(
  plaintext: string,
  mySecretKey: string,
  peerPublicKey: string
): EncryptedPayload {
  const key = sharedKey(mySecretKey, peerPublicKey);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const msg = encoder.encode(plaintext);        // TextEncoder → always Uint8Array ✓
  const encrypted = nacl.box.after(msg, nonce, key);
  return {
    nonce: encodeBase64(nonce),
    box: encodeBase64(encrypted),
  };
}

export function decrypt(
  payload: EncryptedPayload,
  mySecretKey: string,
  peerPublicKey: string
): string | null {
  try {
    const key = sharedKey(mySecretKey, peerPublicKey);
    const decrypted = nacl.box.open.after(
      decodeBase64(payload.box),
      decodeBase64(payload.nonce),
      key
    );
    if (!decrypted) return null;
    return decoder.decode(decrypted);           // TextDecoder → always works ✓
  } catch {
    return null;
  }
}
