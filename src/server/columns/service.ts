import type { Prisma } from '@/generated/prisma/client';

import type { ColumnDataType, ResultEffect } from '@/generated/prisma/enums';

import { recordAudit } from '../audit/record';
import type { AccessContext } from '../auth/access-context';
import { unsafeDb } from '../db/prisma';
import { ConflictError, NotFoundError } from '../errors';

/**
 * Monthly column definitions.
 *
 * The Monthly table is entity–attribute–value, so a row here is a column in the
 * grid: `MonthlyValue` pairs a report with a column, and `dataType` decides
 * which of the four value slots is populated and which input widget is
 * rendered. Adding a definition widens every Monthly report at once.
 *
 * `MonthlyColumn` is not site-scoped — the column set is shared so reports stay
 * comparable across sites — so `unsafeDb` is the right client.
 *
 * Two guards are worth stating plainly:
 *
 *   - `isSystem` columns cannot be deleted, and their `key` cannot be changed.
 *     The key is the identifier importers match on and formulas reference by
 *     name, so renaming one silently breaks every expression pointing at it.
 *     Presentation — label, position, precision, visibility — stays editable,
 *     because none of that is load-bearing.
 *   - Deletes are soft. `MonthlyValue.column` is `onDelete: Restrict`, so a hard
 *     delete of a column that has ever been filled in would be refused outright.
 *
 * `position` is sparse (10, 20, 30) so a new column can be slotted between two
 * existing ones without renumbering the whole table.
 */

