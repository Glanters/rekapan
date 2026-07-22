import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { encryptionKeyBytes } from '@/lib/env';

/**
 * Authenticated encryption for secrets held in the database.
 *
 * GCM rather than CBC: it authenticates as well as encrypts, so a tampered
 * ciphertext fails loudly instead of decrypting to attacker-influenced bytes.
 * (The CBC implementation elsewhere in this codebase exists only to match the
 * Account Center wire protocol, which is not ours to change.)
 *
 * Output is `v1.<iv>.<tag>.<ciphertext>`, all base64url. The version prefix is
 * what makes key rotation possible later without guessing at old rows.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const VERSION = 'v1';

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKeyBytes, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4) {
    throw new DecryptionError('Malformed ciphertext: expected four segments.');
  }

  const [version, ivPart, tagPart, dataPart] = parts as [
    string,
    string,
    string,
    string,
  ];
  if (version !== VERSION) {
    throw new DecryptionError(`Unsupported ciphertext version "${version}".`);
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      encryptionKeyBytes,
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Covers the authentication-tag mismatch that signals tampering. The
    // underlying error is deliberately not chained: its message describes the
    // cipher's internal state, which is not something to hand back to a caller.
    throw new DecryptionError(
      'Ciphertext failed authentication or could not be decrypted.',
    );
  }
}

/**
 * Constant-time string comparison.
 *
 * Length is compared first and leaks, which is acceptable — the values this
 * guards are fixed-length digests. Content comparison is what must not leak.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
