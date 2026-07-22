import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { CreateSiteSchema, SITE_STATUSES } from '@/server/sites/schema';
import { createSite, listSites } from '@/server/sites/service';

/**
 * Site master data.
 *
 * Reads go through the site-scoping tripwire inside the service, so a caller
 * only ever sees the sites they are assigned to — Root excepted.
 */

/** GET /api/master/sites */
export const GET = route({
  permission: 'site.view',
  handler: async ({ access, request }) => {
    const params = request.nextUrl.searchParams;
    const status = params.get('status');

    const sites = await listSites(access, {
      // An unrecognised status narrows to `undefined` rather than erroring: the
      // filter is a query string, and a stale bookmark should show everything
      // instead of a validation failure.
      status: SITE_STATUSES.find((value) => value === status),
      search: params.get('search') ?? undefined,
    });

    return ok({ sites });
  },
});

/** POST /api/master/sites */
export const POST = route({
  permission: 'site.create',
  bodySchema: CreateSiteSchema,
  handler: async ({ access, body }) => {
    const result = await createSite(access, body);

    if (!result.restored) {
      return ok(result.site, { message: 'Site dibuat.', status: 201 });
    }

    // Say what came back. A restore that silently reports "created" leaves the
    // operator unaware that months of existing reports just reappeared.
    const { monthly, turnover, images } = result.reattached;
    const parts = [
      monthly > 0 ? `${monthly} laporan Monthly` : null,
      turnover > 0 ? `${turnover} laporan Turnover` : null,
      images > 0 ? `${images} gambar` : null,
    ].filter((part): part is string => part !== null);

    return ok(result.site, {
      message:
        parts.length > 0
          ? `Site "${result.site.code}" dipulihkan beserta ${parts.join(', ')} yang sudah tercatat.`
          : `Site "${result.site.code}" dipulihkan dari data yang sebelumnya dihapus.`,
    });
  },
});
