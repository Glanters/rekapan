/**
 * Client-side mirrors of the transfer endpoints' payloads.
 *
 * Declared here rather than imported from `@/server` so nothing in the browser
 * bundle has a path back into server code, matching how the Monthly and
 * Turnover modules already declare their row shapes.
 */

export type TransferFormat = 'xlsx' | 'csv';

/** Which pair of endpoints a toolbar talks to. */
export type TransferModule = 'monthly' | 'turnover';

export interface ImportRowResult {
  /** Row number as it appears in the operator's spreadsheet. */
  row: number;
  valid: boolean;
  siteCode: string | null;
  reportDate: string | null;
  errors: string[];
}

export interface ImportResult {
  dryRun: boolean;
  totalRows: number;
  successRows: number;
  failedRows: number;
  rows: ImportRowResult[];
  recognisedColumns: string[];
  importJobId: string | null;
}

export interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
  meta: Record<string, unknown>;
}
