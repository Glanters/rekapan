import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';

import { BanksClient } from './banks-client';

export const metadata: Metadata = { title: 'Bank' };

export default async function BanksPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('bank.view');

  return (
    <BanksClient
      canCreate={access.can('bank.create')}
      canUpdate={access.can('bank.update')}
      canDelete={access.can('bank.delete')}
    />
  );
}
