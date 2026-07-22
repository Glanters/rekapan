import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  AccountCenterCryptoError,
  decrypt,
  deriveKey,
  encrypt,
  generateIv,
} from './crypto';
import { PhpJsonEncodeError, phpJsonEncode } from './php-json';
import { buildLoginRequest } from './signing';
import fixture from './__fixtures__/php-vectors.json';

/**
 * Parity suite for the Account Center crypto port.
 *
 * Every expectation below is a value produced by the customer's real PHP
 * library, captured by `tools/php-parity/generate-vectors.php`. A failure here
 * means the TypeScript port has drifted from PHP — which in production would
 * surface as an opaque signature rejection at login, so it is caught here.
 *
 * Regenerate the fixture with:  php tools/php-parity/generate-vectors.php
 */

const KEY = deriveKey(fixture.secret);

describe('deriveKey', () => {
  it('reproduces the md5 hex digest PHP uses as the key', () => {
    expect(KEY.toString('latin1')).toBe(fixture.key);
  });

  it('yields 32 bytes by treating the hex digest as ASCII, not decoding it', () => {
    expect(KEY).toHaveLength(32);
    // The hex-decoded form would be 16 bytes and would silently select AES-128
    // semantics in a less strict implementation.
    expect(Buffer.from(fixture.key, 'hex')).toHaveLength(16);
  });
});

describe('encrypt / decrypt against PHP golden vectors', () => {
  it.each(fixture.aesVectors)('encrypt matches PHP for $label', (vector) => {
    expect(encrypt(vector.plaintext, KEY, vector.iv)).toBe(vector.ciphertext);
  });

  it.each(fixture.aesVectors)('decrypt matches PHP for $label', (vector) => {
    expect(decrypt(vector.ciphertext, KEY, vector.ivBase64)).toBe(vector.plaintext);
  });

  it.each(fixture.aesVectors)('round-trips $label', (vector) => {
    const ivBase64 = Buffer.from(vector.iv, 'latin1').toString('base64');
    expect(decrypt(encrypt(vector.plaintext, KEY, vector.iv), KEY, ivBase64)).toBe(
      vector.plaintext,
    );
  });

  it.each(fixture.aesVectors)(
    'emits double base64 for $label — one decode still yields base64',
    (vector) => {
      const once = Buffer.from(vector.ciphertext, 'base64').toString('latin1');
      expect(once).toBe(vector.innerBase64);
      expect(once).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    },
  );
});

describe('IV handling', () => {
  it('generates 16 lowercase hex characters, matching PHP getIV()', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateIv()).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('does not repeat across calls', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateIv()));
    expect(seen.size).toBe(500);
  });

  it('rejects an IV of the wrong length rather than silently truncating', () => {
    expect(() => encrypt('x', KEY, 'too-short')).toThrow(AccountCenterCryptoError);
    expect(() => encrypt('x', KEY, 'a'.repeat(17))).toThrow(AccountCenterCryptoError);
    expect(() => decrypt('AAAA', KEY, Buffer.from('short').toString('base64'))).toThrow(
      AccountCenterCryptoError,
    );
  });

  it('honours the encrypt/decrypt asymmetry inherited from PHP', () => {
    const vector = fixture.aesVectors[0]!;
    // decrypt() expects a BASE64 iv; handing it the raw iv must fail loudly.
    expect(() => decrypt(vector.ciphertext, KEY, vector.iv)).toThrow();
  });
});

describe('phpJsonEncode', () => {
  it.each(fixture.jsonVectors)('matches PHP json_encode for $label', (vector) => {
    expect(phpJsonEncode(vector.value)).toBe(vector.encoded);
  });

  it('escapes forward slashes the way PHP does', () => {
    expect(phpJsonEncode({ u: 'a/b' })).toBe('{"u":"a\\/b"}');
    expect(JSON.stringify({ u: 'a/b' })).toBe('{"u":"a/b"}');
  });

  it('leaves DEL raw, matching PHP', () => {
    expect(phpJsonEncode({ s: '\x7f' })).toBe('{"s":"\x7f"}');
  });

  it('refuses numbers, which PHP and JavaScript format differently', () => {
    expect(() => phpJsonEncode({ n: 1 })).toThrow(PhpJsonEncodeError);
    expect(() => phpJsonEncode({ a: { b: [1] } })).toThrow(/a\.b\[0\]/);
  });
});

describe('buildLoginRequest against PHP golden payloads', () => {
  it.each(fixture.loginPayloads)(
    'reproduces the body, signature, and headers for $label',
    (payload) => {
      const request = buildLoginRequest({
        email: payload.email,
        password: payload.password,
        secret: fixture.secret,
        clientId: fixture.clientId,
        iv: payload.iv,
      });

      expect(request.body).toBe(payload.jsonBody);
      expect(request.headers.Signature).toBe(payload.signature);
      expect(request.headers['X-Client-Id']).toBe(payload.headers['X-Client-Id']);
      expect(request.headers['X-Client-Iv']).toBe(payload.headers['X-Client-Iv']);
    },
  );

  it('encrypts the password before embedding it in the body', () => {
    const payload = fixture.loginPayloads[0]!;
    expect(request(payload).body).toContain(payload.encryptedPassword);
    expect(request(payload).body).not.toContain(payload.password);

    function request(p: (typeof fixture.loginPayloads)[number]) {
      return buildLoginRequest({
        email: p.email,
        password: p.password,
        secret: fixture.secret,
        clientId: fixture.clientId,
        iv: p.iv,
      });
    }
  });

  it('uses a fresh IV per request when none is pinned', () => {
    const args = {
      email: 'a@b.com',
      password: 'x',
      secret: fixture.secret,
      clientId: fixture.clientId,
    };
    expect(buildLoginRequest(args).iv).not.toBe(buildLoginRequest(args).iv);
  });
});

describe('structural property relied upon by the signing contract', () => {
  it('confirms PHP observed no + or / in 20k double-base64 samples', () => {
    expect(fixture.structuralProperty.holds).toBe(true);
    expect(fixture.structuralProperty.plusOrSlashHits).toBe(0);
  });

  it('holds for the TypeScript port too', () => {
    // Double base64 can never emit index 62 (+) or 63 (/): the inner layer
    // produces only bytes below 0x80, which bounds every six-bit group below 62.
    // That is why json_encode never finds a slash to escape in the password.
    for (let i = 0; i < 2000; i += 1) {
      const sample = encrypt(`payload-${i}-${'x'.repeat(i % 40)}`, KEY, generateIv());
      expect(sample).not.toMatch(/[+/]/);
    }
  });
});
