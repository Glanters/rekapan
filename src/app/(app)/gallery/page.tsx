import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';
import { scopedDb } from '@/server/db/prisma';
import { scopedWhere } from '@/server/db/site-scope';

import { GalleryClient } from './gallery-client';

export const metadata: Metadata = { title: 'Gallery' };

export default async function GalleryPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('gallery.view');

  const sites = await scopedDb(access).site.findMany({
    where: scopedWhere(access, 'Site', { deletedAt: null, status: 'ACTIVE' }),
    select: { id: true, code: true, name: true },
    orderBy: { name: 'asc' },
  });

  return (
    <GalleryClient
      sites={sites}
      canUpload={access.can('gallery.upload')}
      canDelete={access.can('gallery.delete')}
      canDownload={access.can('gallery.download')}
      canBulkDownload={access.can('gallery.download.bulk')}
    />
  );
}
