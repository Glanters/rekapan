import { deriveKey, decrypt } from '@/lib/account-center/crypto';
import { buildLoginRequest } from '@/lib/account-center/signing';
import { env } from '@/lib/env';

import { UnauthenticatedError, UpstreamUnavailableError } from '../errors';
import { logger } from '../logger';

/**
 * Account Center client.
 *
 * Account Center answers exactly one question: are these credentials valid, and
 * who do they belong to? Roles, sites, and activation are this application's
 * concern, so the only field genuinely required from a response is the email —
 * everything else is opportunistic. That is what lets the normaliser below be
 * forgiving without being unsafe.
 */

export interface AccountCenterIdentity {
  /** Canonical, lowercased. The join key to the local users table. */
  email: string;
  name: string | null;
  /** Stable upstream identifier, when the response carries one. */
  externalId: string | null;
  /** Upstream JWT, stored encrypted at rest and never sent to the browser. */
  token: string | null;
  tokenExpiresAt: Date | null;
}

/** Paths checked, in order, when hunting for a field in an unknown shape. */
const EMAIL_PATHS = [
  ['user', 'email'],
  ['data', 'user', 'email'],
  ['data', 'email'],
  ['email'],
  ['result', 'user', 'email'],
] as const;

const NAME_PATHS = [
  ['user', 'name'],
  ['data', 'user', 'name'],
  ['data', 'name'],
  ['name'],
  ['user', 'full_name'],
  ['user', 'fullname'],
  ['user', 'username'],
] as const;

const ID_PATHS = [
  ['user', 'id'],
  ['data', 'user', 'id'],
  ['data', 'id'],
  ['id'],
  ['user', 'uuid'],
  ['user', 'user_id'],
] as const;

const TOKEN_PATHS = [
  ['token'],
  ['access_token'],
  ['accessToken'],
  ['data', 'token'],
  ['data', 'access_token'],
  ['data', 'accessToken'],
  ['jwt'],
  ['data', 'jwt'],
] as const;

