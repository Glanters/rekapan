import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';
import { scopedDb } from '@/server/db/prisma';
import { scopedWhere } from '@/server/db/site-scope';

import { CompletenessClient } from './completeness-client';

export const metadata: Metadata = { title: 'Kelengkapan' };

export default async function CompletenessPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('dashboard.view');

  const sites = await scopedDb(access).site.findMany({
    where: scopedWhere(access, 'Site', { deletedAt: null, status: 'ACTIVE' }),
    select: { id: true, code: true, name: true },
    orderBy: { name: 'asc' },
  });

  return <CompletenessClient sites={sites} />;
}
