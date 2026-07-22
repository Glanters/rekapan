import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';

import { GamesClient } from './games-client';

export const metadata: Metadata = { title: 'Game' };

export default async function GamesPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('game.view');

  return (
    <GamesClient
      canCreate={access.can('game.create')}
      canUpdate={access.can('game.update')}
      canDelete={access.can('game.delete')}
    />
  );
}