function readPath(source: unknown, path: readonly string[]): unknown {
  let node: unknown = source;
  for (const segment of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

function pickString(
  source: unknown,
  paths: readonly (readonly string[])[],
): string | null {
  for (const path of paths) {
    const value = readPath(source, path);
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

/**
 * Describes a payload's structure — keys and value types, never values.
 *
 * On first contact with a real Account Center the response shape is unknown, and
 * this is what makes it adjustable in one iteration. Logging the payload itself
 * would write a live JWT to disk.
 */
export function describeShape(value: unknown, depth = 0): unknown {
  if (depth > 4) return '…';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0
      ? '[]'
      : [describeShape(value[0], depth + 1), `…×${value.length}`];
  }
  if (typeof value !== 'object') {
    return typeof value === 'string' ? `string(${value.length})` : typeof value;
  }
  const shape: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    shape[key] = describeShape(item, depth + 1);
  }
  return shape;
}

/**
 * Account Center may return plaintext JSON or an AES envelope encrypted with the
 * IV we supplied. Both are accepted; the envelope is unwrapped transparently.
 */
function unwrapPayload(rawBody: string, ivBase64: string): unknown {
  const trimmed = rawBody.trim();

  const asJson = tryParseJson(trimmed);
  if (asJson !== undefined) {
    // A JSON object may still carry an encrypted string under `data`.
    if (asJson !== null && typeof asJson === 'object') {
      const inner = (asJson as Record<string, unknown>)['data'];
      if (typeof inner === 'string' && looksEncrypted(inner)) {
        const decrypted = tryDecrypt(inner, ivBase64);
        if (decrypted !== undefined) {
          return { ...(asJson as Record<string, unknown>), data: decrypted };
        }
      }
    }
    return asJson;
  }

  // Not JSON: the whole body may be an AES envelope.
  if (looksEncrypted(trimmed)) {
    const decrypted = tryDecrypt(trimmed, ivBase64);
    if (decrypted !== undefined) return decrypted;
  }

  return undefined;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Double-base64 output is restricted to the alphanumeric alphabet plus padding. */
function looksEncrypted(value: string): boolean {
  return value.length >= 16 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function tryDecrypt(payload: string, ivBase64: string): unknown {
  try {
    const key = deriveKey(env.ACCOUNT_CENTER_SECRET);
    const plaintext = decrypt(payload, key, ivBase64);
    return tryParseJson(plaintext) ?? plaintext;
  } catch {
    return undefined;
  }
}

/**
 * Builds the login endpoint the way `AccountCenter::login()` does — plain
 * string concatenation of the configured URI with `/auth/login`.
 *
 * Concatenation, not `new URL('/auth/login', base)`: the URL constructor treats
 * a leading slash as absolute and discards any path already on the base, so a
 * configured value of `https://host/api/v1` would silently become
 * `https://host/auth/login`. PHP would have produced `https://host/api/v1/auth/login`,
 * and a divergence there is invisible until the request 404s.
 *
 * Pasting the complete endpoint into ACCOUNT_CENTER_URL is a natural mistake,
 * so that case is accepted rather than doubled into `/auth/login/auth/login`.
 */
export function buildLoginUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/auth/login') ? base : `${base}/auth/login`;
}

/**
 * Verifies credentials against Account Center.
 *
 * @throws {UnauthenticatedError} Credentials rejected upstream.
 * @throws {UpstreamUnavailableError} Account Center unreachable, timed out, or
 *   returned a shape no email could be read from.
 */
export async function authenticate(params: {
  email: string;
  password: string;
}): Promise<AccountCenterIdentity> {
  const request = buildLoginRequest({
    email: params.email,
    password: params.password,
    secret: env.ACCOUNT_CENTER_SECRET,
    clientId: env.ACCOUNT_CENTER_CLIENT_ID,
  });

  const url = buildLoginUrl(env.ACCOUNT_CENTER_URL);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ACCOUNT_CENTER_TIMEOUT_MS);

  let response: Response;
  let rawBody: string;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: request.headers,
      // Sent verbatim: re-serialising would not match the signed bytes.
      body: request.body,
      signal: controller.signal,
      cache: 'no-store',
    });
    rawBody = await response.text();
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    logger.error('Account Center request failed', {
      url,
      reason: aborted ? 'timeout' : 'network',
      timeoutMs: env.ACCOUNT_CENTER_TIMEOUT_MS,
    });
    throw new UpstreamUnavailableError('Account Center', cause);
  } finally {
    clearTimeout(timeout);
  }

  const ivBase64 = request.headers['X-Client-Iv'] ?? '';
  const payload = unwrapPayload(rawBody, ivBase64);

  if (response.status === 401 || response.status === 403 || response.status === 422) {
    throw new UnauthenticatedError('Incorrect email or password.');
  }

  if (!response.ok) {
    logger.error('Account Center returned an error status', {
      status: response.status,
      shape: describeShape(payload),
    });
    throw new UpstreamUnavailableError('Account Center');
  }

  const email = pickString(payload, EMAIL_PATHS) ?? params.email;
  const explicitFailure = readPath(payload, ['success']) === false;

  if (explicitFailure) {
    throw new UnauthenticatedError('Incorrect email or password.');
  }

  const token = pickString(payload, TOKEN_PATHS);

  // A 200 carrying neither a token nor a recognisable user is not a success we
  // can act on. Failing here — rather than admitting the login — is what keeps
  // an unexpected response shape from becoming an authentication bypass.
  if (!token && pickString(payload, EMAIL_PATHS) === null) {
    logger.error(
      'Account Center response carried no token and no user email. Adjust the ' +
        'lookup paths in src/server/account-center/client.ts to match this shape.',
      { status: response.status, shape: describeShape(payload) },
    );
    throw new UpstreamUnavailableError('Account Center');
  }

  logger.info('Account Center authentication succeeded', {
    email,
    hasToken: token !== null,
  });

  return {
    email: email.toLowerCase(),
    name: pickString(payload, NAME_PATHS),
    externalId: pickString(payload, ID_PATHS),
    token,
    tokenExpiresAt: readTokenExpiry(token),
  };
}

/**
 * Reads `exp` from a JWT without verifying it.
 *
 * The signature is not checked because this token is never trusted for
 * authorisation — it is stored for upstream calls only, and every decision in
 * this application is made against the local user record. The claim is used
 * solely to know when to stop reusing it.
 */
function readTokenExpiry(token: string | null): Date | null {
  if (!token) return null;
  const segments = token.split('.');
  if (segments.length !== 3) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(segments[1] ?? '', 'base64url').toString('utf8'),
    ) as { exp?: unknown };
    return typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}
