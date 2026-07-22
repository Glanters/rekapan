import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';

import { SettingsClient } from './settings-client';

export const metadata: Metadata = { title: 'Pengaturan' };

export default async function SettingsPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('setting.view');

  return <SettingsClient canEdit={access.can('setting.update')} />;
}
