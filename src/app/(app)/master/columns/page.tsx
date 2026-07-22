import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';

import { ColumnsClient } from './columns-client';

export const metadata: Metadata = { title: 'Kolom Monthly' };

export default async function ColumnsPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('column.view');

  return (
    <ColumnsClient
      canCreate={access.can('column.create')}
      canUpdate={access.can('column.update')}
      canDelete={access.can('column.delete')}
    />
  );
}
