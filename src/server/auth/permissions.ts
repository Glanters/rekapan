/**
 * The permission catalogue — the single source of truth for RBAC.
 *
 * This array drives three things at once: the `PermissionKey` union the type
 * checker enforces at every guard, the rows the seed inserts into the
 * `permissions` table, and the grouping the role editor renders. Keeping them
 * derived from one declaration is what stops a permission from being checked in
 * code but missing from the database, which fails open in the worst way — the
 * guard silently passes because nobody holds a permission that does not exist.
 */

export interface PermissionDefinition {
  /** Dotted `module.action` key. Stable; never rename without a migration. */
  readonly key: string;
  /** Display grouping in the role editor. */
  readonly module: string;
  readonly action: string;
  readonly description: string;
}

export const PERMISSIONS = [
  // -- Dashboard -------------------------------------------------------------
  {
    key: 'dashboard.view',
    module: 'Dashboard',
    action: 'view',
    description: 'View the dashboard and its statistics',
  },
  {
    key: 'dashboard.export',
    module: 'Dashboard',
    action: 'export',
    description: 'Export dashboard data and charts',
  },

  // -- Monthly ---------------------------------------------------------------
  {
    key: 'monthly.view',
    module: 'Monthly',
    action: 'view',
    description: 'View Monthly reports',
  },
  {
    key: 'monthly.create',
    module: 'Monthly',
    action: 'create',
    description: 'Create Monthly report rows',
  },
  {
    key: 'monthly.update',
    module: 'Monthly',
    action: 'update',
    description: 'Edit Monthly report rows',
  },
  {
    key: 'monthly.delete',
    module: 'Monthly',
    action: 'delete',
    description: 'Delete Monthly report rows',
  },
  {
    key: 'monthly.approve',
    module: 'Monthly',
    action: 'approve',
    description: 'Approve and lock Monthly reports',
  },
  {
    key: 'monthly.import',
    module: 'Monthly',
    action: 'import',
    description: 'Import Monthly data from Excel',
  },
  {
    key: 'monthly.export',
    module: 'Monthly',
    action: 'export',
    description: 'Export Monthly data',
  },

  // -- Turnover --------------------------------------------------------------
  {
    key: 'turnover.view',
    module: 'Turnover',
    action: 'view',
    description: 'View Turnover reports',
  },
  {
    key: 'turnover.create',
    module: 'Turnover',
    action: 'create',
    description: 'Create Turnover report rows',
  },
  {
    key: 'turnover.update',
    module: 'Turnover',
    action: 'update',
    description: 'Edit Turnover report rows',
  },
  {
    key: 'turnover.delete',
    module: 'Turnover',
    action: 'delete',
    description: 'Delete Turnover report rows',
  },
  {
    key: 'turnover.approve',
    module: 'Turnover',
    action: 'approve',
    description: 'Approve and lock Turnover reports',
  },
  {
    key: 'turnover.import',
    module: 'Turnover',
    action: 'import',
    description: 'Import Turnover data from Excel',
  },
  {
    key: 'turnover.export',
    module: 'Turnover',
    action: 'export',
    description: 'Export Turnover data',
  },

  // -- Gallery ---------------------------------------------------------------
  {
    key: 'gallery.view',
    module: 'Gallery',
    action: 'view',
    description: 'View the image gallery',
  },
  {
    key: 'gallery.upload',
    module: 'Gallery',
    action: 'upload',
    description: 'Upload images',
  },
  {
    key: 'gallery.delete',
    module: 'Gallery',
    action: 'delete',
    description: 'Delete images',
  },
  {
    key: 'gallery.download',
    module: 'Gallery',
    action: 'download',
    description: 'Download individual images',
  },
  {
    key: 'gallery.download.bulk',
    module: 'Gallery',
    action: 'download.bulk',
    description: 'Download images in bulk as a ZIP archive',
  },
  {
    key: 'gallery.download.all',
    module: 'Gallery',
    action: 'download.all',
    description: 'Download every image across every site',
  },

  // -- Master data -----------------------------------------------------------
  { key: 'site.view', module: 'Site', action: 'view', description: 'View sites' },
  { key: 'site.create', module: 'Site', action: 'create', description: 'Create sites' },
  { key: 'site.update', module: 'Site', action: 'update', description: 'Edit sites' },
  { key: 'site.delete', module: 'Site', action: 'delete', description: 'Delete sites' },

  {
    key: 'game.view',
    module: 'Game',
    action: 'view',
    description: 'View Turnover games',
  },
  {
    key: 'game.create',
    module: 'Game',
    action: 'create',
    description: 'Create Turnover games, which adds a table column',
  },
  {
    key: 'game.update',
    module: 'Game',
    action: 'update',
    description: 'Edit Turnover games',
  },
  {
    key: 'game.delete',
    module: 'Game',
    action: 'delete',
    description: 'Delete Turnover games',
  },

  { key: 'bank.view', module: 'Bank', action: 'view', description: 'View banks' },
  {
    key: 'bank.create',
    module: 'Bank',
    action: 'create',
    description: 'Create banks, which adds a validation breakdown column',
  },
  { key: 'bank.update', module: 'Bank', action: 'update', description: 'Edit banks' },
  { key: 'bank.delete', module: 'Bank', action: 'delete', description: 'Delete banks' },

  {
    key: 'column.view',
    module: 'Column',
    action: 'view',
    description: 'View Monthly column definitions',
  },
  {
    key: 'column.create',
    module: 'Column',
    action: 'create',
    description: 'Create Monthly columns, which adds a table column',
  },
  {
    key: 'column.update',
    module: 'Column',
    action: 'update',
    description: 'Edit Monthly column definitions',
  },
  {
    key: 'column.delete',
    module: 'Column',
    action: 'delete',
    description: 'Delete Monthly columns',
  },

  // -- User & access management ---------------------------------------------
  { key: 'user.view', module: 'User', action: 'view', description: 'View users' },
  {
    key: 'user.activate',
    module: 'User',
    action: 'activate',
    description: 'Approve pending users and grant them access',
  },
  { key: 'user.update', module: 'User', action: 'update', description: 'Edit users' },
  {
    key: 'user.suspend',
    module: 'User',
    action: 'suspend',
    description: 'Suspend or reinstate users',
  },
  { key: 'user.delete', module: 'User', action: 'delete', description: 'Delete users' },
  {
    key: 'user.assign_site',
    module: 'User',
    action: 'assign_site',
    description: 'Assign or revoke a user’s site access',
  },

  { key: 'role.view', module: 'Role', action: 'view', description: 'View roles' },
  { key: 'role.create', module: 'Role', action: 'create', description: 'Create roles' },
  {
    key: 'role.update',
    module: 'Role',
    action: 'update',
    description: 'Edit roles and their permissions',
  },
  { key: 'role.delete', module: 'Role', action: 'delete', description: 'Delete roles' },

  // -- Operations ------------------------------------------------------------
  {
    key: 'audit.view',
    module: 'Audit',
    action: 'view',
    description: 'View the audit log',
  },
  {
    key: 'audit.export',
    module: 'Audit',
    action: 'export',
    description: 'Export the audit log',
  },

  {
    key: 'setting.view',
    module: 'Setting',
    action: 'view',
    description: 'View application settings',
  },
  {
    key: 'setting.update',
    module: 'Setting',
    action: 'update',
    description: 'Change application settings',
  },
] as const satisfies readonly PermissionDefinition[];

