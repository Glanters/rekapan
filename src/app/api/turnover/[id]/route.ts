import { ValidationError } from '@/server/errors';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { deleteTurnover } from '@/server/turnover/service';

/** DELETE /api/turnover/:id — soft delete, preserving the audit trail. */
export const DELETE = route({
  permission: 'turnover.delete',
  handler: async ({ access, params }) => {
    const id = params['id'];
    if (typeof id !== 'string') {
      throw new ValidationError('A report id is required.');
    }

    return ok(await deleteTurnover(access, id), { message: 'Laporan dihapus.' });
  },
});
