import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { getSiteTrend } from '@/server/site-trend/service';

/**
 * GET /api/site-trend?month=YYYY-MM
 *
 * Per-site rises and falls against the same days of the previous month. Which
 * metric families appear depends on the caller's Monthly / Turnover access.
 */
export const GET = route({
  permission: 'dashboard.view',
  handler: async ({ access, request }) => {
    const month = request.nextUrl.searchParams.get('month') ?? undefined;
    return ok(await getSiteTrend(access, { month }));
  },
});
