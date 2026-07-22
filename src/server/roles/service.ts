import type { AccessContext } from '../auth/access-context';
import type { PermissionKey } from '../auth/permissions';
import { isPermissionKey } from '../auth/permissions';
import { recordAudit } from '../audit/record';
import { unsafeDb } from '../db/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../errors';

/**
 * Role administration — the permission matrix behind every other guard.
 *
 * Editing a role is the most sensitive write in the system: it does not change
 * one user's access, it changes what a whole class of users may do, retroactively
 * and without their involvement. Three guards apply, and all three are enforced
 * here rather than in the UI, because the UI is not the security boundary:
 *
 *   1. Rank. A caller may only touch a role they strictly outrank. Without it a
 *      Super Admin could grant their own role a permission they lack, or edit a
 *      peer who could edit them back — privilege escalation needing one account.
 *   2. System roles. `isSystem` roles cannot be renamed or deleted. Code branches
 *      on `Role.key`, and the display name is what an administrator sees, so
 *      renaming SUPER_ADMIN to "Read only" would make the interface lie about
 *      what a role does while the key kept granting everything.
 *   3. Root. The ROOT role is immutable, full stop. Rule 1 alone does not cover
 *      it: `outranks()` short-circuits to true for a Root caller, so a Root user
 *      could otherwise strip permissions from the role their own session depends
 *      on and lock the installation out of its own administration.
 *
 * Note what rule 2 does *not* cover: a system role's permissions remain editable.
 * That is deliberate — the presets are starting points an administrator is meant
 * to tune, and only the identity of the role is frozen.
 */

const ROLE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  level: true,
  isSystem: true,
  permissions: { select: { permission: { select: { key: true } } } },
  _count: { select: { users: true } },
} as const;

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  level: number;
  isSystem: boolean;
  userCount: number;
  permissionKeys: string[];
  /** Whether this caller may change this role at all. */
  editable: boolean;
  /** Whether this caller may change its name or description. */
  renamable: boolean;
}

/** The role every caller is forbidden from touching, identified by its stable key. */
const IMMUTABLE_ROLE_KEY = 'ROOT';

function toView(
  ctx: AccessContext,
  role: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    level: number;
    isSystem: boolean;
    permissions: { permission: { key: string } }[];
    _count: { users: number };
  },
): RoleView {
  const editable =
    role.key !== IMMUTABLE_ROLE_KEY &&
    ctx.can('role.update') &&
    ctx.outranks(role.level);

  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    level: role.level,
    isSystem: role.isSystem,
    userCount: role._count.users,
    permissionKeys: role.permissions.map((entry) => entry.permission.key).sort(),
    editable,
    renamable: editable && !role.isSystem,
  };
}

export async function listRoles(ctx: AccessContext): Promise<RoleView[]> {
  ctx.requirePermission('role.view');

  const roles = await unsafeDb.role.findMany({
    where: { deletedAt: null },
    select: ROLE_SELECT,
    orderBy: { level: 'asc' },
  });

  return roles.map((role) => toView(ctx, role));
}

async function loadRole(roleId: string) {
  const role = await unsafeDb.role.findFirst({
    where: { id: roleId, deletedAt: null },
    select: ROLE_SELECT,
  });
  if (!role) throw new NotFoundError('Role not found.');
  return role;
}

/**
 * The gate every role mutation passes through.
 *
 * Both checks are required and neither implies the other — see the module note.
 */
function assertMutable(ctx: AccessContext, role: { key: string; level: number }): void {
  if (role.key === IMMUTABLE_ROLE_KEY) {
    throw new ConflictError(
      'The Root role cannot be modified. It is the recovery path for the installation.',
    );
  }
  ctx.requireOutranks(role.level, 'a role');
}

/**
 * Replaces a role's permission set wholesale.
 *
 * Replace rather than merge: the submitted list is the declared state, so a
 * permission the administrator unticked has to actually disappear. A merge would
 * make removals silently impossible.
 */
export async function setRolePermissions(
  ctx: AccessContext,
  roleId: string,
  permissionKeys: readonly string[],
): Promise<RoleView> {
  ctx.requirePermission('role.update');

  const role = await loadRole(roleId);
  assertMutable(ctx, role);

  // An unknown key means the client is out of date or the request was hand
  // built; either way, silently dropping it would grant a different permission
  // set than the one the administrator confirmed.
  const unknown = permissionKeys.filter((key) => !isPermissionKey(key));
  if (unknown.length > 0) {
    throw new ValidationError('One or more permissions are not recognised.', {
      unknownPermissions: unknown,
    });
  }

  const wanted = [...new Set(permissionKeys as readonly PermissionKey[])];

  const permissions = await unsafeDb.permission.findMany({
    where: { key: { in: wanted } },
    select: { id: true, key: true },
  });

  if (permissions.length !== wanted.length) {
    throw new ValidationError(
      'One or more permissions are missing from the database. Re-run the seed.',
    );
  }

  const wantedIds = permissions.map((permission) => permission.id);
  const before = role.permissions.map((entry) => entry.permission.key).sort();

  await unsafeDb.$transaction([
    unsafeDb.rolePermission.deleteMany({
      where: { roleId, permissionId: { notIn: wantedIds } },
    }),
    unsafeDb.rolePermission.createMany({
      data: wantedIds.map((permissionId) => ({
        roleId,
        permissionId,
        createdById: ctx.userId,
      })),
      skipDuplicates: true,
    }),
  ]);

  const after = [...wanted].sort();
  const beforeSet = new Set<string>(before);
  const afterSet = new Set<string>(after);

  await recordAudit({
    action: 'role.permissions_changed',
    module: 'Role',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'Role',
    entityId: roleId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    before: { permissions: before },
    // The added/removed lists are recorded alongside the full sets: a reader
    // wants to know what changed, and diffing two 48-item arrays by eye is how
    // an audit trail stops being read.
    after: {
      permissions: after,
      added: after.filter((key) => !beforeSet.has(key)),
      removed: before.filter((key) => !afterSet.has(key)),
    },
  });

  return toView(ctx, await loadRole(roleId));
}

/** Renames a role. Refused for system roles; their identity is fixed. */
export async function updateRoleDetails(
  ctx: AccessContext,
  roleId: string,
  input: { name: string; description: string | null },
): Promise<RoleView> {
  ctx.requirePermission('role.update');

  const role = await loadRole(roleId);
  assertMutable(ctx, role);

  if (role.isSystem) {
    throw new ConflictError(
      'A system role cannot be renamed. Its permissions can still be changed.',
    );
  }

  const name = input.name.trim();
  if (name.length === 0) {
    throw new ValidationError('A role name is required.');
  }

  const description = input.description?.trim() || null;

  await unsafeDb.role.update({
    where: { id: roleId },
    data: { name, description, updatedById: ctx.userId },
    select: { id: true },
  });

  await recordAudit({
    action: 'role.updated',
    module: 'Role',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'Role',
    entityId: roleId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    before: { name: role.name, description: role.description },
    after: { name, description },
  });

  return toView(ctx, await loadRole(roleId));
}
