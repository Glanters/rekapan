import { randomUUID } from 'node:crypto';

import type { Prisma } from '@/generated/prisma/client';

import type { AccessContext } from '../auth/access-context';
import { recordAudit } from '../audit/record';
import { unsafeDb } from '../db/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { isIpAllowed, normaliseCidr } from './ip-match';

export { isIpAllowed } from './ip-match';

/**
 * Global IP allowlist.
 *
 * A whitelist enforced on authenticated access: while it holds at least one
 * rule, only callers whose address matches a rule may use the application; an
 * empty list disables the feature and lets everyone through. Enforcement lives
 * in the route handler and the app layout; the matching lives in `ip-match`.
 * This module owns the rules and their lifecycle.
 *
 * STORAGE. The rules are a single JSON row in `Setting` (key below, global
 * scope) rather than their own table, so the feature ships without a schema
 * migration. The list is small and read on every authenticated request, so it
 * is cached in memory for a few seconds and the cache is dropped on every write.
 *
 * ACCESS. `unsafeDb` throughout: `Setting` is not a site-scoped model, and this
 * global row is gated by the `setting.*` permissions at the service boundary.
 */

const SETTING_KEY = 'security.ip_allowlist';
const CACHE_TTL_MS = 10_000;

export interface IpRule {
  id: string;
  /** A single address (matched as a full-length prefix) or a CIDR block. */
  cidr: string;
  label: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** Email of whoever added the rule; null if unknown. */
  createdBy: string | null;
}

let cache: { rules: IpRule[]; at: number } | null = null;

/** Defensively reads the stored array back into typed rules. */
function parseStoredRules(value: unknown): IpRule[] {
  if (!Array.isArray(value)) return [];

  const rules: IpRule[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.cidr !== 'string') continue;

    rules.push({
      id: record.id,
      cidr: record.cidr,
      label: typeof record.label === 'string' ? record.label : null,
      createdAt:
        typeof record.createdAt === 'string'
          ? record.createdAt
          : new Date(0).toISOString(),
      createdBy: typeof record.createdBy === 'string' ? record.createdBy : null,
    });
  }
  return rules;
}

async function readRulesFresh(): Promise<IpRule[]> {
  const row = await unsafeDb.setting.findFirst({
    where: { siteId: null, key: SETTING_KEY },
    select: { value: true },
  });
  return parseStoredRules(row?.value);
}

/**
 * The current rules, cached briefly.
 *
 * Called on every authenticated request through the enforcement path, so it
 * must not be a database round-trip each time. The cache is dropped the moment
 * a write happens, so the editor who just changed the list sees it immediately
 * and everyone else within {@link CACHE_TTL_MS}.
 */
export async function getIpRules(): Promise<IpRule[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rules;
  const rules = await readRulesFresh();
  cache = { rules, at: Date.now() };
  return rules;
}

export async function listIpRules(ctx: AccessContext): Promise<IpRule[]> {
  ctx.requirePermission('setting.view');
  return getIpRules();
}

/**
 * Refuses a change that would lock the editor out.
 *
 * A non-empty list that does not cover the editor's own current address would
 * deny their very next request — and, if they are the only administrator, leave
 * nobody able to undo it from inside the application. Clearing the list to empty
 * is always allowed: that disables the feature rather than enabling a bad one.
 */
function assertNotLockingOut(ip: string | undefined, next: readonly IpRule[]): void {
  if (next.length === 0) return;
  if (isIpAllowed(ip, next)) return;

  throw new ValidationError(
    `Perubahan ini akan mengunci Anda dari aplikasi: alamat IP Anda saat ini ` +
      `(${ip ?? 'tidak diketahui'}) tidak tercakup dalam daftar. Tambahkan dahulu ` +
      `IP atau rentang yang mencakupnya.`,
  );
}

async function persist(
  ctx: AccessContext,
  action: 'ipAllowlist.added' | 'ipAllowlist.removed',
  before: readonly IpRule[],
  after: readonly IpRule[],
): Promise<void> {
  const value = after as unknown as Prisma.InputJsonValue;

  // Find-then-write rather than upsert: the unique index is (key, siteId), and a
  // null siteId cannot be expressed in Prisma's compound unique input — the same
  // constraint the general settings writer works around.
  await unsafeDb.$transaction(async (tx) => {
    const existing = await tx.setting.findFirst({
      where: { siteId: null, key: SETTING_KEY },
      select: { id: true },
    });

    if (existing) {
      await tx.setting.update({
        where: { id: existing.id },
        data: { value, updatedById: ctx.userId },
      });
    } else {
      await tx.setting.create({
        data: {
          key: SETTING_KEY,
          value,
          siteId: null,
          description: 'Global IP allowlist',
          updatedById: ctx.userId,
        },
      });
    }
  });

  cache = null;

  await recordAudit({
    action,
    module: 'Setting',
    actorId: ctx.userId,
    actorEmail: ctx.email,
    entityType: 'Setting',
    entityId: null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    before: { rules: before },
    after: { rules: after },
  });
}

export async function addIpRule(
  ctx: AccessContext,
  input: { cidr: string; label?: string | undefined },
): Promise<IpRule[]> {
  ctx.requirePermission('setting.update');

  const cidr = normaliseCidr(input.cidr);
  if (cidr === null) {
    throw new ValidationError(`"${input.cidr}" bukan alamat IP atau CIDR yang valid.`);
  }
  const label = input.label?.trim() || null;

  const current = await readRulesFresh();
  if (current.some((rule) => rule.cidr === cidr)) {
    throw new ConflictError(`"${cidr}" sudah ada di daftar.`);
  }

  const rule: IpRule = {
    id: randomUUID(),
    cidr,
    label,
    createdAt: new Date().toISOString(),
    createdBy: ctx.email ?? null,
  };
  const next = [...current, rule];

  assertNotLockingOut(ctx.ip, next);
  await persist(ctx, 'ipAllowlist.added', current, next);

  return next;
}

export async function removeIpRule(ctx: AccessContext, id: string): Promise<IpRule[]> {
  ctx.requirePermission('setting.update');

  const current = await readRulesFresh();
  if (!current.some((rule) => rule.id === id)) {
    throw new NotFoundError('Aturan tidak ditemukan.');
  }

  const next = current.filter((rule) => rule.id !== id);

  assertNotLockingOut(ctx.ip, next);
  await persist(ctx, 'ipAllowlist.removed', current, next);

  return next;
}
