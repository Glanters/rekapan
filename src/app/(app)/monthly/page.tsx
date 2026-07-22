import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';
import { scopedDb } from '@/server/db/prisma';
import { scopedWhere } from '@/server/db/site-scope';

import { MonthlyTable } from './monthly-table';

export const metadata: Metadata = { title: 'Monthly' };

export default async function MonthlyPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('monthly.view');

  const sites = await scopedDb(access).site.findMany({
    where: scopedWhere(access, 'Site', { deletedAt: null, status: 'ACTIVE' }),
    select: { id: true, code: true, name: true },
    orderBy: { name: 'asc' },
  });

  return (
    <MonthlyTable
      sites={sites}
      canEdit={access.canAny('monthly.create', 'monthly.update')}
      canDelete={access.can('monthly.delete')}
      canImport={access.can('monthly.import')}
      canExport={access.can('monthly.export')}
    />
  );
}
