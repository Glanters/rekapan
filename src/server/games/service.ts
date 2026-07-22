import type { Prisma } from '@/generated/prisma/client';

import { recordAudit } from '../audit/record';
import type { AccessContext } from '../auth/access-context';
import { unsafeDb } from '../db/prisma';
import { ConflictError, NotFoundError } from '../errors';

/**
 * Turnover game master data.
 *
 * A game IS a Turnover column. The Turnover table is entity–attribute–value:
 * each `TurnoverValue` row pairs a report with a game, so the games listed here
 * are exactly the columns operators see across the top of the Turnover grid,
 * ordered by `position` and grouped by `category`. Creating a game therefore
 * widens every Turnover report at once, and deleting one removes a column from
 * all of them — which is why `game.create` and `game.delete` are separate
 * permissions rather than folded into a generic master-data grant.
 *
 * `TurnoverGame` is not site-scoped: the column set is shared by every site so
 * that reports stay comparable. `unsafeDb` is correct here, and the tripwire
 * would not fire on this model in any case.
 *
 * Deletes are soft. `TurnoverValue.game` is `onDelete: Restrict`, so a hard
 * delete of a game that has ever been filled in would be refused by the
 * database; clearing `deletedAt` also keeps historical figures readable.
 */

const GAME_SELECT = {
  id: true,
  code: true,
  name: true,
  category: true,
  position: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Gap between generated positions, so a game can be slotted between two others. */
const POSITION_STEP = 10;

export interface ListGamesFilters {
  search?: string | undefined;
  includeInactive?: boolean | undefined;
}

export interface CreateGameInput {
  code: string;
  name: string;
  category: string | null;
  position?: number | undefined;
  isActive: boolean;
}

export type UpdateGameInput = Partial<CreateGameInput>;

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
 * {@link createGame}.
 */
async function findCodeHolder(
  code: string,
  excludeId: string | null,
): Promise<{ id: string; deletedAt: Date | null } | null> {
  return unsafeDb.turnoverGame.findFirst({
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
      ? `Kode "${code}" masih dipakai oleh game yang sudah dihapus.`
      : `Kode "${code}" sudah digunakan oleh game lain.`,
  );
}

/** Next free slot at the end of the table, leaving room to insert before it. */
async function nextPosition(): Promise<number> {
  const last = await unsafeDb.turnoverGame.findFirst({
    where: { deletedAt: null },
    select: { position: true },
    orderBy: { position: 'desc' },
  });
  return (last?.position ?? 0) + POSITION_STEP;
}

export async function listGames(ctx: AccessContext, filters: ListGamesFilters = {}) {
  ctx.requirePermission('game.view');

  const search = filters.search?.trim();

  return unsafeDb.turnoverGame.findMany({
    where: {
      deletedAt: null,
      ...(filters.includeInactive ? {} : { isActive: true }),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' as const } },
              { name: { contains: search, mode: 'insensitive' as const } },
              { category: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    select: GAME_SELECT,
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    take: 500,
  });
}

async function loadGame(id: string) {
  const game = await unsafeDb.turnoverGame.findFirst({
    where: { id, deletedAt: null },
    select: GAME_SELECT,
  });
  if (!game) throw new NotFoundError('Game tidak ditemukan.');
  return game;
}

/** Exactly the shape GAME_SELECT projects — not the full model. */
type GameRecord = Prisma.TurnoverGameGetPayload<{ select: typeof GAME_SELECT }>;

export interface CreateGameResult {
  game: GameRecord;
  /** True when an existing soft-deleted game was revived rather than inserted. */
  restored: boolean;
  /** Turnover values that became visible again with the restore. */
  reattachedValues: number;
}

/**
 * Creates a game, or revives a soft-deleted one holding the same code.
 *
 * Reviving rather than inserting a fresh row is the whole point. Turnover
 * values reference a game by id, so a second row with the same code would leave
 * every historical figure attached to the old, invisible one — the table would
 * come back empty and the old numbers would be unreachable through the UI.
 * Reusing a code means "I want this game back", and that is what happens.
 */
export async function createGame(
  ctx: AccessContext,
  input: CreateGameInput,
): Promise<CreateGameResult> {
  ctx.requirePermission('game.create');

  const code = normaliseCode(input.code);
  const holder = await findCodeHolder(code, null);

  if (holder && !holder.deletedAt) {
    throw new ConflictError(`Kode "${code}" sudah digunakan oleh game lain.`);
  }

  const data = {
    code,
    name: input.name.trim(),
    category: emptyToNull(input.category) ?? null,
    isActive: input.isActive,
    updatedById: ctx.userId,
  };

  if (holder) {
    const [reattachedValues, game] = await unsafeDb.$transaction([
      unsafeDb.turnoverValue.count({ where: { gameId: holder.id } }),
      unsafeDb.turnoverGame.update({
        where: { id: holder.id },
        data: {
          ...data,
          deletedAt: null,
          // Position is re-taken at the end rather than reusing the old slot,
          // which may since have been claimed by another game.
          position: input.position ?? (await nextPosition()),
        },
        select: GAME_SELECT,
      }),
    ]);

    await recordAudit({
      action: 'game.restored',
      module: 'Game',
      actorId: ctx.userId,
      actorEmail: ctx.email,
      entityType: 'TurnoverGame',
      entityId: game.id,
      after: { ...game, reattachedValues },
    });

    return { game, restored: true, reattachedValues };
  }

  const game = await unsafeDb.turnoverGame.create({
    data: {
      ...data,
      position: input.position ?? (await nextPosition()),
      createdById: ctx.userId,
    },
    select: GAME_SELECT,
  });

  await recordAudit({
    action: 'game.created',
    module: 'Game',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'TurnoverGame',
    entityId: game.id,
    after: game,
  });

  return { game, restored: false, reattachedValues: 0 };
}

export async function updateGame(
  ctx: AccessContext,
  id: string,
  input: UpdateGameInput,
) {
  ctx.requirePermission('game.update');

  const before = await loadGame(id);

  const code = input.code === undefined ? undefined : normaliseCode(input.code);
  if (code !== undefined && code !== before.code) {
    await assertCodeAvailable(code, id);
  }

  const category = emptyToNull(input.category);

  const updated = await unsafeDb.turnoverGame.update({
    where: { id },
    data: {
      ...(code !== undefined ? { code } : {}),
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedById: ctx.userId,
    },
    select: GAME_SELECT,
  });

  await recordAudit({
    action: 'game.updated',
    module: 'Game',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'TurnoverGame',
    entityId: id,
    before,
    after: updated,
  });

  return updated;
}

/** Soft delete: the column disappears from the Turnover grid, the data does not. */
export async function deleteGame(ctx: AccessContext, id: string) {
  ctx.requirePermission('game.delete');

  const before = await loadGame(id);
  const deletedAt = new Date();

  const deleted = await unsafeDb.turnoverGame.update({
    where: { id },
    data: { deletedAt, isActive: false, updatedById: ctx.userId },
    select: GAME_SELECT,
  });

  await recordAudit({
    action: 'game.deleted',
    module: 'Game',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'TurnoverGame',
    entityId: id,
    before,
    after: { deletedAt },
  });

  return deleted;
}
