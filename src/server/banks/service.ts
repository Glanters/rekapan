import type { Prisma } from '@/generated/prisma/client';

import { recordAudit } from '../audit/record';
import type { AccessContext } from '../auth/access-context';
import { unsafeDb } from '../db/prisma';
import { ConflictError, NotFoundError } from '../errors';

/**
 * Bank master data.
 *
 * A bank IS a column of the validation breakdown. `MonthlyValidation` pairs a
 * report with a bank and holds a head count of the members who registered
 * through that bank on the report's day; summing the row gives the Monthly
 * "Validasi" figure. So the banks listed here are exactly the columns operators
 * see when they open that breakdown, ordered by `position`. Creating a bank
 * widens the breakdown on every Monthly report at once, and deleting one takes
 * a column away from all of them — which is why `bank.create` and `bank.delete`
 * are separate permissions rather than folded into a generic master-data grant.
 *
 * `Bank` is not site-scoped: the bank list is shared by every site so that
 * reports stay comparable. `unsafeDb` is correct here, and the tripwire would
 * not fire on this model in any case.
 *
 * Deletes are soft, and refused outright for a bank that has any registrations
 * recorded against it — see {@link deleteBank}.
 */

const BANK_SELECT = {
  id: true,
  code: true,
  name: true,
  position: true,
  logoUrl: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Gap between generated positions, so a bank can be slotted between two others. */
const POSITION_STEP = 10;

export interface ListBanksFilters {
  search?: string | undefined;
  includeInactive?: boolean | undefined;
}

export interface CreateBankInput {
  code: string;
  name: string;
  logoUrl: string | null;
  position?: number | undefined;
  isActive: boolean;
}

export type UpdateBankInput = Partial<CreateBankInput>;

function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Distinguishes "not supplied" from "cleared".
 *
 * `undefined` means the caller left the field alone and the column must not be
 * touched; `null` or an empty string both mean the caller cleared it, and are
 * stored as NULL so the table never holds a meaningless "".
 */
function emptyToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The unique index on `code` spans soft-deleted rows, so the probe must too —
 * otherwise a code freed only in appearance produces a raw database error.
 *
 * A live clash is a genuine conflict. A soft-deleted one is not: it is reported
 * back to the caller so creation can revive that row instead of failing. See
 * {@link createBank}.
 */
async function findCodeHolder(
  code: string,
  excludeId: string | null,
): Promise<{ id: string; deletedAt: Date | null } | null> {
  return unsafeDb.bank.findFirst({
    where: { code, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, deletedAt: true },
  });
}

async function assertCodeAvailable(
  code: string,
  excludeId: string | null,
): Promise<void> {
  const clash = await findCodeHolder(code, excludeId);
  if (!clash) return;

  throw new ConflictError(
    clash.deletedAt
      ? `Kode "${code}" masih dipakai oleh bank yang sudah dihapus.`
      : `Kode "${code}" sudah digunakan oleh bank lain.`,
  );
}

/** Next free slot at the end of the table, leaving room to insert before it. */
async function nextPosition(): Promise<number> {
  const last = await unsafeDb.bank.findFirst({
    where: { deletedAt: null },
    select: { position: true },
    orderBy: { position: 'desc' },
  });
  return (last?.position ?? 0) + POSITION_STEP;
}

export async function listBanks(ctx: AccessContext, filters: ListBanksFilters = {}) {
  ctx.requirePermission('bank.view');

  const search = filters.search?.trim();

  return unsafeDb.bank.findMany({
    where: {
      deletedAt: null,
      ...(filters.includeInactive ? {} : { isActive: true }),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' as const } },
              { name: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    select: BANK_SELECT,
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    take: 500,
  });
}

async function loadBank(id: string) {
  const bank = await unsafeDb.bank.findFirst({
    where: { id, deletedAt: null },
    select: BANK_SELECT,
  });
  if (!bank) throw new NotFoundError('Bank tidak ditemukan.');
  return bank;
}

/** Exactly the shape BANK_SELECT projects — not the full model. */
type BankRecord = Prisma.BankGetPayload<{ select: typeof BANK_SELECT }>;

export interface CreateBankResult {
  bank: BankRecord;
  /** True when an existing soft-deleted bank was revived rather than inserted. */
  restored: boolean;
  /** Validation rows that became visible again with the restore. */
  reattachedValidations: number;
}

/**
 * Creates a bank, or revives a soft-deleted one holding the same code.
 *
 * Reviving rather than inserting a fresh row is the whole point. Validation
 * rows reference a bank by id, so a second row with the same code would leave
 * every historical head count attached to the old, invisible one — the column
 * would come back empty and the old numbers would be unreachable through the
 * UI. Reusing a code means "I want this bank back", and that is what happens.
 */
export async function createBank(
  ctx: AccessContext,
  input: CreateBankInput,
): Promise<CreateBankResult> {
  ctx.requirePermission('bank.create');

  const code = normaliseCode(input.code);
  const holder = await findCodeHolder(code, null);

  if (holder && !holder.deletedAt) {
    throw new ConflictError(`Kode "${code}" sudah digunakan oleh bank lain.`);
  }

  const data = {
    code,
    name: input.name.trim(),
    logoUrl: emptyToNull(input.logoUrl) ?? null,
    isActive: input.isActive,
    updatedById: ctx.userId,
  };

  if (holder) {
    const [reattachedValidations, bank] = await unsafeDb.$transaction([
      unsafeDb.monthlyValidation.count({ where: { bankId: holder.id } }),
      unsafeDb.bank.update({
        where: { id: holder.id },
        data: {
          ...data,
          deletedAt: null,
          // Position is re-taken at the end rather than reusing the old slot,
          // which may since have been claimed by another bank.
          position: input.position ?? (await nextPosition()),
        },
        select: BANK_SELECT,
      }),
    ]);

    await recordAudit({
      action: 'bank.restored',
      module: 'Bank',
      actorId: ctx.userId,
      actorEmail: ctx.email,
      entityType: 'Bank',
      entityId: bank.id,
      after: { ...bank, reattachedValidations },
    });

    return { bank, restored: true, reattachedValidations };
  }

  const bank = await unsafeDb.bank.create({
    data: {
      ...data,
      position: input.position ?? (await nextPosition()),
      createdById: ctx.userId,
    },
    select: BANK_SELECT,
  });

  await recordAudit({
    action: 'bank.created',
    module: 'Bank',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'Bank',
    entityId: bank.id,
    after: bank,
  });

  return { bank, restored: false, reattachedValidations: 0 };
}

export async function updateBank(
  ctx: AccessContext,
  id: string,
  input: UpdateBankInput,
) {
  ctx.requirePermission('bank.update');

  const before = await loadBank(id);

  const code = input.code === undefined ? undefined : normaliseCode(input.code);
  if (code !== undefined && code !== before.code) {
    await assertCodeAvailable(code, id);
  }

  const logoUrl = emptyToNull(input.logoUrl);

  const updated = await unsafeDb.bank.update({
    where: { id },
    data: {
      ...(code !== undefined ? { code } : {}),
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(logoUrl !== undefined ? { logoUrl } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedById: ctx.userId,
    },
    select: BANK_SELECT,
  });

  await recordAudit({
    action: 'bank.updated',
    module: 'Bank',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'Bank',
    entityId: id,
    before,
    after: updated,
  });

  return updated;
}

/**
 * Soft delete, and refused for a bank that has any registrations recorded.
 *
 * `MonthlyValidation.bank` is `onDelete: Restrict`, so the database would block
 * a hard delete anyway. The guard exists because the soft delete would not be
 * blocked, and that is the more damaging case: a bank with recorded
 * registrations carries history, and hiding it strands those head counts behind
 * a column nobody can see — the per-bank breakdown would stop adding up to the
 * "Validasi" total it is supposed to explain. Deactivating keeps the figures
 * legible while taking the bank out of new reports, so that is what the
 * operator is pointed at instead.
 */
export async function deleteBank(ctx: AccessContext, id: string) {
  ctx.requirePermission('bank.delete');

  const before = await loadBank(id);

  const validationCount = await unsafeDb.monthlyValidation.count({
    where: { bankId: id },
  });
  if (validationCount > 0) {
    throw new ConflictError(
      `Bank "${before.name}" sudah memiliki ${validationCount.toLocaleString('id-ID')} data validasi dan tidak dapat dihapus. Nonaktifkan bank ini agar tidak muncul pada laporan baru, tanpa menghilangkan riwayat yang sudah tercatat.`,
    );
  }

  const deletedAt = new Date();

  const deleted = await unsafeDb.bank.update({
    where: { id },
    data: { deletedAt, isActive: false, updatedById: ctx.userId },
    select: BANK_SELECT,
  });

  await recordAudit({
    action: 'bank.deleted',
    module: 'Bank',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'Bank',
    entityId: id,
    before,
    after: { deletedAt },
  });

  return deleted;
}
