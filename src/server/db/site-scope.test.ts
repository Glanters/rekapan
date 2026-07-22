import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALL_SITES, AccessContext, limitedTo } from '../auth/access-context';
import { ForbiddenError, SiteAccessDeniedError } from '../errors';
import {
  SITE_SCOPED_MODELS,
  buildSiteFilter,
  hasSiteConstraint,
  isScopedModel,
  scopedWhere,
} from './site-scope';

function ctxWith(
  siteScope: typeof ALL_SITES | ReturnType<typeof limitedTo>,
  overrides: {
    roleKey?: 'ROOT' | 'MANAGER' | 'OPERATOR';
    roleLevel?: number | null;
  } = {},
) {
  return new AccessContext({
    userId: 'user-1',
    email: 'user@example.com',
    name: 'Test User',
    roleKey: overrides.roleKey ?? 'OPERATOR',
    // `in` rather than `??`: null is a meaningful value here (a user holding no
    // role), and nullish coalescing would silently replace it with the default,
    // leaving that case untested.
    roleLevel: 'roleLevel' in overrides ? (overrides.roleLevel ?? null) : 40,
    permissions: [],
    siteScope,
    sessionId: 'session-1',
  });
}

const root = ctxWith(ALL_SITES, { roleKey: 'ROOT', roleLevel: 0 });
const jakartaBandung = ctxWith(limitedTo(['site-jkt', 'site-bdg']));
const noSites = ctxWith(limitedTo([]));

describe('buildSiteFilter', () => {
  it('returns null for Root, who is unconstrained', () => {
    expect(buildSiteFilter(root, 'MonthlyReport')).toBeNull();
  });

  it('constrains models that carry siteId directly', () => {
    expect(buildSiteFilter(jakartaBandung, 'MonthlyReport')).toEqual({
      siteId: { in: ['site-jkt', 'site-bdg'] },
    });
  });

  it('constrains Site on its own primary key', () => {
    expect(buildSiteFilter(jakartaBandung, 'Site')).toEqual({
      id: { in: ['site-jkt', 'site-bdg'] },
    });
  });

  it('constrains value tables through their parent report', () => {
    expect(buildSiteFilter(jakartaBandung, 'MonthlyValue')).toEqual({
      report: { siteId: { in: ['site-jkt', 'site-bdg'] } },
    });
  });

  it('fails closed for a user with no sites, matching nothing', () => {
    expect(buildSiteFilter(noSites, 'MonthlyReport')).toEqual({
      siteId: { in: [] },
    });
  });
});

describe('scopedWhere', () => {
  it('returns the bare filter when no other conditions are supplied', () => {
    expect(scopedWhere(jakartaBandung, 'MonthlyReport')).toEqual({
      siteId: { in: ['site-jkt', 'site-bdg'] },
    });
  });

  it('composes under AND rather than merging keys', () => {
    const where = { status: 'DRAFT' };
    expect(scopedWhere(jakartaBandung, 'MonthlyReport', where)).toEqual({
      AND: [{ status: 'DRAFT' }, { siteId: { in: ['site-jkt', 'site-bdg'] } }],
    });
  });

  it('cannot be widened by a caller-supplied OR', () => {
    // The caller's OR stays trapped inside one AND branch, so it can only ever
    // narrow within the sites the other branch already permits.
    const result = scopedWhere(jakartaBandung, 'MonthlyReport', {
      OR: [{ status: 'DRAFT' }, { status: 'APPROVED' }],
    });

    expect(result).toEqual({
      AND: [
        { OR: [{ status: 'DRAFT' }, { status: 'APPROVED' }] },
        { siteId: { in: ['site-jkt', 'site-bdg'] } },
      ],
    });
    expect(hasSiteConstraint('MonthlyReport', result)).toBe(true);
  });

  it('passes the caller filter through untouched for Root', () => {
    expect(scopedWhere(root, 'MonthlyReport', { status: 'DRAFT' })).toEqual({
      status: 'DRAFT',
    });
  });
});

