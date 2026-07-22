import { getCompleteness } from '@/server/completeness/service';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';

/**
 * GET /api/completeness
 *
 * The reporting-completeness matrix for a window: which sites have filed their
 * Monthly report, Turnover report, and each set of images on each day. Bounds
 * are applied in the service, so a hand-crafted range is clamped rather than
 * honoured.
 */
export const GET = route({
  permission: 'dashboard.view',
  handler: async ({ access, request }) => {
    const params = request.nextUrl.searchParams;

    const result = await getCompleteness(access, {
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      siteId: params.get('siteId') ?? undefined,
    });

    return ok(result);
  },
});
