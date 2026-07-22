import {
  Building2,
  CalendarCheck,
  ClipboardList,
  Columns3,
  Gamepad2,
  Images,
  Landmark,
  LayoutDashboard,
  Network,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Table2,
  Users,
} from 'lucide-react';

import type { PermissionKey } from '@/server/auth/permissions';

/**
 * Navigation definition.
 *
 * Each entry declares the permission that reveals it. Hiding a link is a
 * usability measure, not a security one — the route guard and the API guard are
 * what actually enforce access. Both exist; this only avoids showing people
 * doors that will not open.
 */

export interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  permission: PermissionKey;
  /** Matches nested routes so a child page keeps its parent highlighted. */
  matchPrefix?: boolean;
}

export interface NavSection {
  label: string | null;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [
      {
        label: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
        permission: 'dashboard.view',
      },
      {
        label: 'Kelengkapan',
        href: '/completeness',
        icon: CalendarCheck,
        permission: 'dashboard.view',
        matchPrefix: true,
      },
    ],
  },
  {
    label: 'Laporan',
    items: [
      {
        label: 'Monthly',
        href: '/monthly',
        icon: Table2,
        permission: 'monthly.view',
        matchPrefix: true,
      },
      {
        label: 'Turnover',
        href: '/turnover',
        icon: ClipboardList,
        permission: 'turnover.view',
        matchPrefix: true,
      },
      {
        label: 'Rekap Form',
        href: '/form-recap',
        icon: Receipt,
        permission: 'monthly.view',
        matchPrefix: true,
      },
      {
        label: 'Gallery',
        href: '/gallery',
        icon: Images,
        permission: 'gallery.view',
        matchPrefix: true,
      },
    ],
  },
  {
    label: 'Master Data',
    items: [
      {
        label: 'Site',
        href: '/master/sites',
        icon: Building2,
        permission: 'site.view',
      },
      { label: 'Game', href: '/master/games', icon: Gamepad2, permission: 'game.view' },
      { label: 'Bank', href: '/master/banks', icon: Landmark, permission: 'bank.view' },
      {
        label: 'Kolom Monthly',
        href: '/master/columns',
        icon: Columns3,
        permission: 'column.view',
      },
    ],
  },
  {
    label: 'Administrasi',
    items: [
      { label: 'Pengguna', href: '/admin/users', icon: Users, permission: 'user.view' },
      {
        label: 'Role',
        href: '/admin/roles',
        icon: ShieldCheck,
        permission: 'role.view',
      },
      {
        label: 'Audit Log',
        href: '/admin/audit',
        icon: ScrollText,
        permission: 'audit.view',
      },
      {
        label: 'Pengaturan',
        href: '/admin/settings',
        icon: Settings,
        permission: 'setting.view',
      },
      {
        label: 'Pembatasan IP',
        href: '/admin/security',
        icon: Network,
        permission: 'setting.view',
      },
    ],
  },
];

/** Drops entries the caller cannot reach, then drops sections left empty. */
export function visibleSections(permissions: ReadonlySet<string>): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => permissions.has(item.permission)),
  })).filter((section) => section.items.length > 0);
}

export function isActive(pathname: string, item: NavItem): boolean {
  return item.matchPrefix ? pathname.startsWith(item.href) : pathname === item.href;
}
