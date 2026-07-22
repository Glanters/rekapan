/** Shared client-side shapes for the Monthly module. */

export type ColumnDataType =
  'CURRENCY' | 'DECIMAL' | 'INTEGER' | 'PERCENT' | 'TEXT' | 'DATE' | 'BOOLEAN';

export type CellValue = number | string | boolean | null;

export interface SiteRef {
  id: string;
  code: string;
  name: string;
}

export type ResultEffect = 'NEUTRAL' | 'ADD' | 'SUBTRACT' | 'RESULT';

/** Where a column's value comes from. */
export type ColumnComputation = 'NONE' | 'VALIDATION_TOTAL';

/** A bank members register through; one column of the Validasi breakdown. */
export interface BankDto {
  id: string;
  code: string;
  name: string;
  position: number;
}

export interface MonthlyColumnDto {
  id: string;
  key: string;
  label: string;
  group: string | null;
  dataType: ColumnDataType;
  position: number;
  precision: number;
  unit: string | null;
  includeInTotals: boolean;
  isRequired: boolean;
  /** How this column feeds the derived Hasil. */
  resultEffect: ResultEffect;
  /** Whether the value is entered by hand or computed. */
  computation: ColumnComputation;
}

export interface MonthlyRowDto {
  id: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  reportDate: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'LOCKED';
  note: string | null;
  values: Record<string, CellValue>;
  /** Member registrations keyed by bank code. */
  validations: Record<string, number>;
  /** ISO 8601 with time. */
  createdAt: string;
  updatedAt: string;
  /** Display name of who created / last edited the report; null if unknown. */
  createdBy: string | null;
  updatedBy: string | null;
}
