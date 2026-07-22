import { DashboardQuerySchema } from '@/server/dashboard/schema';
import { getDashboard } from '@/server/dashboard/service';
import { ValidationError } from '@/server/errors';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';

/**
 * GET /api/dashboard
 *
 * Everything the dashboard renders, in one response.
 *
 * One endpoint rather than six is a deliberate trade. The page shows a single
 * period, and splitting it per widget would mean six round trips that can
 * disagree — a stat card computed over one range while the chart beside it is
 * still showing the last. Here the whole payload is aggregated against one
 * filter, so the page is always internally consistent.
 *
 * `route()` supplies validation only for JSON bodies, and a GET has none, so
 * the query string is parsed against the schema explicitly. Unknown parameters
 * are ignored rather than rejected: a stale bookmark should still render.
 */
export const GET = route({
  permission: 'dashboard.view',
  handler: async ({ access, request }) => {
    const params = request.nextUrl.searchParams;

    const parsed = DashboardQuerySchema.safeParse({
      // `?siteId=` with an empty value is the "all sites" option round-tripping
      // through the URL, not a request for a site whose id is the empty string.
      siteId: params.get('siteId')?.trim() || undefined,
      from: params.get('from')?.trim() || undefined,
      to: params.get('to')?.trim() || undefined,
    });

    if (!parsed.success) {
      throw new ValidationError('Filter dashboard tidak valid.', {
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const data = await getDashboard(access, parsed.data);

    return ok(data, {
      message: 'Dashboard berhasil dimuat.',
      // The resolved window, not the requested one — the service clamps an
      // over-wide range, and the client labels the period from this.
      meta: { range: data.range, previousRange: data.previousRange },
    });
  },
});
