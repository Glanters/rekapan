import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/shell/app-shell';
import { resolveSession } from '@/server/auth/session';
import { scopedDb } from '@/server/db/prisma';
import { scopedWhere } from '@/server/db/site-scope';
import { clientIp } from '@/server/http/rate-limit';
import { getIpRules, isIpAllowed } from '@/server/security/ip-allowlist';

import { IpBlockedNotice } from './ip-blocked-notice';

/**
 * Guards every page beneath it.
 *
 * The check is here rather than in middleware because resolving a session hits
 * the database, and Next.js middleware runs on the edge runtime where the
 * Postgres driver cannot. Doing it in the layout means the check runs on the
 * server before any child renders, so no protected markup is ever produced for
 * an unauthenticated visitor.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await resolveSession();
  if (!access) redirect('/login');

  // The global IP allowlist gates authenticated access. Enforced here so a
  // blocked visitor sees a clear notice rather than an app shell whose every
  // data call fails; the API applies the same rule as the real boundary.
  const ip = clientIp(await headers());
  if (!isIpAllowed(ip, await getIpRules())) {
    return <IpBlockedNotice ip={ip} />;
  }

  const sites = await scopedDb(access).site.findMany({
    where: scopedWhere(access, 'Site', { deletedAt: null, status: 'ACTIVE' }),
    select: { id: true, code: true, name: true },
    orderBy: { name: 'asc' },
  });

  return (
    <AppShell
      user={{
        id: access.userId,
        email: access.email,
        name: access.name,
        role: access.roleKey,
        isRoot: access.isRoot,
      }}
      permissions={[...access.permissions]}
      sites={sites}
    >
      {children}
    </AppShell>
  );
}
