import { deleteBank, updateBank } from '@/server/banks/service';
import { UpdateBankSchema } from '@/server/banks/schema';
import { ValidationError } from '@/server/errors';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';

function bankId(params: Record<string, string | string[]>): string {
  const id = params['id'];
  if (typeof id !== 'string') {
    throw new ValidationError('A bank id is required.');
  }
  return id;
}

/** PATCH /api/master/banks/:id */
export const PATCH = route({
  permission: 'bank.update',
  bodySchema: UpdateBankSchema,
  handler: async ({ access, body, params }) =>
    ok(await updateBank(access, bankId(params), body), { message: 'Bank diperbarui.' }),
});

/**
 * DELETE /api/master/banks/:id
 *
 * Soft delete, and refused outright for a bank that has any registrations
 * recorded against it: `MonthlyValidation.bank` is `onDelete: Restrict`, and a
 * bank with history belongs in the breakdown even when it is no longer in use.
 * The service reports that case as a conflict pointing at deactivation instead.
 */
export const DELETE = route({
  permission: 'bank.delete',
  handler: async ({ access, params }) =>
    ok(await deleteBank(access, bankId(params)), { message: 'Bank dihapus.' }),
});
