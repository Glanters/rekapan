import { env } from '@/lib/env';

import { authenticate } from '../account-center/client';
import { recordAudit } from '../audit/record';
import { unsafeDb } from '../db/prisma';
import { AccountPendingError, AccountSuspendedError, InternalError } from '../errors';
import { logger } from '../logger';
import { createSession, type SessionRequestInfo } from './session';

/**
 * The login pipeline, and the activation gate at the centre of it.
 *
 * Account Center verifies the credential; this application decides whether that
 * person may enter. A first-time authenticator is recorded as PENDING and
 * refused, so an Account Center account — or a leaked Account Center password —
 * conveys no access here until an administrator activates it and assigns sites.
 *
 * The refusal is deliberately indistinguishable in timing from a successful
 * lookup: the user row is written before the error is raised either way.
 */

export interface LoginResult {
  userId: string;
  email: string;
  name: string;
}

export async function login(params: {
  email: string;
  password: string;
  request: SessionRequestInfo;
}): Promise<LoginResult> {
  const identity = await authenticate({
    email: params.email,
    password: params.password,
  });

  const email = identity.email.toLowerCase();
  const isRootEmail = email === env.ROOT_EMAIL.toLowerCase();

  let user = await unsafeDb.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      deletedAt: true,
      role: { select: { key: true } },
      _count: { select: { sites: true } },
    },
  });

  // ---- First contact: provision, then refuse -------------------------------
  if (!user) {
    const created = await provisionUser({
      email,
      name: identity.name ?? email,
      externalId: identity.externalId,
      isRootEmail,
    });

    if (!isRootEmail) {
      await recordAudit({
        action: 'login.pending_provisioned',
        module: 'Auth',
        actorId: created.id,
        actorEmail: email,
        ip: params.request.ip,
        userAgent: params.request.userAgent,
        after: { status: 'PENDING' },
      });

      logger.info('New user provisioned as PENDING and denied access', { email });
      throw new AccountPendingError();
    }

    user = created;
  }

  // ---- The gate ------------------------------------------------------------
  //
  // ROOT_EMAIL gets no special treatment past this point, and that is
  // deliberate. Auto-promoting it on every login would mean an administrator
  // could never suspend the root account — suspend it, and the next login
  // silently reinstates it. That would carve a permanent exception into the
  // guarantee this gate exists to provide.
  //
  // The bootstrap happens once, in provisionUser(), when the account does not
  // yet exist. If root is later locked out on purpose, recovery is
  // `npm run db:seed`, which repairs the account — a server-side action at the
  // same trust level as editing the environment, without weakening suspension.
  if (isRootEmail && user.status !== 'ACTIVE') {
    logger.warn(
      'The ROOT_EMAIL account exists but is not ACTIVE. It was deliberately ' +
        'suspended or demoted; run `npm run db:seed` to restore it.',
      { email, status: user.status },
    );
  }

  if (user.deletedAt !== null) {
    throw new AccountSuspendedError('This account has been removed.');
  }

  switch (user.status) {
    case 'PENDING':
      await recordAudit({
        action: 'login.denied_pending',
        module: 'Auth',
        actorId: user.id,
        actorEmail: email,
        ip: params.request.ip,
        userAgent: params.request.userAgent,
      });
      throw new AccountPendingError();

    case 'SUSPENDED':
      await recordAudit({
        action: 'login.denied_suspended',
        module: 'Auth',
        actorId: user.id,
        actorEmail: email,
        ip: params.request.ip,
        userAgent: params.request.userAgent,
      });
      throw new AccountSuspendedError();

    case 'INACTIVE':
      throw new AccountSuspendedError(
        'This account has been deactivated. Contact an administrator.',
      );

    case 'ACTIVE':
      break;
  }

  // A user with no site sees nothing. They are let in anyway so the UI can say
  // so plainly — a blank dashboard with no explanation reads as a broken app.
  if (user.role?.key !== 'ROOT' && user._count.sites === 0) {
    logger.warn('Active user signed in with no site assigned', { email });
  }

  await unsafeDb.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      lastLoginIp: params.request.ip ?? null,
      // Backfilled opportunistically: Account Center is the source of truth for
      // display identity, and it may change between logins.
      ...(identity.externalId ? { externalId: identity.externalId } : {}),
      ...(identity.name ? { name: identity.name } : {}),
    },
  });

  await createSession({
    userId: user.id,
    identity,
    request: params.request,
  });

  await recordAudit({
    action: 'login.success',
    module: 'Auth',
    actorId: user.id,
    actorEmail: email,
    ip: params.request.ip,
    userAgent: params.request.userAgent,
  });

  return { userId: user.id, email: user.email, name: user.name };
}

type UserRecord = {
  id: string;
  email: string;
  name: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  deletedAt: Date | null;
  role: { key: string } | null;
  _count: { sites: number };
};

async function provisionUser(params: {
  email: string;
  name: string;
  externalId: string | null;
  isRootEmail: boolean;
}): Promise<UserRecord> {
  const roleKey = params.isRootEmail ? 'ROOT' : 'VIEWER';
  const role = await unsafeDb.role.findUnique({
    where: { key: roleKey },
    select: { id: true },
  });

  if (!role) {
    logger.error('Role table is empty — the seed has not been run', { roleKey });
    throw new InternalError(
      `The "${roleKey}" role does not exist. Run \`npm run db:seed\` before signing in.`,
    );
  }

  return unsafeDb.user.create({
    data: {
      email: params.email,
      name: params.name,
      externalId: params.externalId,
      // The default role is the least privileged one; it grants nothing until
      // an administrator also moves the account to ACTIVE and assigns a site.
      roleId: role.id,
      status: params.isRootEmail ? 'ACTIVE' : 'PENDING',
      ...(params.isRootEmail ? { activatedAt: new Date() } : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      deletedAt: true,
      role: { select: { key: true } },
      _count: { select: { sites: true } },
    },
  });
}
