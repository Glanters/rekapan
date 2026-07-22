import type { UserStatus } from '@/generated/prisma/enums';

import type { AccessContext } from '../auth/access-context';
import { revokeAllSessions } from '../auth/session';
import { recordAudit } from '../audit/record';
import { unsafeDb } from '../db/prisma';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors';

/**
 * User administration — activation, roles, and site assignment.
 *
 * This module is where the activation gate is actually opened, so its guards
 * matter more than most:
 *
 *   - Rank. A caller may only manage users below their own role level, and may
 *     only grant roles below it. Without both halves, an admin could hand their
 *     own role to an accomplice, or edit a peer who could edit them back.
 *   - Self. A caller cannot suspend or demote themselves — an easy way to lock
 *     the last administrator out of the system by accident.
 *   - Sites. A non-Root caller can only grant site access they themselves hold.
 *     Otherwise site isolation would be trivially escapable: assign yourself a
 *     deputy on a site you cannot see, and read the data through them.
 *
 * `unsafeDb` is used deliberately. `User` is not a site-owned table, and
 * visibility here follows different rules than data scoping — see listUsers.
 */

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  status: true,
  avatarUrl: true,
  lastLoginAt: true,
  activatedAt: true,
  createdAt: true,
  role: { select: { id: true, key: true, name: true, level: true } },
  sites: { select: { site: { select: { id: true, code: true, name: true } } } },
} as const;

/**
 * Resolves a set of user IDs to display names in a single query.
 *
 * For where a stored `createdById` / `updatedById` needs a human label — the
 * report tables' info popover, for one. Nulls and duplicates are tolerated, and
 * an id that doesn't resolve (a deleted user) is simply absent from the map, so
 * the caller decides how to render "unknown".
 *
 * `unsafeDb` for the same reason the rest of this module uses it: a name is not
 * site-owned data, and the caller is already looking at a record that stores
 * the id.
 */
export async function resolveUserNames(
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const users = await unsafeDb.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });

  return new Map(users.map((user) => [user.id, user.name]));
}

export interface ListUsersFilters {
  status?: UserStatus | undefined;
  search?: string | undefined;
}

/**
 * Lists the users a caller may administer.
 *
 * Non-Root callers see users who share at least one of their sites, plus every
 * PENDING user. The second clause is load-bearing: a newly provisioned account
 * has no sites yet, so a site-only rule would make it invisible to precisely
 * the people whose job is to approve it, and nobody could ever be onboarded.
 *
 * The `OR` here is safe, unlike in site-scoped data queries — this defines
 * which *user records* are administrable, not which site's data is readable.
 */
export async function listUsers(ctx: AccessContext, filters: ListUsersFilters = {}) {
  ctx.requirePermission('user.view');

  const visibility = ctx.isRoot
    ? {}
    : {
        OR: [
          { status: 'PENDING' as const },
          { sites: { some: { siteId: { in: [...(ctx.siteIds ?? [])] } } } },
        ],
      };

  const search = filters.search?.trim();

  return unsafeDb.user.findMany({
    where: {
      deletedAt: null,
      ...visibility,
      ...(filters.status ? { status: filters.status } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' as const } },
              { name: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    select: USER_SELECT,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 200,
  });
}

async function loadTarget(userId: string) {
  const user = await unsafeDb.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      ...USER_SELECT,
      role: { select: { id: true, key: true, name: true, level: true } },
    },
  });
  if (!user) throw new NotFoundError('User not found.');
  return user;
}

function assertNotSelf(ctx: AccessContext, userId: string, action: string): void {
  if (ctx.userId === userId) {
    throw new ConflictError(
      `You cannot ${action} your own account. Ask another administrator to do it.`,
    );
  }
}

/** Moves a PENDING account to ACTIVE, opening the gate for that user. */
export async function activateUser(ctx: AccessContext, userId: string) {
  ctx.requirePermission('user.activate');

  const target = await loadTarget(userId);
  ctx.requireOutranks(target.role?.level ?? null, 'a user');

  if (target.status === 'ACTIVE') {
    throw new ConflictError('That account is already active.');
  }

  const updated = await unsafeDb.user.update({
    where: { id: userId },
    data: {
      status: 'ACTIVE',
      activatedAt: new Date(),
      activatedById: ctx.userId,
      updatedById: ctx.userId,
    },
    select: USER_SELECT,
  });

  await recordAudit({
    action: 'user.activated',
    module: 'User',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'User',
    entityId: userId,
    before: { status: target.status },
    after: { status: 'ACTIVE' },
  });

  return updated;
}

