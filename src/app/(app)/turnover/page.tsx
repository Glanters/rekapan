import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';
import { scopedDb } from '@/server/db/prisma';
import { scopedWhere } from '@/server/db/site-scope';

import { TurnoverTable } from './turnover-table';

export const metadata: Metadata = { title: 'Turnover' };

export default async function TurnoverPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('turnover.view');

  const sites = await scopedDb(access).site.findMany({
    where: scopedWhere(access, 'Site', { deletedAt: null, status: 'ACTIVE' }),
    select: { id: true, code: true, name: true },
    orderBy: { name: 'asc' },
  });

  return (
    <TurnoverTable
      sites={sites}
      canEdit={access.canAny('turnover.create', 'turnover.update')}
      canDelete={access.can('turnover.delete')}
      canImport={access.can('turnover.import')}
      canExport={access.can('turnover.export')}
    />
  );
}
