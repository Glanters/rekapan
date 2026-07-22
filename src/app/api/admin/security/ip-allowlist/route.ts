import { z } from 'zod';

import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { addIpRule, listIpRules } from '@/server/security/ip-allowlist';

/** GET /api/admin/security/ip-allowlist — the current allowlist. */
export const GET = route({
  permission: 'setting.view',
  handler: async ({ access }) => {
    return ok(await listIpRules(access));
  },
});

const AddSchema = z.object({
  cidr: z.string().min(1).max(64),
  label: z.string().max(191).optional(),
});

/**
 * POST /api/admin/security/ip-allowlist — add a rule.
 *
 * The service refuses a change that would leave a non-empty list not covering
 * the caller's own address, so enabling the allowlist cannot lock the editor out.
 */
export const POST = route({
  permission: 'setting.update',
  bodySchema: AddSchema,
  handler: async ({ access, body }) => {
    const rules = await addIpRule(access, body);
    return ok(rules, { message: 'Aturan IP ditambahkan.' });
  },
});