describe('hasSiteConstraint — the tripwire predicate', () => {
  it('accepts a top-level site field', () => {
    expect(hasSiteConstraint('MonthlyReport', { siteId: 'site-jkt' })).toBe(true);
    expect(hasSiteConstraint('MonthlyReport', { siteId: { in: ['a'] } })).toBe(true);
  });

  it('accepts the field inside a top-level AND', () => {
    expect(
      hasSiteConstraint('MonthlyReport', {
        AND: [{ status: 'DRAFT' }, { siteId: { in: ['a'] } }],
      }),
    ).toBe(true);
  });

  it('accepts a nested AND', () => {
    expect(
      hasSiteConstraint('MonthlyReport', {
        AND: [{ AND: [{ siteId: { in: ['a'] } }] }],
      }),
    ).toBe(true);
  });

  it('accepts a non-array AND object', () => {
    expect(hasSiteConstraint('MonthlyReport', { AND: { siteId: { in: ['a'] } } })).toBe(
      true,
    );
  });

  // ---- The cases that make a naive implementation unsafe -------------------

  it('REJECTS a site constraint inside an OR', () => {
    // This query mentions siteId, yet returns every APPROVED report across
    // every site. A "does the object mention siteId" check would pass it.
    const leaky = {
      OR: [{ siteId: { in: ['site-jkt'] } }, { status: 'APPROVED' }],
    };
    expect(hasSiteConstraint('MonthlyReport', leaky)).toBe(false);
  });

  it('REJECTS a site constraint inside a NOT', () => {
    // NOT excludes the caller's own sites; it is the opposite of a scope.
    expect(
      hasSiteConstraint('MonthlyReport', { NOT: { siteId: { in: ['site-jkt'] } } }),
    ).toBe(false);
  });

  it('REJECTS an OR nested inside an AND branch', () => {
    expect(
      hasSiteConstraint('MonthlyReport', {
        AND: [{ OR: [{ siteId: { in: ['a'] } }, { status: 'APPROVED' }] }],
      }),
    ).toBe(false);
  });

  it('rejects an empty or absent where', () => {
    expect(hasSiteConstraint('MonthlyReport', undefined)).toBe(false);
    expect(hasSiteConstraint('MonthlyReport', {})).toBe(false);
    expect(hasSiteConstraint('MonthlyReport', null)).toBe(false);
  });

  it('rejects an explicitly undefined site field', () => {
    // `{ siteId: undefined }` is how an unset variable reaches Prisma, and it
    // applies no filter at all.
    expect(hasSiteConstraint('MonthlyReport', { siteId: undefined })).toBe(false);
  });

  it('rejects a constraint on an unrelated field', () => {
    expect(hasSiteConstraint('MonthlyReport', { status: 'DRAFT' })).toBe(false);
  });

  it('checks the relation key for value tables', () => {
    expect(hasSiteConstraint('MonthlyValue', { siteId: { in: ['a'] } })).toBe(false);
    expect(
      hasSiteConstraint('MonthlyValue', { report: { siteId: { in: ['a'] } } }),
    ).toBe(true);
  });

  it('terminates on deeply nested input rather than recursing without bound', () => {
    let deep: Record<string, unknown> = { siteId: 'a' };
    for (let i = 0; i < 50; i += 1) deep = { AND: [deep] };
    expect(() => hasSiteConstraint('MonthlyReport', deep)).not.toThrow();
    expect(hasSiteConstraint('MonthlyReport', deep)).toBe(false);
  });
});

describe('AccessContext site guards', () => {
  it('derives Root status from scope shape, not role name', () => {
    expect(root.isRoot).toBe(true);
    expect(jakartaBandung.isRoot).toBe(false);
    expect(noSites.isRoot).toBe(false);
  });

  it('rejects a site outside the caller’s assignment', () => {
    expect(() => jakartaBandung.requireSite('site-bali')).toThrow(
      SiteAccessDeniedError,
    );
    expect(() => jakartaBandung.requireSite('site-jkt')).not.toThrow();
    expect(() => root.requireSite('site-anything')).not.toThrow();
  });

  it('reports every denied site in a bulk check, not just the first', () => {
    try {
      jakartaBandung.requireSites(['site-jkt', 'site-bali', 'site-medan']);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SiteAccessDeniedError);
      expect((error as SiteAccessDeniedError).attemptedSiteIds).toEqual([
        'site-bali',
        'site-medan',
      ]);
    }
  });

  it('reports cross-site access as 404 so existence is not confirmed', () => {
    const error = new SiteAccessDeniedError(['site-bali']);
    expect(error.statusCode).toBe(404);
    expect(error.isSecurityEvent).toBe(true);
  });

  it('narrows a requested filter to the intersection with the caller’s sites', () => {
    expect(jakartaBandung.narrowSiteFilter(['site-jkt', 'site-bali'])).toEqual([
      'site-jkt',
    ]);
    expect(jakartaBandung.narrowSiteFilter(undefined)).toEqual([
      'site-jkt',
      'site-bdg',
    ]);
    expect(jakartaBandung.narrowSiteFilter([])).toEqual(['site-jkt', 'site-bdg']);
  });

  it('lets Root request any site and imposes no filter when none is requested', () => {
    expect(root.narrowSiteFilter(['site-bali'])).toEqual(['site-bali']);
    expect(root.narrowSiteFilter(undefined)).toBeNull();
  });
});

