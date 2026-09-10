import { generateSecretKey, getPublicKey, finalizeEvent, nip19, nip44 } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/**
 * Universal execution helper for NIP-07 functions (nos2x-fox, nos2x, Alby, Amber).
 * Communicates via Extension Runtime Bridge to active web tab where nos2x is injected!
 */
export async function executeNip07Method(methodName, args = []) {
  const extensionApi = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);

  // 1. Direct check in local frame if window.nostr is directly present
  if (typeof window !== 'undefined' && window.nostr) {
    const fn = getNestedMethod(window.nostr, methodName);
    if (fn) return await fn(...args);
  }

  // 2. Extension runtime bridge (Sidebar/Popup -> Background -> Tab Content Script -> window.nostr)
  if (extensionApi && extensionApi.runtime && extensionApi.runtime.sendMessage) {
    const res = await new Promise((resolve) => {
      extensionApi.runtime.sendMessage({
        type: 'NIP07_REQUEST',
        method: methodName,
        args
      }, (reply) => resolve(reply || { ok: false, error: 'Extension runtime bridge unavailable.' }));
    });

    if (res && res.ok) {
      return res.result;
    }
    if (res && res.error) {
      throw new Error(res.error);
    }
  }

  throw new Error('No NIP-07 Nostr extension (like nos2x or Alby) detected. Please open a webpage tab (e.g. Deepmarks or https://example.com) with nos2x active.');
}

function getNestedMethod(obj, pathStr) {
  const parts = pathStr.split('.');
  let current = obj;
  for (const p of parts) {
    if (!current || typeof current !== 'object') return null;
    current = current[p];
  }
  return typeof current === 'function' ? current.bind(obj) : null;
}

/**
 * Check if a NIP-07 Nostr browser extension (e.g. nos2x-fox, Alby, nos2x) is available
 */
export function isNip07Available() {
  if (typeof window !== 'undefined' && (window.nostr || window.parent?.nostr || window.top?.nostr)) {
    return true;
  }
  const extensionApi = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  return !!(extensionApi && extensionApi.runtime);
}

/**
 * Get public key from NIP-07 extension (nos2x-fox / Alby / nos2x)
 */
export async function getNip07PublicKey() {
  const pubkey = await executeNip07Method('getPublicKey');
  if (!pubkey) {
    throw new Error('Extension refused access to public key');
  }
  return {
    pubkeyHex: pubkey,
    npub: nip19.npubEncode(pubkey)
  };
}

/**
 * Generate a new random secret key and return hex + bech32 nsec/npub
 */
export function createNewKeypair() {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const secretHex = bytesToHex(secretKey);
  const nsec = nip19.nsecEncode(secretKey);
  const npub = nip19.npubEncode(pubkey);

  return {
    secretKeyHex: secretHex,
    pubkeyHex: pubkey,
    nsec,
    npub
  };
}

/**
 * Parse any key input (nsec, hex secret key, or passphrase seed) into valid hex secret key & pubkey
 */
export function parseSecretKey(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Invalid secret key input');
  }
  const cleanInput = input.trim();

  if (cleanInput.startsWith('nsec1')) {
    try {
      const decoded = nip19.decode(cleanInput);
      if (decoded.type === 'nsec') {
        const sk = decoded.data;
        const secretHex = bytesToHex(sk);
        const pubkey = getPublicKey(sk);
        return {
          secretKeyHex: secretHex,
          pubkeyHex: pubkey,
          nsec: cleanInput,
          npub: nip19.npubEncode(pubkey)
        };
      }
    } catch (err) {
      throw new Error('Invalid nsec Bech32 string: ' + err.message);
    }
  }

  if (/^[0-9a-fA-F]{64}$/.test(cleanInput)) {
    const sk = hexToBytes(cleanInput);
    const pubkey = getPublicKey(sk);
    return {
      secretKeyHex: cleanInput.toLowerCase(),
      pubkeyHex: pubkey,
      nsec: nip19.nsecEncode(sk),
      npub: nip19.npubEncode(pubkey)
    };
  }

  throw new Error('Secret key must be a valid nsec (bech32) or 64-character hex string');
}

/**
 * Get NIP-44 v2 conversation key for self-encryption
 */
export function getSelfConversationKey(secretKeyHex) {
  const sk = hexToBytes(secretKeyHex);
  const pk = getPublicKey(sk);
  return nip44.v2.utils.getConversationKey(sk, pk);
}

function normalizeSignerConfig(signerOrSecretKey) {
  if (typeof signerOrSecretKey === 'string') {
    const sk = hexToBytes(signerOrSecretKey);
    return {
      type: 'vault',
      secretKeyHex: signerOrSecretKey,
      pubkeyHex: getPublicKey(sk)
    };
  }
  if (signerOrSecretKey && !signerOrSecretKey.pubkeyHex && signerOrSecretKey.secretKeyHex) {
    const sk = hexToBytes(signerOrSecretKey.secretKeyHex);
    return {
      type: 'vault',
      secretKeyHex: signerOrSecretKey.secretKeyHex,
      pubkeyHex: getPublicKey(sk)
    };
  }
  return signerOrSecretKey;
}

/**
 * Encrypt text payload supporting both Vault mode and NIP-07 (nos2x-fox) mode
 */
export async function encryptPayload(plaintext, signerOrSecretKey) {
  const config = normalizeSignerConfig(signerOrSecretKey);
  if (config.type === 'nip07') {
    return await executeNip07Method('nip44.encrypt', [config.pubkeyHex, plaintext]);
  }

  const convKey = getSelfConversationKey(config.secretKeyHex);
  return nip44.v2.encrypt(plaintext, convKey);
}

/**
 * Decrypt NIP-44 payload supporting both Vault mode and NIP-07 (nos2x-fox) mode
 */
export async function decryptPayload(ciphertext, signerOrSecretKey) {
  const config = normalizeSignerConfig(signerOrSecretKey);
  if (config.type === 'nip07') {
    return await executeNip07Method('nip44.decrypt', [config.pubkeyHex, ciphertext]);
  }

  const convKey = getSelfConversationKey(config.secretKeyHex);
  return nip44.v2.decrypt(ciphertext, convKey);
}

/**
 * Create and sign a Nostr event supporting both Vault mode and NIP-07 (nos2x-fox) mode
 */
export async function createSignedEvent({ kind, content, tags = [], signerConfig, secretKeyHex, createdAt = Math.floor(Date.now() / 1000) }) {
  const config = normalizeSignerConfig(signerConfig || secretKeyHex);
  const eventTemplate = {
    kind,
    created_at: createdAt,
    tags,
    content,
    pubkey: config.pubkeyHex
  };

  if (config.type === 'nip07') {
    return await executeNip07Method('signEvent', [eventTemplate]);
  }

  const sk = hexToBytes(config.secretKeyHex);
  return finalizeEvent(eventTemplate, sk);
}
