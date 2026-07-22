import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';

import { SitesClient } from './sites-client';

export const metadata: Metadata = { title: 'Site' };

export default async function SitesPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('site.view');

  // The capability flags decide what the client renders; the API re-checks each
  // one on every request, so hiding a control here is convenience, not the
  // guard. See the note in `components/shell/nav.ts`.
  return (
    <SitesClient
      canCreate={access.can('site.create')}
      canUpdate={access.can('site.update')}
      canDelete={access.can('site.delete')}
    />
  );
}
