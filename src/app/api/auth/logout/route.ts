import { recordAudit } from '@/server/audit/record';
import { destroySession } from '@/server/auth/session';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';

/**
 * POST /api/auth/logout
 *
 * Revokes the session server-side as well as clearing the cookie, so a copied
 * cookie value is dead too — clearing the browser's copy alone would leave the
 * session usable to anyone who had already captured it.
 */
export const POST = route({
  // A user the allowlist now blocks must still be able to sign out.
  ipExempt: true,
  handler: async ({ access, ip, userAgent }) => {
    await destroySession();

    await recordAudit({
      action: 'logout',
      module: 'Auth',
      actorId: access.userId,
      actorEmail: access.email,
      ip,
      userAgent,
    });

    return ok(null, { message: 'Signed out.' });
  },
});
