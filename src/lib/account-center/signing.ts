import { Buffer } from 'node:buffer';

import { deriveKey, encrypt, generateIv } from './crypto';
import { phpJsonEncode } from './php-json';

/**
 * Request signing for the Account Center, mirroring `AccountCenter::login()`
 * in the customer's Laravel library (`tools/php-parity/AccountCenter.php`).
 */

export interface SignedRequest {
  /**
   * The exact JSON body to transmit.
   *
   * Send this string verbatim. Re-serialising the parsed object would produce
   * different bytes than the ones covered by `Signature`, and the server would
   * reject the request.
   */
  body: string;
  headers: Readonly<Record<string, string>>;
  /**
   * The raw IV used for this request, retained by the caller so an encrypted
   * response can be decrypted with the matching key material.
   */
  iv: string;
}

export interface LoginRequestParams {
  email: string;
  password: string;
  /** `services.accountcenter.secret` — hashed to the AES key. */
  secret: string;
  /** `services.accountcenter.name` — sent as `X-Client-Id`. */
  clientId: string;
  /** Overridable only so tests can pin a deterministic IV. */
  iv?: string;
}

/**
 * Builds the signed login request.
 *
 * The password is encrypted, placed inside the body, and then the whole body is
 * encrypted again to form the signature — so the password is covered twice.
 * Key order matters: PHP emits `email` before `password`, and the signature is
 * computed over that exact serialisation.
 */
export function buildLoginRequest(params: LoginRequestParams): SignedRequest {
  const { email, password, secret, clientId, iv = generateIv() } = params;

  const key = deriveKey(secret);
  const body = phpJsonEncode({
    email,
    password: encrypt(password, key, iv),
  });

  return {
    body,
    iv,
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': clientId,
      'X-Client-Iv': Buffer.from(iv, 'latin1').toString('base64'),
      Signature: encrypt(body, key, iv),
    },
  };
}
