import { ValidationError } from '@/server/errors';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { deleteMonthly } from '@/server/monthly/service';

/**
 * DELETE /api/monthly/:id
 *
 * Soft delete. Financial records are corrected, not erased, and the audit trail
 * needs something to point at.
 */
export const DELETE = route({
  permission: 'monthly.delete',
  handler: async ({ access, params }) => {
    const id = params['id'];
    if (typeof id !== 'string') {
      throw new ValidationError('A report id is required.');
    }

    return ok(await deleteMonthly(access, id), { message: 'Laporan dihapus.' });
  },
});
