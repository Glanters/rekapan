import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { assignableRoles, listUsers } from '@/server/users/service';

/**
 * GET /api/admin/users
 *
 * Returns the users the caller may administer, together with the roles they are
 * permitted to grant. Bundling the roles avoids a second round trip and, more
 * usefully, means the client never renders a role option the server would
 * reject.
 */
export const GET = route({
  permission: 'user.view',
  handler: async ({ access, request }) => {
    const params = request.nextUrl.searchParams;
    const statusParam = params.get('status');

    const [users, roles] = await Promise.all([
      listUsers(access, {
        status:
          statusParam === 'PENDING' ||
          statusParam === 'ACTIVE' ||
          statusParam === 'SUSPENDED' ||
          statusParam === 'INACTIVE'
            ? statusParam
            : undefined,
        search: params.get('search') ?? undefined,
      }),
      assignableRoles(access),
    ]);

    return ok({ users, roles });
  },
});
