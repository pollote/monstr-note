import test from 'node:test';
import assert from 'node:assert';
import { createNewKeypair, parseSecretKey, encryptPayload, decryptPayload, createSignedEvent } from '../src/lib/crypto/nostr-crypto.js';

test('Nostr Crypto - Keypair Generation & Parsing', () => {
  const kp = createNewKeypair();
  assert.ok(kp.secretKeyHex);
  assert.ok(kp.pubkeyHex);
  assert.ok(kp.nsec.startsWith('nsec1'));
  assert.ok(kp.npub.startsWith('npub1'));

  const parsed = parseSecretKey(kp.nsec);
  assert.strictEqual(parsed.secretKeyHex, kp.secretKeyHex);
  assert.strictEqual(parsed.pubkeyHex, kp.pubkeyHex);
});

test('NIP-44 v2 Encryption & Decryption Roundtrip', async () => {
  const kp = createNewKeypair();
  const sampleNote = JSON.stringify({
    id: 'note_123',
    title: 'Encrypted Note Test',
    content: '# Secret Content\nThis note is fully E2E encrypted.'
  });

  const ciphertext = await encryptPayload(sampleNote, kp.secretKeyHex);
  assert.notStrictEqual(ciphertext, sampleNote);
  assert.ok(ciphertext.length > 50);

  const decrypted = await decryptPayload(ciphertext, kp.secretKeyHex);
  assert.strictEqual(decrypted, sampleNote);

  // Assert invalid key fails decryption
  const wrongKp = createNewKeypair();
  await assert.rejects(async () => {
    await decryptPayload(ciphertext, wrongKp.secretKeyHex);
  });
});

test('Nostr Event Signing', async () => {
  const kp = createNewKeypair();
  const event = await createSignedEvent({
    kind: 30078,
    content: 'encrypted_content_here',
    tags: [['d', 'firefox-note:note_123'], ['t', 'firefox-notes']],
    secretKeyHex: kp.secretKeyHex
  });

  assert.strictEqual(event.kind, 30078);
  assert.strictEqual(event.pubkey, kp.pubkeyHex);
  assert.ok(event.sig);
  assert.strictEqual(event.sig.length, 128); // 64-byte Schnorr signature in hex
});
