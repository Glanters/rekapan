import { getFormRecap } from '@/server/form-recap/service';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';

/**
 * GET /api/form-recap
 *
 * The per-site Form DP/WD recap for a window: how many deposit and withdraw
 * forms each site filed. Window bounds are applied in the service, so a
 * hand-crafted range is clamped rather than honoured.
 */
export const GET = route({
  permission: 'monthly.view',
  handler: async ({ access, request }) => {
    const params = request.nextUrl.searchParams;

    const result = await getFormRecap(access, {
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
    });

    return ok(result);
  },
});
