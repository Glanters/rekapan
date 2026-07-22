import { CreateColumnSchema } from '@/server/columns/schema';
import { createColumn, listColumns } from '@/server/columns/service';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';

/**
 * Monthly column definitions.
 *
 * A definition is a column in the Monthly grid, so creating one here widens
 * every Monthly report. Not site-scoped: the column set is shared across sites
 * so their reports stay comparable.
 */

/** GET /api/master/columns */
export const GET = route({
  permission: 'column.view',
  handler: async ({ access, request }) => {
    const params = request.nextUrl.searchParams;

    const columns = await listColumns(access, {
      search: params.get('search') ?? undefined,
      // The master-data screen manages hidden columns too; the Monthly grid,
      // which only renders what operators fill in, does not ask for them.
      includeHidden: params.get('includeHidden') === 'true',
    });

    return ok({ columns });
  },
});

/** POST /api/master/columns */
export const POST = route({
  permission: 'column.create',
  bodySchema: CreateColumnSchema,
  handler: async ({ access, body }) => {
    const result = await createColumn(access, body);

    return ok(result.column, {
      status: result.restored ? 200 : 201,
      message: result.restored
        ? result.reattachedValues > 0
          ? `Kolom "${result.column.key}" dipulihkan beserta ${result.reattachedValues.toLocaleString('id-ID')} nilai yang sudah tercatat.`
          : `Kolom "${result.column.key}" dipulihkan dari data yang sebelumnya dihapus.`
        : 'Kolom dibuat.',
    });
  },
});
