import { createHash, randomBytes } from 'node:crypto';

import { cookies } from 'next/headers';

import { env, isProduction } from '@/lib/env';

import type { AccountCenterIdentity } from '../account-center/client';
import { encryptSecret } from '../crypto/at-rest';
import { unsafeDb } from '../db/prisma';
import { logger } from '../logger';
import { ALL_SITES, AccessContext, limitedTo } from './access-context';
import type { PermissionKey, RoleKey } from './permissions';

/**
 * Session lifecycle.
 *
 * The browser holds an opaque random identifier and nothing else. Roles,
 * permissions, and site membership are read from the database on each request
 * rather than baked into a token, so revoking access takes effect immediately
 * instead of when some JWT happens to expire.
 *
 * These functions use `unsafeDb` deliberately: they run before an
 * AccessContext exists, which is precisely the bootstrap case the scoped client
 * cannot serve.
 */

const SESSION_COOKIE = 'mt_session';

/** 256 bits of entropy; the cookie value is never stored, only its digest. */
const TOKEN_BYTES = 32;

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface SessionRequestInfo {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * Issues a session and sets the cookie.
 *
 * @returns The raw token, for callers that need it outside a cookie context.
 */
export async function createSession(params: {
  userId: string;
  identity: Pick<AccountCenterIdentity, 'token' | 'tokenExpiresAt'>;
  request: SessionRequestInfo;
}): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);

  const session = await unsafeDb.session.create({
    data: {
      userId: params.userId,
      tokenHash: hashToken(token),
      // Encrypted at rest so a database dump does not yield usable upstream
      // credentials.
      accountCenterToken: params.identity.token
        ? encryptSecret(params.identity.token)
        : null,
      accountCenterTokenExpires: params.identity.tokenExpiresAt,
      ip: params.request.ip ?? null,
      userAgent: params.request.userAgent ?? null,
      expiresAt,
    },
    select: { id: true },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Scripts cannot read it, so XSS cannot exfiltrate the session.
    secure: isProduction,
    // `lax` still sends the cookie on top-level navigation, which keeps normal
    // links working while blocking cross-site form posts.
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  logger.info('Session created', { userId: params.userId, sessionId: session.id });
  return token;
}

/**
 * Resolves the current request's caller.
 *
 * @returns The caller's context, or `null` when unauthenticated. Returning null
 *   rather than throwing lets callers decide between redirecting and 401ing.
 */
export async function resolveSession(
  request: SessionRequestInfo = {},
): Promise<AccessContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await unsafeDb.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          deletedAt: true,
          role: {
            select: {
              key: true,
              level: true,
              permissions: { select: { permission: { select: { key: true } } } },
            },
          },
          sites: { select: { siteId: true } },
        },
      },
    },
  });

  if (!session) return null;

  if (session.revokedAt !== null || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const { user } = session;

  // Status is re-checked on every request, not just at login: suspending a user
  // must lock them out immediately, not when their session happens to lapse.
  if (user.deletedAt !== null || user.status !== 'ACTIVE') {
    logger.warn('Session rejected: account is no longer active', {
      userId: user.id,
      status: user.status,
    });
    return null;
  }

  const roleKey = (user.role?.key ?? null) as RoleKey | null;
  const permissions = (user.role?.permissions ?? []).map(
    (entry) => entry.permission.key as PermissionKey,
  );

  return new AccessContext({
    userId: user.id,
    email: user.email,
    name: user.name,
    roleKey,
    roleLevel: user.role?.level ?? null,
    permissions,
    // Root is the only role granted unrestricted reach.
    siteScope:
      roleKey === 'ROOT' ? ALL_SITES : limitedTo(user.sites.map((s) => s.siteId)),
    sessionId: session.id,
    ip: request.ip,
    userAgent: request.userAgent,
  });
}

/** Revokes the current session and clears the cookie. */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    // updateMany rather than update: a stale cookie should be a no-op, not a
    // "record not found" throw on the way out of the application.
    await unsafeDb.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  cookieStore.delete(SESSION_COOKIE);
}

/** Revokes every live session for a user — used when suspending or deleting. */
export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await unsafeDb.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
