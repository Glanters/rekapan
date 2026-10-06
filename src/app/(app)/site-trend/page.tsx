import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';

import { SiteTrendClient } from './site-trend-client';

export const metadata: Metadata = { title: 'Naik Turun Site' };

export default async function SiteTrendPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('dashboard.view');

  return <SiteTrendClient />;
}
