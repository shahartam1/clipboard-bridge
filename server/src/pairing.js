import { nanoid } from 'nanoid';
import { registry } from './registry.js';
import { log } from './logger.js';

// Simple wordlist for human-readable pairing codes (EFF short list subset)
const WORDS = [
  'acid','ball','camp','dark','echo','film','grip','hour','iron','jump',
  'king','lamp','mask','nail','open','pave','quip','rust','sand','talk',
  'unit','volt','wind','xray','yard','zinc','arch','beam','cool','dust',
  'easy','fair','gold','heat','idea','jail','keen','leaf','mint','navy',
  'oval','peak','quiz','rain','silk','task','ugly','vane','wave','xmas',
];

function randomWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

// token → { hostId, hostPublicKey, expiresAt }
const pendingTokens = new Map();

// Clean up expired tokens every 30s
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of pendingTokens) {
    if (entry.expiresAt < now) pendingTokens.delete(token);
  }
}, 30_000);

export const pairing = {
  createToken(hostId, hostPublicKey) {
    const token = `${randomWord()}-${randomWord()}-${randomWord()}`;
    pendingTokens.set(token, {
      hostId,
      hostPublicKey,
      expiresAt: Date.now() + 2 * 60 * 1000, // 2 min TTL
    });
    log('info', 'pair_token_created', { hostId, token });
    return token;
  },

  consumeToken(token, guestId, guestPublicKey) {
    const entry = pendingTokens.get(token);

    if (!entry) return { ok: false, error: 'invalid_token' };
    if (entry.expiresAt < Date.now()) {
      pendingTokens.delete(token);
      return { ok: false, error: 'token_expired' };
    }
    if (entry.hostId === guestId) return { ok: false, error: 'cannot_pair_with_self' };

    pendingTokens.delete(token);
    registry.addPairing(entry.hostId, guestId);

    log('info', 'pair_success', { hostId: entry.hostId, guestId });

    return {
      ok: true,
      hostId: entry.hostId,
      hostPublicKey: entry.hostPublicKey,
      guestId,
      guestPublicKey,
    };
  },
};
