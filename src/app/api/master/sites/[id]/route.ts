import { ValidationError } from '@/server/errors';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { UpdateSiteSchema } from '@/server/sites/schema';
import { deleteSite, updateSite } from '@/server/sites/service';

function siteId(params: Record<string, string | string[]>): string {
  const id = params['id'];
  if (typeof id !== 'string') {
    throw new ValidationError('A site id is required.');
  }
  return id;
}

/**
 * PATCH /api/master/sites/:id
 *
 * Every field is optional so the client sends only what changed; the service
 * leaves untouched columns alone rather than overwriting them with defaults.
 */
export const PATCH = route({
  permission: 'site.update',
  bodySchema: UpdateSiteSchema,
  handler: async ({ access, body, params }) =>
    ok(await updateSite(access, siteId(params), body), { message: 'Site diperbarui.' }),
});

/**
 * DELETE /api/master/sites/:id
 *
 * Soft delete. Monthly reports, Turnover reports, and gallery assets all
 * reference a site with `onDelete: Restrict`, so the row is retained and only
 * `deletedAt` is set.
 */
export const DELETE = route({
  permission: 'site.delete',
  handler: async ({ access, params }) =>
    ok(await deleteSite(access, siteId(params)), { message: 'Site dihapus.' }),
});
