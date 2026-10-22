import { webcrypto, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { derToRaw } from './lock';

describe('derToRaw', () => {
  it('converts WebAuthn DER signatures into the raw form WebCrypto can verify', async () => {
    for (let i = 0; i < 50; i++) {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const data = webcrypto.getRandomValues(new Uint8Array(64));
      const der = sign('sha256', data, privateKey);
      const key = await webcrypto.subtle.importKey('spki', publicKey.export({ type: 'spki', format: 'der' }), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      expect(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(der), data)).toBe(true);
    }
  });
});
