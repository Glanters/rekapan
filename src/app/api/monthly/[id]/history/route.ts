import { ValidationError } from '@/server/errors';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { getMonthlyHistory } from '@/server/monthly/history';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/monthly/:id/history
 *
 * Who changed this report, when, and which figures — most recent first. Site
 * access is enforced in the service: another site's report reads as not found.
 */
export const GET = route({
  permission: 'monthly.view',
  handler: async ({ access, params }) => {
    const id = params['id'];
    // Checked here so a malformed id is a 400, not a database cast error.
    if (typeof id !== 'string' || !UUID.test(id)) {
      throw new ValidationError('Id laporan tidak valid.');
    }
    return ok(await getMonthlyHistory(access, id));
  },
});
