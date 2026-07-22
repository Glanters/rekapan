import { permissionsByModule } from '@/server/auth/permissions';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { listRoles } from '@/server/roles/service';

/**
 * GET /api/admin/roles
 *
 * The roles plus the permission catalogue they are scored against. Both travel
 * together because the matrix is meaningless with only one of them, and the
 * catalogue is the compile-time source of truth rather than a table read — a
 * permission present in the database but absent from the catalogue is checked by
 * nothing, so rendering it would invite an administrator to tick a box that
 * grants nothing.
 */
export const GET = route({
  permission: 'role.view',
  handler: async ({ access }) => {
    const roles = await listRoles(access);

    const modules = [...permissionsByModule().entries()].map(
      ([module, permissions]) => ({
        module,
        permissions: permissions.map((permission) => ({
          key: permission.key,
          action: permission.action,
          description: permission.description,
        })),
      }),
    );

    return ok({ roles, modules });
  },
});
