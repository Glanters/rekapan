import { z } from 'zod';

import { ValidationError } from '@/server/errors';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { activateUser, setUserRole, setUserStatus } from '@/server/users/service';

/**
 * A discriminated union rather than a bag of optional fields: each action has
 * its own permission and its own guards in the service, so the request must say
 * which one it means instead of leaving the handler to infer it from whichever
 * fields happen to be present.
 */
const PatchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('activate') }),
  z.object({
    action: z.literal('setStatus'),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']),
  }),
  z.object({ action: z.literal('setRole'), roleId: z.uuid() }),
]);

/** PATCH /api/admin/users/:id */
export const PATCH = route({
  bodySchema: PatchSchema,
  handler: async ({ access, body, params }) => {
    const id = params['id'];
    if (typeof id !== 'string') {
      throw new ValidationError('A user id is required.');
    }

    switch (body.action) {
      case 'activate':
        return ok(await activateUser(access, id), {
          message: 'Akun diaktifkan.',
        });

      case 'setStatus':
        return ok(await setUserStatus(access, id, body.status), {
          message:
            body.status === 'ACTIVE'
              ? 'Akun diaktifkan kembali.'
              : 'Akun dinonaktifkan.',
        });

      case 'setRole':
        return ok(await setUserRole(access, id, body.roleId), {
          message: 'Role diperbarui.',
        });
    }
  },
});
