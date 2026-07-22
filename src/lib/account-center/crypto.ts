import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * TypeScript port of the customer's `App\Library\AesCbc256` PHP library.
 *
 * The reference implementation lives at `tools/php-parity/AesCbc256.php` and
 * golden vectors generated from it are asserted in `crypto.test.ts`. Any change
 * here that diverges from PHP fails those tests instead of failing production
 * logins with an opaque signature rejection.
 *
 * Three details of the PHP original are load-bearing and easy to lose:
 *
 * 1. The key is `md5($secret)` — a 32-character *hex string* that PHP hands to
 *    OpenSSL as 32 raw ASCII bytes. It is NOT hex-decoded to 16 bytes.
 * 2. `openssl_encrypt` is called with `$options = false`, which already returns
 *    base64; the result is then `base64_encode`d again. Output is DOUBLE base64.
 * 3. `encrypt()` takes a RAW iv while `decrypt()` base64-decodes its iv. The
 *    asymmetry is intentional on the wire: the IV travels as `X-Client-Iv` in
 *    base64, so responses are decrypted with the base64 form.
 */

const CIPHER = 'aes-256-cbc';

/** AES-256 requires a 32-byte key; `md5()` hex happens to be exactly 32 chars. */
const KEY_BYTES = 32;

/** AES-CBC requires a 16-byte IV; PHP slices `md5()` hex to 16 chars. */
const IV_BYTES = 16;

/**
 * PHP strings are byte arrays. Every value crossing this boundary — the md5 key,
 * the hex IV — is ASCII, so a byte-per-character encoding reproduces PHP exactly.
 */
const PHP_BYTES: BufferEncoding = 'latin1';

export class AccountCenterCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountCenterCryptoError';
  }
}

/**
 * Derives the AES key the way `AccountCenter::__construct` does: `md5($secret)`.
 *
 * @param secret - `services.accountcenter.secret` from the Laravel config.
 * @returns A 32-byte key: the md5 hex digest treated as ASCII, not hex-decoded.
 */
export function deriveKey(secret: string): Buffer {
  const md5Hex = createHash('md5').update(secret, 'utf8').digest('hex');
  const key = Buffer.from(md5Hex, PHP_BYTES);

  /* istanbul ignore next -- md5 hex is always 32 chars; guards against refactors. */
  if (key.length !== KEY_BYTES) {
    throw new AccountCenterCryptoError(
      `Derived key must be ${KEY_BYTES} bytes, got ${key.length}.`,
    );
  }
  return key;
}

/**
 * Produces an IV in the same shape as PHP's `getIV()`: 16 lowercase hex chars.
 *
 * DELIBERATE DEVIATION: the original seeds from `uniqid()`, which is derived
 * from the current time and therefore predictable. This uses a CSPRNG instead.
 * The output shape and wire format are identical, so the server cannot tell the
 * difference — it is strictly stronger, not merely different.
 */
export function generateIv(): string {
  return randomBytes(IV_BYTES).toString('hex').slice(0, IV_BYTES);
}

function toIvBuffer(iv: string, label: string): Buffer {
  const buf = Buffer.from(iv, PHP_BYTES);
  if (buf.length !== IV_BYTES) {
    throw new AccountCenterCryptoError(
      `${label} must be ${IV_BYTES} bytes, got ${buf.length}.`,
    );
  }
  return buf;
}

/**
 * Mirrors `AesCbc256::encrypt()`.
 *
 * @param plaintext - Encoded as UTF-8, matching PHP's handling of JSON strings.
 * @param key - From {@link deriveKey}.
 * @param iv - RAW 16-character IV (not base64), as the PHP signature expects.
 * @returns Double-base64 ciphertext.
 */
export function encrypt(plaintext: string, key: Buffer, iv: string): string {
  const cipher = createCipheriv(CIPHER, key, toIvBuffer(iv, 'IV'));

  // `$options = false` in PHP means "return base64", which this reproduces.
  const inner = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]).toString('base64');

  // ...and then PHP base64-encodes that base64 string a second time.
  return Buffer.from(inner, PHP_BYTES).toString('base64');
}

/**
 * Mirrors `AesCbc256::decrypt()`.
 *
 * @param payload - Double-base64 ciphertext.
 * @param key - From {@link deriveKey}.
 * @param ivBase64 - BASE64-encoded IV, i.e. the `X-Client-Iv` header value.
 *   Note the asymmetry with {@link encrypt}, which takes the raw IV.
 * @returns The decrypted UTF-8 plaintext.
 */
export function decrypt(payload: string, key: Buffer, ivBase64: string): string {
  const inner = Buffer.from(payload, 'base64').toString(PHP_BYTES);
  const iv = Buffer.from(ivBase64, 'base64');

  if (iv.length !== IV_BYTES) {
    throw new AccountCenterCryptoError(
      `Decoded IV must be ${IV_BYTES} bytes, got ${iv.length}.`,
    );
  }

  const decipher = createDecipheriv(CIPHER, key, iv);
  return Buffer.concat([
    decipher.update(Buffer.from(inner, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