/**
 * Rank guards. These are what stop privilege escalation through the user
 * administration screen, so each boundary is pinned rather than assumed.
 */
describe('AccessContext.outranks', () => {
  const manager = ctxWith(limitedTo(['site-jkt']), {
    roleKey: 'MANAGER',
    roleLevel: 20,
  });

  it('permits managing strictly lower levels', () => {
    expect(manager.outranks(30)).toBe(true);
    expect(manager.outranks(40)).toBe(true);
  });

  it('REFUSES peers at the same level', () => {
    // Two managers able to edit each other means either can strip the other's
    // access, and a single compromised account escalates sideways.
    expect(manager.outranks(20)).toBe(false);
  });

  it('REFUSES anyone more authoritative', () => {
    expect(manager.outranks(10)).toBe(false);
    expect(manager.outranks(0)).toBe(false);
  });

  it('lets Root manage every level', () => {
    expect(root.outranks(0)).toBe(true);
    expect(root.outranks(50)).toBe(true);
    expect(root.outranks(null)).toBe(true);
  });

  it('treats a user with no role as outrankable, but a caller without one as powerless', () => {
    expect(manager.outranks(null)).toBe(true);

    const roleless = ctxWith(limitedTo(['site-jkt']), { roleLevel: null });
    expect(roleless.outranks(50)).toBe(false);
    expect(roleless.outranks(null)).toBe(false);
  });

  it('throws ForbiddenError through requireOutranks', () => {
    expect(() => manager.requireOutranks(10, 'a user')).toThrow(ForbiddenError);
    expect(() => manager.requireOutranks(30, 'a user')).not.toThrow();
  });
});

/**
 * Guards against the failure mode this whole layer exists to prevent: someone
 * adds a site-owned table and forgets to register it, leaving it unscoped.
 *
 * Exclusions must be listed with a reason, so skipping a model is a decision
 * rather than an oversight.
 */
describe('scope registry completeness', () => {
  const INTENTIONALLY_UNSCOPED: Record<string, string> = {
    UserSite: 'Join table; reached only through an already-scoped User or Site.',
    AuditLog:
      'Scoped by the audit.view permission and filtered explicitly in its own repository; siteId is nullable because system events belong to no site.',
    ImportJob:
      'Owned by the uploading user; siteId is nullable for multi-site files and filtered in the repository.',
    Setting: 'siteId is nullable and denotes a per-site override of a global default.',
  };

  const schema = readFileSync(
    path.resolve(__dirname, '../../../prisma/schema.prisma'),
    'utf8',
  );

  const modelsWithSite = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]
    .filter(([, , body]) => /^\s*siteId\s/m.test(body ?? ''))
    .map(([, name]) => name as string);

  it('finds site-bearing models in the schema (guards the parser itself)', () => {
    expect(modelsWithSite).toContain('MonthlyReport');
    expect(modelsWithSite.length).toBeGreaterThan(3);
  });

  it.each(modelsWithSite)('%s is either scoped or explicitly excused', (model) => {
    const registered = isScopedModel(model);
    const excused = Object.hasOwn(INTENTIONALLY_UNSCOPED, model);

    expect(
      registered || excused,
      `Model "${model}" has a siteId but is neither registered in ` +
        'SITE_SCOPED_MODELS nor listed in INTENTIONALLY_UNSCOPED. Every ' +
        'site-owned table must be one or the other.',
    ).toBe(true);
  });

  it('scopes Site itself, which has no siteId column', () => {
    expect(isScopedModel('Site')).toBe(true);
    expect(Object.keys(SITE_SCOPED_MODELS)).toContain('Site');
  });
});
