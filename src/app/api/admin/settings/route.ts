import { z } from 'zod';

import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import {
  SETTING_DEFINITIONS,
  listSettings,
  updateSettings,
} from '@/server/settings/service';

/**
 * The body is only loosely typed here on purpose. Each value is checked against
 * its own declaration in the service — permitted options, numeric bounds — which
 * is where the catalogue lives; duplicating those rules in a schema would leave
 * two places to update and one of them eventually wrong.
 */
const PutSchema = z.object({
  values: z.record(z.string(), z.union([z.string(), z.number()])),
});

/** GET /api/admin/settings */
export const GET = route({
  permission: 'setting.view',
  handler: async ({ access }) => {
    const settings = await listSettings(access);
    return ok({ settings, definitions: SETTING_DEFINITIONS });
  },
});

/** PUT /api/admin/settings */
export const PUT = route({
  bodySchema: PutSchema,
  permission: 'setting.update',
  handler: async ({ access, body }) => {
    const settings = await updateSettings(access, body.values);
    return ok(
      { settings, definitions: SETTING_DEFINITIONS },
      {
        message: 'Pengaturan disimpan.',
      },
    );
  },
});
