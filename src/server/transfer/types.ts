/** Shapes shared by the Monthly and Turnover transfer endpoints. */

export const TRANSFER_FORMATS = ['xlsx', 'csv'] as const;

export type TransferFormat = (typeof TRANSFER_FORMATS)[number];

export function isTransferFormat(value: string): value is TransferFormat {
  return (TRANSFER_FORMATS as readonly string[]).includes(value);
}

/** A cell as handed to the workbook writer. */
export type TransferCell = string | number | boolean | Date | null;

/**
 * A file being produced, described lazily.
 *
 * `rows` is a factory rather than a value so nothing is fetched until the
 * response body is actually being consumed.
 */
export interface TransferSource {
  sheetName: string;
  headers: readonly string[];
  rows: () => AsyncIterable<readonly TransferCell[]>;
  /**
   * Called once the last byte has been written, or with the failure that
   * stopped it. Used to close out the ExportJob row.
   */
  onSettled?: (error: Error | null, rowsWritten: number) => void | Promise<void>;
}

/** A ready-to-return download. */
export interface TransferDownload {
  body: ReadableStream<Uint8Array>;
  filename: string;
  contentType: string;
}

/** The verdict on one row of an uploaded file. */
export interface ImportRowResult {
  /**
   * Row number as the operator sees it in their spreadsheet, header row
   * included — so "baris 7" in the report is row 7 in Excel.
   */
  row: number;
  valid: boolean;
  siteCode: string | null;
  reportDate: string | null;
  /** Empty when the row is valid. */
  errors: string[];
}

export interface ImportResult {
  /** True when nothing was written and this is a preview. */
  dryRun: boolean;
  totalRows: number;
  successRows: number;
  failedRows: number;
  rows: ImportRowResult[];
  /** Headers that were matched to a column or game, for a sanity check. */
  recognisedColumns: string[];
  /** Set only after a commit. */
  importJobId: string | null;
}
