import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';
import { clientIp } from '@/server/http/rate-limit';

import { SecurityClient } from './security-client';

export const metadata: Metadata = { title: 'Pembatasan IP' };

export default async function SecurityPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('setting.view');

  // Passed to the client so it can show the operator their own address and
  // offer to add it — the surest way to avoid locking themselves out.
  const currentIp = clientIp(await headers());

  return (
    <SecurityClient canEdit={access.can('setting.update')} currentIp={currentIp} />
  );
}
