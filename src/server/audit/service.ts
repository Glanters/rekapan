import type { Prisma } from '@/generated/prisma/client';

import type { AccessContext } from '../auth/access-context';
import { permissionsByModule } from '../auth/permissions';
import { unsafeDb } from '../db/prisma';

/**
 * Audit log reads.
 *
 * Read-only by design. `record.ts` is the only writer and nothing here — nor
 * anywhere in the UI — updates or deletes a row: an audit trail that its own
 * administrators can edit records nothing worth reading later.
 *
 * SCALE. This table grows without bound and is expected to reach millions of
 * rows, so every query here is written for that size rather than for the
 * development dataset:
 *
 *   - Always paginated. `take` is clamped to {@link AUDIT_MAX_PER_PAGE}, so no
 *     caller — however the query string is crafted — can ask for the whole
 *     table.
 *   - Always ordered by `createdAt desc`, which has a dedicated descending
 *     index, so the newest page is a bounded index scan rather than a sort of
 *     the entire relation.
 *   - The filters offered map onto the composite indexes the schema already
 *     declares (`createdAt`, `module + createdAt`, `actorId + createdAt`).
 *
 * `unsafeDb` matches `record.ts`: AuditLog is not a site-scoped model, and its
 * visibility rule is expressed explicitly in {@link buildWhere} instead.
 */

export const AUDIT_DEFAULT_PER_PAGE = 50;
export const AUDIT_MAX_PER_PAGE = 200;
export const AUDIT_MIN_PER_PAGE = 10;

/**
 * Modules the filter offers.
 *
 * Derived from the permission catalogue so the list cannot drift, plus the
 * modules that only ever appear in the trail. 'Auth' is written by the sign-in
 * path and owns no permission of its own, so deriving the list purely from the
 * catalogue would hide every login and lockout entry behind "all modules".
 */
const AUDIT_ONLY_MODULES = ['Auth'] as const;

export function auditModules(): string[] {
  return [...new Set([...AUDIT_ONLY_MODULES, ...permissionsByModule().keys()])].sort();
}

export interface AuditListFilters {
  module?: string | undefined;
  action?: string | undefined;
  actorEmail?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
}

const AUDIT_SELECT = {
  id: true,
  createdAt: true,
  actorId: true,
  actorEmail: true,
  action: true,
  module: true,
  siteId: true,
  entityType: true,
  entityId: true,
  before: true,
  after: true,
  ip: true,
  requestId: true,
} as const;

function clampInt(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function buildWhere(
  ctx: AccessContext,
  filters: AuditListFilters,
): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  // A non-Root caller sees entries for the sites they hold, plus the entries
  // that belong to no site at all. The second branch is load-bearing: user
  // administration, role changes, settings, and sign-ins all record a null
  // siteId, so a site-only rule would leave the trail looking empty for
  // everyone except Root.
  if (!ctx.isRoot) {
    where.OR = [{ siteId: null }, { siteId: { in: [...(ctx.siteIds ?? [])] } }];
  }

  // Exact match, not `contains`: the value comes from a fixed list, and an
  // equality predicate is what the (module, createdAt) index can serve.
  if (filters.module) where.module = filters.module;

  if (filters.action) {
    where.action = { contains: filters.action, mode: 'insensitive' };
  }

  if (filters.actorEmail) {
    where.actorEmail = { contains: filters.actorEmail, mode: 'insensitive' };
  }

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  return where;
}

/**
 * Resolves the sites referenced by a page of entries to their code and name.
 *
 * `unsafeDb`, like every other read in this module: the IDs come from entries
 * the caller has already been cleared to see by {@link buildWhere}, so a lookup
 * keyed on them surfaces nothing the trail did not already expose. A null siteId
 * (user admin, roles, settings, sign-ins) simply has no entry.
 */
async function resolveSites(
  siteIds: readonly (string | null)[],
): Promise<Map<string, { code: string; name: string }>> {
  const unique = [...new Set(siteIds.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();

  const sites = await unsafeDb.site.findMany({
    where: { id: { in: unique } },
    select: { id: true, code: true, name: true },
  });

  return new Map(sites.map((site) => [site.id, { code: site.code, name: site.name }]));
}

/**
 * One bounded page of the trail, newest first.
 *
 * The count runs against the same predicate as the page so the two cannot
 * disagree. It is the more expensive half of the pair on a large table, but the
 * envelope's pagination meta needs a total, and a count never materialises rows
 * the way an unbounded `findMany` would.
 */
export async function listAuditLogs(
  ctx: AccessContext,
  filters: AuditListFilters = {},
) {
  ctx.requirePermission('audit.view');

  const page = clampInt(filters.page, 1, Number.MAX_SAFE_INTEGER, 1);
  const perPage = clampInt(
    filters.perPage,
    AUDIT_MIN_PER_PAGE,
    AUDIT_MAX_PER_PAGE,
    AUDIT_DEFAULT_PER_PAGE,
  );

  const where = buildWhere(ctx, filters);

  const [entries, total] = await Promise.all([
    unsafeDb.auditLog.findMany({
      where,
      select: AUDIT_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    unsafeDb.auditLog.count({ where }),
  ]);

  // Enrich the bare siteId with the site's code and name, so the table can show
  // which site an action touched rather than an opaque UUID.
  const siteById = await resolveSites(entries.map((entry) => entry.siteId));
  const rows = entries.map((entry) => {
    const site = entry.siteId ? siteById.get(entry.siteId) : undefined;
    return { ...entry, siteCode: site?.code ?? null, siteName: site?.name ?? null };
  });

  return { entries: rows, total, page, perPage };
}
