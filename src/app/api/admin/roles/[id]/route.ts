import { z } from 'zod';

import { ValidationError } from '@/server/errors';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { setRolePermissions, updateRoleDetails } from '@/server/roles/service';

/**
 * Two distinct operations with distinct guards — renaming is refused for system
 * roles while permission edits are not — so the request has to say which it
 * means rather than leaving the handler to infer it from the fields present.
 */
const PatchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('setPermissions'),
    permissionKeys: z.array(z.string()).max(200),
  }),
  z.object({
    action: z.literal('updateDetails'),
    name: z.string().min(1).max(128),
    description: z.string().max(2000).nullable(),
  }),
]);

/** PATCH /api/admin/roles/:id */
export const PATCH = route({
  bodySchema: PatchSchema,
  permission: 'role.update',
  handler: async ({ access, body, params }) => {
    const id = params['id'];
    if (typeof id !== 'string') {
      throw new ValidationError('A role id is required.');
    }

    switch (body.action) {
      case 'setPermissions':
        return ok(await setRolePermissions(access, id, body.permissionKeys), {
          message: 'Izin role diperbarui.',
        });

      case 'updateDetails':
        return ok(
          await updateRoleDetails(access, id, {
            name: body.name,
            description: body.description,
          }),
          { message: 'Role diperbarui.' },
        );
    }
  },
});
