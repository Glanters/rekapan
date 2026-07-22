import { UpdateColumnSchema } from '@/server/columns/schema';
import { deleteColumn, updateColumn } from '@/server/columns/service';
import { ValidationError } from '@/server/errors';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';

function columnId(params: Record<string, string | string[]>): string {
  const id = params['id'];
  if (typeof id !== 'string') {
    throw new ValidationError('A column id is required.');
  }
  return id;
}

/**
 * PATCH /api/master/columns/:id
 *
 * A system column's `key` is refused by the service; everything cosmetic about
 * it remains editable.
 */
export const PATCH = route({
  permission: 'column.update',
  bodySchema: UpdateColumnSchema,
  handler: async ({ access, body, params }) =>
    ok(await updateColumn(access, columnId(params), body), {
      message: 'Kolom diperbarui.',
    }),
});

/**
 * DELETE /api/master/columns/:id
 *
 * Soft delete, and refused outright for system columns. `MonthlyValue.column`
 * is `onDelete: Restrict`, so a hard delete would be refused by the database
 * once any report had used the column.
 */
export const DELETE = route({
  permission: 'column.delete',
  handler: async ({ access, params }) =>
    ok(await deleteColumn(access, columnId(params)), { message: 'Kolom dihapus.' }),
});
