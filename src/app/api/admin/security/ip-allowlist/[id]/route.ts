import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { removeIpRule } from '@/server/security/ip-allowlist';

/**
 * DELETE /api/admin/security/ip-allowlist/[id] — remove a rule.
 *
 * Removing the last rule empties the list and disables the feature, which is
 * always permitted; removing a rule that would leave a non-empty list excluding
 * the caller is refused by the service.
 */
export const DELETE = route({
  permission: 'setting.update',
  handler: async ({ access, params }) => {
    const rules = await removeIpRule(access, String(params.id));
    return ok(rules, { message: 'Aturan IP dihapus.' });
  },
});
