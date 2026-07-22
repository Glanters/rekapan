import { z } from 'zod';

import { ValidationError } from '@/server/errors';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { setUserSites } from '@/server/users/service';

const SitesSchema = z.object({
  siteIds: z.array(z.uuid()).max(500),
});

/**
 * PUT /api/admin/users/:id/sites
 *
 * Replaces the assignment wholesale rather than patching it. A full set is
 * idempotent and cannot drift; incremental add/remove calls race each other
 * when two administrators edit the same user.
 */
export const PUT = route({
  permission: 'user.assign_site',
  bodySchema: SitesSchema,
  handler: async ({ access, body, params }) => {
    const id = params['id'];
    if (typeof id !== 'string') {
      throw new ValidationError('A user id is required.');
    }

    return ok(await setUserSites(access, id, body.siteIds), {
      message: 'Akses site diperbarui.',
    });
  },
});
