import { scopedDb } from '@/server/db/prisma';
import { scopedWhere } from '@/server/db/site-scope';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';

/**
 * GET /api/auth/me
 *
 * The client bootstraps from this: identity, role, permissions, and the sites
 * the caller may act on. The site list comes back through the scoped client
 * rather than from the session, so the same isolation rule that governs data
 * also governs the site picker — a user cannot be offered a site they could not
 * then query.
 */
export const GET = route({
  handler: async ({ access }) => {
    const sites = await scopedDb(access).site.findMany({
      where: scopedWhere(access, 'Site', { deletedAt: null, status: 'ACTIVE' }),
      select: { id: true, code: true, name: true, timezone: true, currency: true },
      orderBy: { name: 'asc' },
    });

    return ok({
      user: {
        id: access.userId,
        email: access.email,
        name: access.name,
        role: access.roleKey,
        isRoot: access.isRoot,
      },
      permissions: [...access.permissions].sort(),
      sites,
      // Surfaced so the UI can explain an empty dashboard rather than looking
      // broken: an active user with no site assigned sees no data by design.
      hasNoSiteAssigned: !access.isRoot && sites.length === 0,
    });
  },
});
