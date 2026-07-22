import { z } from 'zod';

/**
 * Wire validation for `GET /api/dashboard`.
 *
 * Kept out of `route.ts` because Next.js route modules may only export HTTP
 * methods and route config, so nothing else can import a schema declared there.
 *
 * Every field is optional: the dashboard is the landing page and must render
 * from a bare `/api/dashboard` with no query string at all. Defaulting and
 * clamping happen in the service, not here, so a hand-crafted request gets the
 * same bounds the UI does.
 */

/**
 * Widest window the endpoint will aggregate over.
 *
 * The range reaches the database as a `BETWEEN` on an indexed date column, so
 * an unbounded value from the query string is a trivial way to ask for a scan
 * of the entire history. A year is more than any reporting view needs.
 */
export const DASHBOARD_MAX_RANGE_DAYS = 366;

/** Window used when the caller supplies no dates. */
export const DASHBOARD_DEFAULT_RANGE_DAYS = 30;

export const DashboardQuerySchema = z.object({
  siteId: z.uuid('Site tidak dikenal.').optional(),
  from: z.iso.date('Tanggal mulai harus berformat YYYY-MM-DD.').optional(),
  to: z.iso.date('Tanggal akhir harus berformat YYYY-MM-DD.').optional(),
});

export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;
