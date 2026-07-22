import type { AccessContext } from '../auth/access-context';

/**
 * Site-scoping rules — the mechanism behind the system's hardest requirement:
 * a user must never see data belonging to a site they are not assigned to.
 *
 * The strategy is explicit filters plus a tripwire, rather than silent
 * injection. Auto-rewriting queries looks safer but hides mistakes: when the
 * rewrite fails to match a query shape it did not anticipate, the query runs
 * unscoped and nothing complains. A tripwire that refuses the query converts
 * that same mistake into a loud, immediate failure.
 */

export type ScopeRule =
  /** The row carries the site directly. */
  | { readonly kind: 'direct'; readonly field: 'siteId' }
  /** The row IS a site, so the constraint applies to its own primary key. */
  | { readonly kind: 'ownId'; readonly field: 'id' }
  /** The row inherits its site through a parent relation. */
  | { readonly kind: 'relation'; readonly relation: string; readonly field: 'siteId' };

/**
 * Every model that carries site-owned data.
 *
 * Adding a site-owned model without registering it here leaves it unscoped, so
 * the registry is asserted against the Prisma schema in `site-scope.test.ts`.
 */
export const SITE_SCOPED_MODELS = {
  Site: { kind: 'ownId', field: 'id' },
  MonthlyReport: { kind: 'direct', field: 'siteId' },
  TurnoverReport: { kind: 'direct', field: 'siteId' },
  ImageAsset: { kind: 'direct', field: 'siteId' },
  MonthlyValue: { kind: 'relation', relation: 'report', field: 'siteId' },
  TurnoverValue: { kind: 'relation', relation: 'report', field: 'siteId' },
} as const satisfies Record<string, ScopeRule>;

export type ScopedModelName = keyof typeof SITE_SCOPED_MODELS;

export function isScopedModel(model: string): model is ScopedModelName {
  return Object.hasOwn(SITE_SCOPED_MODELS, model);
}

export function scopeRuleFor(model: ScopedModelName): ScopeRule {
  return SITE_SCOPED_MODELS[model];
}

/**
 * Builds the `where` fragment restricting a model to the caller's sites.
 *
 * @returns `null` when no constraint is needed — Root only. A `limited` scope
 *   with no sites yields `{ in: [] }`, which matches nothing; failing closed is
 *   the correct direction.
 */
export function buildSiteFilter(
  ctx: AccessContext,
  model: ScopedModelName,
): Record<string, unknown> | null {
  if (ctx.siteScope.kind === 'all') return null;

  const siteIds = [...ctx.siteScope.siteIds];
  const rule = scopeRuleFor(model);

  switch (rule.kind) {
    case 'direct':
      return { siteId: { in: siteIds } };
    case 'ownId':
      return { id: { in: siteIds } };
    case 'relation':
      return { [rule.relation]: { siteId: { in: siteIds } } };
  }
}

/**
 * Composes a caller-supplied `where` with the site constraint.
 *
 * The two are combined under a top-level `AND` rather than merged, so a caller
 * passing their own `OR` cannot widen the result set past their sites.
 */
export function scopedWhere<T extends Record<string, unknown>>(
  ctx: AccessContext,
  model: ScopedModelName,
  where?: T,
): Record<string, unknown> {
  const filter = buildSiteFilter(ctx, model);
  if (!filter) return where ?? {};
  if (!where || Object.keys(where).length === 0) return filter;
  return { AND: [where, filter] };
}

/**
 * The tripwire predicate: is this `where` genuinely restricted to the caller's
 * sites?
 *
 * Only two shapes count, and the exclusions are the whole point:
 *
 *   - a top-level key naming the scope field, or
 *   - that key inside a top-level `AND` branch.
 *
 * `OR` branches are deliberately NOT accepted. `{ OR: [{ siteId: mine },
 * { status: 'ACTIVE' }] }` mentions `siteId`, yet returns every ACTIVE row
 * across every site — a union widens the result, so a constraint in one branch
 * restricts nothing. A naive "does the object mention siteId anywhere" check
 * waves exactly that query through.
 *
 * `NOT` is excluded for the same reason in reverse: it removes rows from the
 * caller's sites rather than confining them to it.
 */
export function hasSiteConstraint(model: ScopedModelName, where: unknown): boolean {
  const rule = scopeRuleFor(model);
  const key = rule.kind === 'relation' ? rule.relation : rule.field;
  return hasTopLevelKey(where, key, 0);
}

const MAX_AND_DEPTH = 8;

function hasTopLevelKey(node: unknown, key: string, depth: number): boolean {
  if (depth > MAX_AND_DEPTH || node === null || typeof node !== 'object') {
    return false;
  }

  if (Array.isArray(node)) {
    // Reached only via an `AND` array: branches are intersected, so one
    // branch carrying the constraint restricts the whole query.
    return node.some((branch) => hasTopLevelKey(branch, key, depth + 1));
  }

  const record = node as Record<string, unknown>;
  if (Object.hasOwn(record, key) && record[key] !== undefined) return true;

  // Descend only through AND. OR and NOT are intentionally not traversed.
  if (Object.hasOwn(record, 'AND')) {
    return hasTopLevelKey(record['AND'], key, depth + 1);
  }

  return false;
}

/**
 * Operations refused outright on scoped models.
 *
 * `findUnique` takes only a unique selector, so a site constraint cannot be
 * added to it — the query would fetch the row first and leak it. Callers use
 * `findFirst` with {@link scopedWhere} instead, which accepts arbitrary filters
 * and returns null for out-of-scope rows.
 */
export const BLOCKED_OPERATIONS = new Set(['findUnique', 'findUniqueOrThrow']);

/** Operations whose `args.where` must carry the site constraint. */
export const WHERE_GUARDED_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

/** Operations whose `args.data` must name an in-scope site. */
export const DATA_GUARDED_OPERATIONS = new Set(['create', 'createMany', 'upsert']);
