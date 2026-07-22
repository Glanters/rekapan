import type { AccessContext } from '../auth/access-context';
import { scopedDb } from '../db/prisma';
import { scopedWhere } from '../db/site-scope';
import { normaliseHeader } from './parse';

/**
 * Site codes are how an operator names a site in a spreadsheet — nobody types a
 * UUID into Excel. Resolving them is therefore also an authorisation step, not
 * just a lookup.
 */

export interface ResolvedSite {
  id: string;
  code: string;
  name: string;
}

/**
 * Maps the site codes appearing in a file to the sites the caller may write to.
 *
 * The query runs through the site-scoped client, so a code naming a real site
 * the caller is not assigned to resolves to nothing and the row is reported as
 * an unknown site. That is deliberate: telling the operator the site exists but
 * is off-limits would let them enumerate the other sites in the system.
 */
export async function resolveSiteCodes(
  ctx: AccessContext,
  codes: readonly string[],
): Promise<ReadonlyMap<string, ResolvedSite>> {
  const wanted = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
  if (wanted.length === 0) return new Map();

  const sites = await scopedDb(ctx).site.findMany({
    where: scopedWhere(ctx, 'Site', {
      deletedAt: null,
      code: { in: wanted, mode: 'insensitive' },
    }),
    select: { id: true, code: true, name: true },
  });

  // Keyed by the normalised code so "jkt", "JKT" and " Jkt " all land on the
  // same site — a case mismatch is not an operator error worth failing on.
  return new Map(sites.map((site) => [normaliseHeader(site.code), site]));
}