/**
 * Compile-time union of every valid permission. Guards accept only this type,
 * so a typo becomes a build error rather than a check that never fires.
 */
export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set<string>(PERMISSION_KEYS);

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEY_SET.has(value);
}

/** Permissions grouped by module, for rendering the role editor. */
export function permissionsByModule(): ReadonlyMap<
  string,
  readonly PermissionDefinition[]
> {
  const grouped = new Map<string, PermissionDefinition[]>();
  for (const permission of PERMISSIONS) {
    const bucket = grouped.get(permission.module);
    if (bucket) bucket.push(permission);
    else grouped.set(permission.module, [permission]);
  }
  return grouped;
}

// ============================================================================
// ROLE PRESETS
// ============================================================================

export const ROLE_KEYS = [
  'ROOT',
  'SUPER_ADMIN',
  'MANAGER',
  'SUPERVISOR',
  'OPERATOR',
  'VIEWER',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RoleDefinition {
  readonly key: RoleKey;
  readonly name: string;
  readonly description: string;
  /** Lower is more authoritative; a user may never grant a role at or above their own level. */
  readonly level: number;
  /** `'*'` means every permission, including ones added in future releases. */
  readonly permissions: readonly PermissionKey[] | '*';
}

/**
 * Seed values only. Administrators can re-assign permissions afterwards through
 * the role editor; these are the starting points, not a hard-coded policy.
 *
 * Only ROOT is `'*'`. SUPER_ADMIN is enumerated deliberately: if it inherited
 * every future permission automatically, adding a sensitive capability would
 * silently widen an existing role rather than requiring a decision.
 */
export const ROLE_PRESETS: readonly RoleDefinition[] = [
  {
    key: 'ROOT',
    name: 'Root',
    description:
      'Unrestricted. The only role that sees every site regardless of assignment.',
    level: 0,
    permissions: '*',
  },
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Full administration of the sites they are assigned to.',
    level: 10,
    permissions: [
      'dashboard.view',
      'dashboard.export',
      'monthly.view',
      'monthly.create',
      'monthly.update',
      'monthly.delete',
      'monthly.approve',
      'monthly.import',
      'monthly.export',
      'turnover.view',
      'turnover.create',
      'turnover.update',
      'turnover.delete',
      'turnover.approve',
      'turnover.import',
      'turnover.export',
      'gallery.view',
      'gallery.upload',
      'gallery.delete',
      'gallery.download',
      'gallery.download.bulk',
      'site.view',
      'site.create',
      'site.update',
      'game.view',
      'game.create',
      'game.update',
      'game.delete',
      'bank.view',
      'bank.create',
      'bank.update',
      'bank.delete',
      'column.view',
      'column.create',
      'column.update',
      'column.delete',
      'user.view',
      'user.activate',
      'user.update',
      'user.suspend',
      'user.assign_site',
      'role.view',
      'role.update',
      'audit.view',
      'audit.export',
      'setting.view',
      'setting.update',
    ],
  },
  {
    key: 'MANAGER',
    name: 'Manager',
    description: 'Approves reports and manages operators within their sites.',
    level: 20,
    permissions: [
      'dashboard.view',
      'dashboard.export',
      'monthly.view',
      'monthly.create',
      'monthly.update',
      'monthly.approve',
      'monthly.import',
      'monthly.export',
      'turnover.view',
      'turnover.create',
      'turnover.update',
      'turnover.approve',
      'turnover.import',
      'turnover.export',
      'gallery.view',
      'gallery.upload',
      'gallery.delete',
      'gallery.download',
      'gallery.download.bulk',
      'site.view',
      'game.view',
      'bank.view',
      'column.view',
      'user.view',
      'user.assign_site',
      'audit.view',
    ],
  },
  {
    key: 'SUPERVISOR',
    name: 'Supervisor',
    description: 'Reviews and corrects data entered by operators.',
    level: 30,
    permissions: [
      'dashboard.view',
      'monthly.view',
      'monthly.create',
      'monthly.update',
      'monthly.export',
      'turnover.view',
      'turnover.create',
      'turnover.update',
      'turnover.export',
      'gallery.view',
      'gallery.upload',
      'gallery.download',
      'gallery.download.bulk',
      'site.view',
      'game.view',
      'bank.view',
      'column.view',
      'user.view',
    ],
  },
  {
    key: 'OPERATOR',
    name: 'Operator',
    description: 'Enters daily data and uploads images. Cannot delete or approve.',
    level: 40,
    permissions: [
      'dashboard.view',
      'monthly.view',
      'monthly.create',
      'monthly.update',
      'turnover.view',
      'turnover.create',
      'turnover.update',
      'gallery.view',
      'gallery.upload',
      'gallery.download',
      'site.view',
      'game.view',
      'bank.view',
      'column.view',
    ],
  },
  {
    key: 'VIEWER',
    name: 'Viewer',
    description: 'Read-only access to their assigned sites.',
    level: 50,
    permissions: [
      'dashboard.view',
      'monthly.view',
      'monthly.export',
      'turnover.view',
      'turnover.export',
      'gallery.view',
      'gallery.download',
      'site.view',
    ],
  },
];

export function resolveRolePermissions(role: RoleDefinition): readonly PermissionKey[] {
  return role.permissions === '*' ? PERMISSION_KEYS : role.permissions;
}
