import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';
import { scopedDb } from '@/server/db/prisma';
import { scopedWhere } from '@/server/db/site-scope';

import { DashboardClient } from './dashboard-client';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * Dashboard shell.
 *
 * Only the things the page needs before its first paint are resolved here: who
 * the caller is, and which sites their filter may offer. The figures themselves
 * arrive from `/api/dashboard`, because they change with every filter change
 * and rendering the first period on the server would mean a full navigation to
 * see the second.
 *
 * The site list is scoped like every other read — `scopedWhere` is what keeps
 * the picker from advertising sites the caller cannot open.
 */
export default async function DashboardPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('dashboard.view');

  const sites = await scopedDb(access).site.findMany({
    where: scopedWhere(access, 'Site', { deletedAt: null, status: 'ACTIVE' }),
    select: { id: true, code: true, name: true },
    orderBy: { name: 'asc' },
  });

  return (
    <DashboardClient
      sites={sites}
      firstName={access.name.split(' ')[0] ?? access.name}
      // Root reaches every site, so an empty list there means no site exists
      // yet — an administrative gap, not a permission one.
      hasNoSites={!access.isRoot && sites.length === 0}
    />
  );
}
