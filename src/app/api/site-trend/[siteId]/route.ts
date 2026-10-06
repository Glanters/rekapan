import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { getSiteTrendDaily } from '@/server/site-trend/daily';

/**
 * GET /api/site-trend/:siteId?month=YYYY-MM
 *
 * One site's figures day by day, this month beside the same days of the
 * previous one. Site access is enforced in the service.
 */
export const GET = route({
  permission: 'dashboard.view',
  handler: async ({ access, request, params }) => {
    const month = request.nextUrl.searchParams.get('month') ?? undefined;
    return ok(
      await getSiteTrendDaily(access, { siteId: String(params.siteId), month }),
    );
  },
});
