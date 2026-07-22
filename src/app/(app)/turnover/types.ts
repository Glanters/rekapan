/** Shared client-side shapes for the Turnover module. */

export interface SiteRef {
  id: string;
  code: string;
  name: string;
}

export interface TurnoverGameDto {
  id: string;
  code: string;
  name: string;
  category: string | null;
  position: number;
}

export interface TurnoverRowDto {
  id: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  reportDate: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'LOCKED';
  values: Record<string, number | null>;
  rowTotal: number;
  /** ISO 8601 with time. */
  createdAt: string;
  updatedAt: string;
  /** Display name of who created / last edited the report; null if unknown. */
  createdBy: string | null;
  updatedBy: string | null;
}
