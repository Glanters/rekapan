import { createBank, listBanks } from '@/server/banks/service';
import { CreateBankSchema } from '@/server/banks/schema';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';

/**
 * Bank master data.
 *
 * A bank is a column of the per-bank breakdown behind the Monthly "Validasi"
 * figure, so creating one here widens that breakdown on every Monthly report at
 * once. `Bank` is not site-scoped: the list is shared across sites so their
 * reports stay comparable.
 */

/** GET /api/master/banks */
export const GET = route({
  permission: 'bank.view',
  handler: async ({ access, request }) => {
    const params = request.nextUrl.searchParams;

    const banks = await listBanks(access, {
      search: params.get('search') ?? undefined,
      // The master-data screen manages inactive banks too, so it asks for them
      // explicitly; the validation breakdown, which only renders live columns,
      // does not.
      includeInactive: params.get('includeInactive') === 'true',
    });

    return ok({ banks });
  },
});

/** POST /api/master/banks */
export const POST = route({
  permission: 'bank.create',
  bodySchema: CreateBankSchema,
  handler: async ({ access, body }) => {
    const result = await createBank(access, body);

    // The restore case is reported, not glossed over: the operator asked to
    // create a bank and instead got an existing one back, along with whatever
    // history was attached to it. Silently succeeding would hide that the
    // validation breakdown just regained a column full of old head counts.
    return ok(result.bank, {
      status: result.restored ? 200 : 201,
      message: result.restored
        ? result.reattachedValidations > 0
          ? `Bank "${result.bank.code}" dipulihkan beserta ${result.reattachedValidations.toLocaleString('id-ID')} data validasi yang sudah tercatat.`
          : `Bank "${result.bank.code}" dipulihkan dari data yang sebelumnya dihapus.`
        : 'Bank dibuat.',
    });
  },
});
