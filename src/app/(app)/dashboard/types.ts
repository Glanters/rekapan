/**
 * Client-side shapes for the dashboard.
 *
 * Re-exported from the service rather than restated, so the wire contract has
 * one definition and a field added server-side cannot silently go missing here.
 * `export type` is erased entirely under `verbatimModuleSyntax`, so nothing
 * from the server module — Prisma, the database client — reaches the bundle.
 */
export type {
  DashboardActivity,
  DashboardData,
  DashboardRange,
  DashboardSeriesPoint,
  DashboardSiteBreakdown,
  DashboardTopGame,
  DashboardTotals,
} from '@/server/dashboard/service';

export interface SiteRef {
  id: string;
  code: string;
  name: string;
}

/** The uniform API envelope, narrowed to what this page reads. */
export interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
  meta: Record<string, unknown>;
}
