import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';

import { RolesClient } from './roles-client';

export const metadata: Metadata = { title: 'Role' };

export default async function RolesPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('role.view');

  // `canEdit` only decides what the interface offers. Whether a specific role
  // may actually be changed is decided per role by the server, which also
  // re-checks it on every write — the flag is a courtesy, not a control.
  return <RolesClient canEdit={access.can('role.update')} />;
}
