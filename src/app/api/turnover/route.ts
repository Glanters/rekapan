import { z } from 'zod';

import { ok, paginated } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { listTurnover, upsertTurnover } from '@/server/turnover/service';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const UpsertSchema = z.object({
  siteId: z.uuid(),
  reportDate: z.string().regex(ISO_DATE, 'Use the YYYY-MM-DD format.'),
  values: z.record(z.string(), z.union([z.number(), z.null()])),
});

/** GET /api/turnover — one page of pivoted rows, plus the game definitions. */
export const GET = route({
  permission: 'turnover.view',
  handler: async ({ access, request }) => {
    const params = request.nextUrl.searchParams;
    const siteIds = params.getAll('siteId');

    const result = await listTurnover(access, {
      siteIds: siteIds.length > 0 ? siteIds : undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      page: Number(params.get('page') ?? 1),
      perPage: Number(params.get('perPage') ?? 50),
    });

    return paginated(result.rows, result.pagination, {
      meta: {
        games: result.games,
        totals: result.totals,
        grandTotal: result.grandTotal,
      },
    });
  },
});

/** POST /api/turnover — idempotent on (siteId, reportDate). */
export const POST = route({
  bodySchema: UpsertSchema,
  handler: async ({ access, body }) => {
    const result = await upsertTurnover(access, {
      siteId: body.siteId,
      reportDate: body.reportDate,
      values: body.values,
    });

    return ok(result, { message: 'Laporan turnover disimpan.' });
  },
});
