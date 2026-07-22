import type { Prisma } from '@/generated/prisma/client';

import type { SiteStatus } from '@/generated/prisma/enums';

import { recordAudit } from '../audit/record';
import type { AccessContext } from '../auth/access-context';
import { scopedDb, unsafeDb } from '../db/prisma';
import { scopedWhere } from '../db/site-scope';
import { ConflictError, NotFoundError } from '../errors';

/**
 * Site master data.
 *
 * `Site` is a site-scoped model, and its scope rule is `ownId`: a row *is* the
 * site, so the constraint lands on the primary key rather than a `siteId`
 * column. Every read therefore goes through `scopedDb` with `scopedWhere`, or
 * the tripwire refuses the query.
 *
 * The writes need more explanation, because two of them look like they dodge
 * the guard:
 *
 *   - CREATE runs on `unsafeDb`. The tripwire's data guard demands that the
 *     row's own id already be one the caller may reach — which a site that does
 *     not exist yet can never satisfy. There is no way to express "create a
 *     site" inside the guard for a non-Root caller, so the permission check and
 *     the membership grant below are what bound the operation instead.
 *   - UPDATE and DELETE load the target through the scoped client first. That
 *     read is scope-checked, so a caller who cannot see a site never obtains an
 *     id to write against. This is the same rule the value tables rely on, and
 *     it is documented as the intended pattern in `db/prisma.ts`.
 *
 * DELETE is always soft. `MonthlyReport`, `TurnoverReport`, and `ImageAsset`
 * all reference `Site` with `onDelete: Restrict`, so a hard delete would either
 * be refused by the database or, worse, take a site's history with it. Clearing
 * `deletedAt` is the only reversible option.
 */

