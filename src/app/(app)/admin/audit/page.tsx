import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auditModules } from '@/server/audit/service';
import { resolveSession } from '@/server/auth/session';

import { AuditClient } from './audit-client';

export const metadata: Metadata = { title: 'Audit Log' };

export default async function AuditPage() {
  const access = await resolveSession();
  if (!access) redirect('/login');
  access.requirePermission('audit.view');

  // The module list comes from the permission catalogue, not from a DISTINCT
  // over the table — on millions of rows that scan is the one query that would
  // undo the pagination discipline everywhere else on this page.
  return <AuditClient modules={auditModules()} />;
}
