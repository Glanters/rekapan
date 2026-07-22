import type { Prisma } from '@/generated/prisma/client';

import { unsafeDb } from '../db/prisma';
import { logger } from '../logger';

/**
 * Audit trail.
 *
 * Writes go through `unsafeDb` on purpose: the log records attempts, including
 * the ones that were refused for being out of scope, so passing it through the
 * site-scoping guard would drop exactly the entries worth keeping.
 */

export interface AuditEntry {
  action: string;
  module: string;
  actorId?: string | null;
  actorEmail?: string | null;
  siteId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** Field names stripped from `before`/`after` before persisting. */
const SENSITIVE_FIELDS = new Set([
  'password',
  'tokenHash',
  'accountCenterToken',
  'secret',
  'token',
]);

function sanitise(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (depth > 6) return '[truncated]';

  if (typeof value !== 'object') {
    return value as Prisma.InputJsonValue;
  }
  if (Array.isArray(value)) {
    return value.map(
      (item) => sanitise(item, depth + 1) ?? null,
    ) as Prisma.InputJsonValue;
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_FIELDS.has(key)) {
      output[key] = '[redacted]';
      continue;
    }
    // Dates and Decimals serialise to strings rather than empty objects.
    if (item instanceof Date) {
      output[key] = item.toISOString();
      continue;
    }
    const cleaned = sanitise(item, depth + 1);
    if (cleaned !== undefined) output[key] = cleaned;
  }
  return output as Prisma.InputJsonValue;
}

/**
 * Records an audited action.
 *
 * Never throws. An audit write that fails must not roll back the business
 * operation that succeeded — the failure is logged for follow-up instead, since
 * the alternative is a user-visible error for a bookkeeping problem.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await unsafeDb.auditLog.create({
      data: {
        action: entry.action,
        module: entry.module,
        actorId: entry.actorId ?? null,
        actorEmail: entry.actorEmail ?? null,
        siteId: entry.siteId ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        before: sanitise(entry.before),
        after: sanitise(entry.after),
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        requestId: entry.requestId ?? null,
      },
    });
  } catch (cause) {
    logger.error('Failed to write audit entry', {
      action: entry.action,
      module: entry.module,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
