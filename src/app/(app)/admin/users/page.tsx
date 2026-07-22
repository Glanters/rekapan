import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';
import { scopedDb } from '@/server/db/prisma';
import { scopedWhere } from '@/server/db/site-scope';

import { UsersClient } from './users-client';

export const metadata: Metadata = { title: 'Pengguna' };

export default async function UsersPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('user.view');

  // The sites offered for assignment are the caller's own, so the picker cannot
  // suggest a grant the server would refuse.
  const sites = await scopedDb(access).site.findMany({
    where: scopedWhere(access, 'Site', { deletedAt: null }),
    select: { id: true, code: true, name: true },
    orderBy: { name: 'asc' },
  });

  return (
    <UsersClient
      assignableSites={sites}
      canActivate={access.can('user.activate')}
      canSuspend={access.can('user.suspend')}
      canAssignSites={access.can('user.assign_site')}
      canChangeRole={access.can('user.update')}
      currentUserId={access.userId}
    />
  );
}
