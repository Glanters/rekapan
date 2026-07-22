import { z } from 'zod';

import { ok, paginated } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { listMonthly, upsertMonthly } from '@/server/monthly/service';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const CellSchema = z.union([z.number(), z.string(), z.boolean(), z.null()]);

const UpsertSchema = z.object({
  siteId: z.uuid(),
  reportDate: z.string().regex(ISO_DATE, 'Use the YYYY-MM-DD format.'),
  note: z.string().max(1000).optional(),
  values: z.record(z.string(), CellSchema),
  /**
   * Member registrations keyed by bank code. Optional and distinct from an
   * empty object: omitting it leaves the stored breakdown alone, which is what
   * the Excel importer needs, while `{}` clears it.
   */
  validations: z.record(z.string(), z.number().int().min(0)).optional(),
});

/** GET /api/monthly — one page of pivoted rows, plus the column definitions. */
export const GET = route({
  permission: 'monthly.view',
  handler: async ({ access, request }) => {
    const params = request.nextUrl.searchParams;
    const siteIds = params.getAll('siteId');

    const result = await listMonthly(access, {
      siteIds: siteIds.length > 0 ? siteIds : undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      page: Number(params.get('page') ?? 1),
      perPage: Number(params.get('perPage') ?? 50),
    });

    // The columns and totals ride in meta rather than data: data is the row
    // collection the pagination describes, and mixing the table's shape into it
    // would make the envelope's meaning depend on the endpoint.
    return paginated(result.rows, result.pagination, {
      meta: { columns: result.columns, banks: result.banks, totals: result.totals },
    });
  },
});

/**
 * POST /api/monthly
 *
 * Upsert, not create: `(siteId, reportDate)` is unique, so re-submitting a day
 * corrects it rather than failing or duplicating. This is what makes a repeated
 * Excel import safe.
 */
export const POST = route({
  bodySchema: UpsertSchema,
  handler: async ({ access, body }) => {
    const result = await upsertMonthly(access, {
      siteId: body.siteId,
      reportDate: body.reportDate,
      note: body.note,
      values: body.values,
      validations: body.validations,
    });

    return ok(result, { message: 'Laporan disimpan.' });
  },
});