const SITE_SELECT = {
  id: true,
  code: true,
  name: true,
  timezone: true,
  currency: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface ListSitesFilters {
  status?: SiteStatus | undefined;
  search?: string | undefined;
}

export interface CreateSiteInput {
  code: string;
  name: string;
  timezone: string;
  currency: string;
  status: SiteStatus;
}

export type UpdateSiteInput = Partial<CreateSiteInput>;

/** Normalised the same way on create and update so a code cannot drift by case. */
function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Rejects a duplicate `code` before Prisma does.
 *
 * The probe deliberately runs on `unsafeDb` and deliberately ignores
 * `deletedAt`. The unique index is global and spans soft-deleted rows, so a
 * scoped or filtered probe would report a code as free that the database will
 * then refuse — turning a clear 409 into an opaque 500.
 */
async function findCodeHolder(
  code: string,
  excludeId: string | null,
): Promise<{ id: string; deletedAt: Date | null } | null> {
  return unsafeDb.site.findFirst({
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
      ? `Kode "${code}" masih dipakai oleh site yang sudah dihapus.`
      : `Kode "${code}" sudah digunakan oleh site lain.`,
  );
}

export async function listSites(ctx: AccessContext, filters: ListSitesFilters = {}) {
  ctx.requirePermission('site.view');

  const search = filters.search?.trim();

  return scopedDb(ctx).site.findMany({
    where: scopedWhere(ctx, 'Site', {
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      // Safe inside `scopedWhere`: the caller's filter is AND-ed with the site
      // constraint, so this OR narrows within scope rather than widening past it.
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' as const } },
              { name: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }),
    select: SITE_SELECT,
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    take: 500,
  });
}

/** Scope-checked point lookup. Returns 404 for sites outside the caller's reach. */
async function loadSite(ctx: AccessContext, id: string) {
  const site = await scopedDb(ctx).site.findFirst({
    where: scopedWhere(ctx, 'Site', { id, deletedAt: null }),
    select: SITE_SELECT,
  });
  if (!site) throw new NotFoundError('Site tidak ditemukan.');
  return site;
}

/** Exactly the shape SITE_SELECT projects — not the full model. */
type SiteRecord = Prisma.SiteGetPayload<{ select: typeof SITE_SELECT }>;

export interface CreateSiteResult {
  site: SiteRecord;
  /** True when a soft-deleted site was revived rather than inserted. */
  restored: boolean;
  /** Reports and images that became reachable again with the restore. */
  reattached: { monthly: number; turnover: number; images: number };
}

/**
 * Creates a site, or revives a soft-deleted one holding the same code.
 *
 * Reports and images reference a site by id. Inserting a second row with the
 * same code would leave every existing report attached to the old, invisible
 * one — the data is not gone, but nothing in the UI can reach it, which is
 * indistinguishable from losing it. Reusing a code means "bring this site
 * back", so that is what happens.
 */
export async function createSite(
  ctx: AccessContext,
  input: CreateSiteInput,
): Promise<CreateSiteResult> {
  ctx.requirePermission('site.create');

  const code = normaliseCode(input.code);
  const holder = await findCodeHolder(code, null);

  if (holder && !holder.deletedAt) {
    throw new ConflictError(`Kode "${code}" sudah digunakan oleh site lain.`);
  }

  if (holder) {
    return restoreSite(ctx, holder.id, code, input);
  }

  const site = await unsafeDb.$transaction(async (tx) => {
    const created = await tx.site.create({
      data: {
        code,
        name: input.name.trim(),
        timezone: input.timezone.trim(),
        currency: input.currency.trim().toUpperCase(),
        status: input.status,
        createdById: ctx.userId,
        updatedById: ctx.userId,
      },
      select: SITE_SELECT,
    });

    // A non-Root creator is not a member of the site they just created, so it
    // would vanish from their own list the instant it was saved — and nobody
    // could grant them access to it either, since `setUserSites` only hands out
    // sites the grantor already holds. Membership is granted here to keep the
    // create-then-see-it loop closed. Root needs no row: it reaches every site.
    if (!ctx.isRoot) {
      await tx.userSite.create({
        data: { userId: ctx.userId, siteId: created.id, assignedById: ctx.userId },
      });
    }

    return created;
  });

  await recordAudit({
    action: 'site.created',
    module: 'Site',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    siteId: site.id,
    entityType: 'Site',
    entityId: site.id,
    after: site,
  });

  return { site, restored: false, reattached: { monthly: 0, turnover: 0, images: 0 } };
}

/**
 * Revives a soft-deleted site and reports what came back with it.
 *
 * Membership is re-granted for a non-Root caller for the same reason it is on
 * create: without it the site reappears in the database but not in the list of
 * the person who just restored it.
 */
async function restoreSite(
  ctx: AccessContext,
  id: string,
  code: string,
  input: CreateSiteInput,
): Promise<CreateSiteResult> {
  const [monthly, turnover, images] = await Promise.all([
    unsafeDb.monthlyReport.count({ where: { siteId: id, deletedAt: null } }),
    unsafeDb.turnoverReport.count({ where: { siteId: id, deletedAt: null } }),
    unsafeDb.imageAsset.count({ where: { siteId: id, deletedAt: null } }),
  ]);

  const site = await unsafeDb.$transaction(async (tx) => {
    const revived = await tx.site.update({
      where: { id },
      data: {
        code,
        name: input.name.trim(),
        timezone: input.timezone.trim(),
        currency: input.currency.trim().toUpperCase(),
        status: input.status,
        deletedAt: null,
        updatedById: ctx.userId,
      },
      select: SITE_SELECT,
    });

    if (!ctx.isRoot) {
      // The membership row may have survived the soft delete, so this is an
      // upsert rather than a create — a duplicate would violate the composite key.
      await tx.userSite.upsert({
        where: { userId_siteId: { userId: ctx.userId, siteId: id } },
        create: { userId: ctx.userId, siteId: id, assignedById: ctx.userId },
        update: {},
      });
    }

    return revived;
  });

  await recordAudit({
    action: 'site.restored',
    module: 'Site',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    siteId: id,
    entityType: 'Site',
    entityId: id,
    after: { ...site, reattached: { monthly, turnover, images } },
  });

  return { site, restored: true, reattached: { monthly, turnover, images } };
}

export async function updateSite(
  ctx: AccessContext,
  id: string,
  input: UpdateSiteInput,
) {
  ctx.requirePermission('site.update');

  const before = await loadSite(ctx, id);

  const code = input.code === undefined ? undefined : normaliseCode(input.code);
  if (code !== undefined && code !== before.code) {
    await assertCodeAvailable(code, id);
  }

  const updated = await scopedDb(ctx).site.update({
    where: { id },
    data: {
      ...(code !== undefined ? { code } : {}),
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone.trim() } : {}),
      ...(input.currency !== undefined
        ? { currency: input.currency.trim().toUpperCase() }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedById: ctx.userId,
    },
    select: SITE_SELECT,
  });

  await recordAudit({
    action: 'site.updated',
    module: 'Site',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    siteId: id,
    entityType: 'Site',
    entityId: id,
    before,
    after: updated,
  });

  return updated;
}

/**
 * Soft delete. Never `delete()` — see the note at the top of this module.
 */
export async function deleteSite(ctx: AccessContext, id: string) {
  ctx.requirePermission('site.delete');

  const before = await loadSite(ctx, id);
  const deletedAt = new Date();

  const deleted = await scopedDb(ctx).site.update({
    where: { id },
    data: { deletedAt, updatedById: ctx.userId },
    select: SITE_SELECT,
  });

  await recordAudit({
    action: 'site.deleted',
    module: 'Site',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    siteId: id,
    entityType: 'Site',
    entityId: id,
    before,
    after: { deletedAt },
  });

  return deleted;
}