export async function setUserStatus(
  ctx: AccessContext,
  userId: string,
  status: Extract<UserStatus, 'SUSPENDED' | 'INACTIVE' | 'ACTIVE'>,
) {
  ctx.requirePermission('user.suspend');
  assertNotSelf(ctx, userId, 'change the status of');

  const target = await loadTarget(userId);
  ctx.requireOutranks(target.role?.level ?? null, 'a user');

  const updated = await unsafeDb.user.update({
    where: { id: userId },
    data: { status, updatedById: ctx.userId },
    select: USER_SELECT,
  });

  // Suspension must take effect now, not whenever the session happens to lapse.
  if (status !== 'ACTIVE') {
    const revoked = await revokeAllSessions(userId);
    await recordAudit({
      action: 'user.sessions_revoked',
      module: 'User',
      actorId: ctx.userId,
      actorEmail: ctx.email,
      entityType: 'User',
      entityId: userId,
      after: { revokedSessions: revoked },
    });
  }

  await recordAudit({
    action: status === 'ACTIVE' ? 'user.reinstated' : 'user.suspended',
    module: 'User',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'User',
    entityId: userId,
    before: { status: target.status },
    after: { status },
  });

  return updated;
}

export async function setUserRole(ctx: AccessContext, userId: string, roleId: string) {
  ctx.requirePermission('user.update');
  assertNotSelf(ctx, userId, 'change the role of');

  const [target, role] = await Promise.all([
    loadTarget(userId),
    unsafeDb.role.findFirst({
      where: { id: roleId, deletedAt: null },
      select: { id: true, key: true, name: true, level: true },
    }),
  ]);

  if (!role) throw new NotFoundError('Role not found.');

  // Both halves are required: outranking the user being changed, and outranking
  // the role being handed out. Checking only the former would let a Manager
  // promote a junior straight past themselves to Super Admin.
  ctx.requireOutranks(target.role?.level ?? null, 'a user');
  ctx.requireOutranks(role.level, 'a role');

  const updated = await unsafeDb.user.update({
    where: { id: userId },
    data: { roleId, updatedById: ctx.userId },
    select: USER_SELECT,
  });

  await recordAudit({
    action: 'user.role_changed',
    module: 'User',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'User',
    entityId: userId,
    before: { role: target.role?.key ?? null },
    after: { role: role.key },
  });

  return updated;
}

/** Replaces a user's site assignments wholesale. */
export async function setUserSites(
  ctx: AccessContext,
  userId: string,
  siteIds: readonly string[],
) {
  ctx.requirePermission('user.assign_site');

  const target = await loadTarget(userId);
  ctx.requireOutranks(target.role?.level ?? null, 'a user');

  // A caller cannot grant reach they do not have; otherwise site isolation is
  // escapable by proxy.
  if (!ctx.isRoot) {
    const allowed = new Set(ctx.siteIds ?? []);
    const overreach = siteIds.filter((id) => !allowed.has(id));
    if (overreach.length > 0) {
      throw new ForbiddenError(
        'You can only assign sites you have access to yourself.',
        { deniedSiteIds: overreach },
      );
    }
  }

  const existing = await unsafeDb.site.findMany({
    where: { id: { in: [...siteIds] }, deletedAt: null },
    select: { id: true },
  });
  if (existing.length !== siteIds.length) {
    throw new ValidationError('One or more of the selected sites no longer exist.');
  }

  const before = target.sites.map((s) => s.site.code);

  await unsafeDb.$transaction([
    unsafeDb.userSite.deleteMany({
      where: { userId, siteId: { notIn: [...siteIds] } },
    }),
    unsafeDb.userSite.createMany({
      data: siteIds.map((siteId) => ({ userId, siteId, assignedById: ctx.userId })),
      skipDuplicates: true,
    }),
  ]);

  const updated = await loadTarget(userId);

  await recordAudit({
    action: 'user.sites_changed',
    module: 'User',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'User',
    entityId: userId,
    before: { sites: before },
    after: { sites: updated.sites.map((s) => s.site.code) },
  });

  return updated;
}

/** Roles the caller is permitted to hand out. */
export async function assignableRoles(ctx: AccessContext) {
  const roles = await unsafeDb.role.findMany({
    where: { deletedAt: null },
    select: { id: true, key: true, name: true, level: true, description: true },
    orderBy: { level: 'asc' },
  });
  return roles.filter((role) => ctx.outranks(role.level));
}
