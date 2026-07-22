import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';

import { FormRecapClient } from './form-recap-client';

export const metadata: Metadata = { title: 'Rekap Form' };

export default async function FormRecapPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('monthly.view');

  return <FormRecapClient />;
}
