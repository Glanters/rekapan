import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';

import type { AccessContext } from '../auth/access-context';
import { AppError } from '../errors';
import { env, isDevelopment, isProduction } from '@/lib/env';
import {
  BLOCKED_OPERATIONS,
  DATA_GUARDED_OPERATIONS,
  WHERE_GUARDED_OPERATIONS,
  hasSiteConstraint,
  isScopedModel,
  scopeRuleFor,
} from './site-scope';

/**
 * Database access.
 *
 * Two clients are exported and the difference matters:
 *
 *   - {@link scopedDb} wraps every query in the site-scoping tripwire. Request
 *     handling uses this, always.
 *   - {@link unsafeDb} is the raw client with no guard. It exists for the few
 *     operations that legitimately run outside any user's scope — seeding,
 *     login before a context exists, background jobs, migrations — and is named
 *     to make its appearance in a diff conspicuous.
 */

/**
 * Raised when a query reaches a site-owned table without a site constraint.
 *
 * This is a programming error, not a user-facing condition: it means a code
 * path would have leaked another site's data had it run. It is not operational,
 * so it alerts rather than being swallowed as routine noise.
 */
export class UnscopedQueryError extends AppError {
  constructor(message: string) {
    super({
      message,
      statusCode: 500,
      code: 'INTERNAL',
      isOperational: false,
    });
  }
}

function createBaseClient(): PrismaClient {
  // Prisma 7 dropped the bundled query engine in favour of driver adapters, so
  // the connection pool is now node-postgres and tunable directly.
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    // Sized for the app's own concurrency, not the database's ceiling: several
    // instances share one Postgres, and each holding a large idle pool is how
    // "too many connections" happens under load.
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log: isDevelopment
      ? [
          { emit: 'stdout', level: 'warn' },
          { emit: 'stdout', level: 'error' },
        ]
      : [{ emit: 'stdout', level: 'error' }],
  });
}

/**
 * Next.js dev server reloads modules on every edit; without this the process
 * accumulates a connection pool per reload until Postgres refuses new clients.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const unsafeDb: PrismaClient = globalForPrisma.prisma ?? createBaseClient();

if (!isProduction) {
  globalForPrisma.prisma = unsafeDb;
}

/**
 * Verifies a single operation against the caller's site scope.
 *
 * COVERAGE — stated plainly, because an overstated guarantee is worse than a
 * documented gap:
 *
 *   Covered: reads, updates, and deletes on site-owned models, which must carry
 *   a top-level AND-ed site constraint; and creates on models holding `siteId`
 *   directly, whose value must fall inside the caller's scope.
 *
 *   NOT covered: creates on `MonthlyValue` and `TurnoverValue`, which reference
 *   their site only through `reportId`. Verifying those would require an extra
 *   query per write. Instead the rule is that services load the parent report
 *   through this client first — that read is scope-checked, so a caller who
 *   cannot see the report cannot obtain an id to attach values to.
 */
function enforceSiteScope(
  ctx: AccessContext,
  model: string,
  operation: string,
  args: Record<string, unknown> | undefined,
): void {
  if (!isScopedModel(model)) return;

  // Root is the sole principal permitted to read across every site.
  if (ctx.isRoot) return;

  if (BLOCKED_OPERATIONS.has(operation)) {
    throw new UnscopedQueryError(
      `${model}.${operation}() is not permitted on a site-scoped model: a ` +
        'unique selector cannot carry a site constraint, so the row would be ' +
        'fetched before it could be checked. Use findFirst() with ' +
        'scopedWhere(ctx, model, where) instead.',
    );
  }

  if (WHERE_GUARDED_OPERATIONS.has(operation)) {
    if (!hasSiteConstraint(model, args?.['where'])) {
      throw new UnscopedQueryError(
        `${model}.${operation}() ran without a site constraint and would have ` +
          'returned rows from sites this user cannot access. Build the filter ' +
          'with scopedWhere(ctx, model, where). Note that a site constraint ' +
          'inside an OR branch does not count — a union widens the result set ' +
          'rather than restricting it.',
      );
    }
    return;
  }

  if (DATA_GUARDED_OPERATIONS.has(operation)) {
    enforceWriteScope(ctx, model, operation, args);
  }
}

function enforceWriteScope(
  ctx: AccessContext,
  model: string,
  operation: string,
  args: Record<string, unknown> | undefined,
): void {
  const rule = scopeRuleFor(model as Parameters<typeof scopeRuleFor>[0]);

  // Relation-scoped values are guarded by their parent report; see the note on
  // enforceSiteScope.
  if (rule.kind === 'relation') return;

  const field = rule.kind === 'ownId' ? 'id' : 'siteId';
  const payloads = collectWritePayloads(args, operation);

  for (const payload of payloads) {
    const siteId = payload[field];

    if (typeof siteId !== 'string') {
      throw new UnscopedQueryError(
        `${model}.${operation}() supplied no ${field}, so the row's site ` +
          'cannot be verified against the caller’s scope.',
      );
    }

    if (!ctx.hasSite(siteId)) {
      throw new UnscopedQueryError(
        `${model}.${operation}() targets a site outside the caller’s scope.`,
      );
    }
  }
}

function collectWritePayloads(
  args: Record<string, unknown> | undefined,
  operation: string,
): Record<string, unknown>[] {
  if (!args) return [];

  if (operation === 'upsert') {
    const create = args['create'];
    return create && typeof create === 'object'
      ? [create as Record<string, unknown>]
      : [];
  }

  const data = args['data'];
  if (!data) return [];

  // createMany takes an array; create takes a single object.
  return (Array.isArray(data) ? data : [data]).filter(
    (entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === 'object',
  );
}

/**
 * Builds a request-scoped client bound to one caller.
 *
 * `$extends` returns a wrapper over the same engine and connection pool, so
 * creating one per request is cheap — no new connections are opened.
 */
export function scopedDb(ctx: AccessContext) {
  return unsafeDb.$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          enforceSiteScope(ctx, model, operation, args as Record<string, unknown>);
          return query(args);
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof scopedDb>;
