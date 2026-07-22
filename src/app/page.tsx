import { redirect } from 'next/navigation';

import { resolveSession } from '@/server/auth/session';

/**
 * Entry point. Sends the caller to the dashboard or the sign-in page.
 *
 * The check runs on the server so an unauthenticated visitor never receives the
 * application shell at all, rather than being bounced after it renders.
 */
export default async function RootPage() {
  const access = await resolveSession();
  redirect(access ? '/dashboard' : '/login');
}