const COLUMN_SELECT = {
  id: true,
  key: true,
  label: true,
  group: true,
  dataType: true,
  position: true,
  precision: true,
  unit: true,
  isRequired: true,
  isVisible: true,
  isSystem: true,
  includeInTotals: true,
  resultEffect: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Gap between generated positions; see the note above. */
const POSITION_STEP = 10;

export interface ListColumnsFilters {
  search?: string | undefined;
  includeHidden?: boolean | undefined;
}

export interface CreateColumnInput {
  key: string;
  label: string;
  group: string | null;
  dataType: ColumnDataType;
  position?: number | undefined;
  precision: number;
  unit: string | null;
  isRequired: boolean;
  isVisible: boolean;
  includeInTotals: boolean;
  resultEffect: ResultEffect;
}

/**
 * Enforces the single result column in the application as well as the database.
 *
 * A partial unique index already makes two result columns impossible, but it
 * surfaces as a raw constraint violation. This turns it into a message naming
 * the column currently holding the role, which is the one thing the
 * administrator needs to know in order to proceed.
 */
async function assertSingleResultColumn(
  effect: ResultEffect,
  excludeId: string | null,
): Promise<void> {
  if (effect !== 'RESULT') return;

  const current = await unsafeDb.monthlyColumn.findFirst({
    where: {
      resultEffect: 'RESULT',
      deletedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { key: true, label: true },
  });

  if (current) {
    throw new ConflictError(
      `Kolom "${current.label}" sudah menjadi kolom hasil. Ubah kolom itu terlebih dahulu sebelum menetapkan yang baru.`,
    );
  }
}

export type UpdateColumnInput = Partial<CreateColumnInput>;

/** Keys are lowercase snake_case identifiers, matching the seeded set. */
function normaliseKey(key: string): string {
  return key.trim().toLowerCase();
}

/** Empty strings from an untouched optional input are stored as NULL, not "". */
function emptyToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The unique index on `key` spans soft-deleted rows, so the probe must too —
 * otherwise a key that only looks free produces a database error rather than a
 * 409 the administrator can act on.
 */
async function findKeyHolder(
  key: string,
  excludeId: string | null,
): Promise<{ id: string; deletedAt: Date | null } | null> {
  return unsafeDb.monthlyColumn.findFirst({
    where: { key, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, deletedAt: true },
  });
}

async function assertKeyAvailable(
  key: string,
  excludeId: string | null,
): Promise<void> {
  const clash = await findKeyHolder(key, excludeId);
  if (!clash) return;

  throw new ConflictError(
    clash.deletedAt
      ? `Key "${key}" masih dipakai oleh kolom yang sudah dihapus.`
      : `Key "${key}" sudah digunakan oleh kolom lain.`,
  );
}

async function nextPosition(): Promise<number> {
  const last = await unsafeDb.monthlyColumn.findFirst({
    where: { deletedAt: null },
    select: { position: true },
    orderBy: { position: 'desc' },
  });
  return (last?.position ?? 0) + POSITION_STEP;
}

export async function listColumns(
  ctx: AccessContext,
  filters: ListColumnsFilters = {},
) {
  ctx.requirePermission('column.view');

  const search = filters.search?.trim();

  return unsafeDb.monthlyColumn.findMany({
    where: {
      deletedAt: null,
      ...(filters.includeHidden ? {} : { isVisible: true }),
      ...(search
        ? {
            OR: [
              { key: { contains: search, mode: 'insensitive' as const } },
              { label: { contains: search, mode: 'insensitive' as const } },
              { group: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    select: COLUMN_SELECT,
    orderBy: [{ position: 'asc' }, { label: 'asc' }],
    take: 500,
  });
}

async function loadColumn(id: string) {
  const column = await unsafeDb.monthlyColumn.findFirst({
    where: { id, deletedAt: null },
    select: COLUMN_SELECT,
  });
  if (!column) throw new NotFoundError('Kolom tidak ditemukan.');
  return column;
}

/** Exactly the shape COLUMN_SELECT projects — not the full model. */
type ColumnRecord = Prisma.MonthlyColumnGetPayload<{ select: typeof COLUMN_SELECT }>;

export interface CreateColumnResult {
  column: ColumnRecord;
  /** True when a soft-deleted column was revived rather than inserted. */
  restored: boolean;
  /** Monthly values that became visible again with the restore. */
  reattachedValues: number;
}

/**
 * Creates a column, or revives a soft-deleted one holding the same key.
 *
 * Monthly values reference a column by id, so a second row with the same key
 * would leave every recorded figure attached to the old, invisible one. Reusing
 * a key means "bring this column back", including its history.
 */
export async function createColumn(
  ctx: AccessContext,
  input: CreateColumnInput,
): Promise<CreateColumnResult> {
  ctx.requirePermission('column.create');

  const key = normaliseKey(input.key);
  const holder = await findKeyHolder(key, null);

  if (holder && !holder.deletedAt) {
    throw new ConflictError(`Key "${key}" sudah digunakan oleh kolom lain.`);
  }

  await assertSingleResultColumn(input.resultEffect, holder?.id ?? null);

  const data = {
    key,
    label: input.label.trim(),
    group: emptyToNull(input.group) ?? null,
    dataType: input.dataType,
    precision: input.precision,
    unit: emptyToNull(input.unit) ?? null,
    isRequired: input.isRequired,
    isVisible: input.isVisible,
    includeInTotals: input.includeInTotals,
    resultEffect: input.resultEffect,
    updatedById: ctx.userId,
  };

  if (holder) {
    const [reattachedValues, column] = await unsafeDb.$transaction([
      unsafeDb.monthlyValue.count({ where: { columnId: holder.id } }),
      unsafeDb.monthlyColumn.update({
        where: { id: holder.id },
        data: {
          ...data,
          deletedAt: null,
          position: input.position ?? (await nextPosition()),
        },
        select: COLUMN_SELECT,
      }),
    ]);

    await recordAudit({
      action: 'column.restored',
      module: 'Column',
      actorId: ctx.userId,
      actorEmail: ctx.email,
      entityType: 'MonthlyColumn',
      entityId: column.id,
      after: { ...column, reattachedValues },
    });

    return { column, restored: true, reattachedValues };
  }

  const column = await unsafeDb.monthlyColumn.create({
    data: {
      ...data,
      position: input.position ?? (await nextPosition()),
      // Only the seed marks a column as system-owned. Nothing an administrator
      // creates through this endpoint may claim that protection for itself.
      isSystem: false,
      createdById: ctx.userId,
    },
    select: COLUMN_SELECT,
  });

  await recordAudit({
    action: 'column.created',
    module: 'Column',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'MonthlyColumn',
    entityId: column.id,
    after: column,
  });

  return { column, restored: false, reattachedValues: 0 };
}

export async function updateColumn(
  ctx: AccessContext,
  id: string,
  input: UpdateColumnInput,
) {
  ctx.requirePermission('column.update');

  const before = await loadColumn(id);

  const key = input.key === undefined ? undefined : normaliseKey(input.key);

  if (key !== undefined && key !== before.key) {
    // Importers match on the key and formulas reference it by name, so renaming
    // a system column would break expressions that cannot be repaired from
    // here. The rest of a system column stays editable.
    if (before.isSystem) {
      throw new ConflictError(
        'Key kolom sistem tidak dapat diubah. Ubah label atau posisinya saja.',
      );
    }
    await assertKeyAvailable(key, id);
  }

  if (input.resultEffect !== undefined) {
    await assertSingleResultColumn(input.resultEffect, id);
  }

  // A result is a sum, so it has to be a number. Allowing TEXT or BOOLEAN here
  // would produce a column the calculation writes a number into and the
  // formatter renders as something else.
  const effect = input.resultEffect ?? before.resultEffect;
  const dataType = input.dataType ?? before.dataType;
  if (
    effect !== 'NEUTRAL' &&
    (dataType === 'TEXT' || dataType === 'DATE' || dataType === 'BOOLEAN')
  ) {
    throw new ConflictError(
      'Kolom yang ikut perhitungan hasil harus bertipe angka (mata uang, desimal, bilangan bulat, atau persentase).',
    );
  }

  // The key identifies the column to importers and to the Excel template. The
  // result column is referenced by every contributing figure, so renaming it
  // silently breaks a round trip nobody would think to re-test.
  if (key !== undefined && key !== before.key && before.resultEffect === 'RESULT') {
    throw new ConflictError(
      'Key kolom hasil tidak dapat diubah. Ubah label atau posisinya saja.',
    );
  }

  const group = emptyToNull(input.group);
  const unit = emptyToNull(input.unit);

  const updated = await unsafeDb.monthlyColumn.update({
    where: { id },
    data: {
      ...(key !== undefined ? { key } : {}),
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(input.dataType !== undefined ? { dataType: input.dataType } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.precision !== undefined ? { precision: input.precision } : {}),
      ...(unit !== undefined ? { unit } : {}),
      ...(input.isRequired !== undefined ? { isRequired: input.isRequired } : {}),
      ...(input.isVisible !== undefined ? { isVisible: input.isVisible } : {}),
      ...(input.includeInTotals !== undefined
        ? { includeInTotals: input.includeInTotals }
        : {}),
      ...(input.resultEffect !== undefined ? { resultEffect: input.resultEffect } : {}),
      updatedById: ctx.userId,
    },
    select: COLUMN_SELECT,
  });

  await recordAudit({
    action: 'column.updated',
    module: 'Column',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'MonthlyColumn',
    entityId: id,
    before,
    after: updated,
  });

  return updated;
}

/** Soft delete, and never for a system column. */
export async function deleteColumn(ctx: AccessContext, id: string) {
  ctx.requirePermission('column.delete');

  const before = await loadColumn(id);

  if (before.isSystem) {
    throw new ConflictError(
      'Kolom sistem tidak dapat dihapus. Sembunyikan kolom ini jika tidak ingin menampilkannya.',
    );
  }

  // Deleting the result column leaves every contributing column still marked
  // ADD or SUBTRACT with nowhere for their sum to land — the figure would
  // silently stop appearing while the configuration still claims to compute it.
  if (before.resultEffect === 'RESULT') {
    throw new ConflictError(
      'Kolom hasil tidak dapat dihapus. Ubah "Perhitungan hasil" menjadi Tetap terlebih dahulu, lalu hapus.',
    );
  }

  const deletedAt = new Date();

  const deleted = await unsafeDb.monthlyColumn.update({
    where: { id },
    data: { deletedAt, isVisible: false, updatedById: ctx.userId },
    select: COLUMN_SELECT,
  });

  await recordAudit({
    action: 'column.deleted',
    module: 'Column',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'MonthlyColumn',
    entityId: id,
    before,
    after: { deletedAt },
  });

  return deleted;
}
