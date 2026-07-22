/** Shared client-side shapes for the Gallery module. */

export interface SiteRef {
  id: string;
  code: string;
  name: string;
}

export interface UploaderRef {
  id: string;
  name: string;
}

/** Which report family an image supports. Mirrors the Prisma enum. */
export type ImageCategory = 'MONTHLY' | 'TURNOVER';

export const CATEGORY_LABELS: Record<ImageCategory, string> = {
  MONTHLY: 'Monthly',
  TURNOVER: 'Turnover',
};

export interface ImageDto {
  id: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  uploaderId: string;
  uploaderName: string;
  category: ImageCategory;
  originalName: string;
  fileName: string;
  extension: string;
  mimeType: string;
  size: number;
  cdnUrl: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  uploadDate: string;
  createdAt: string;
}

export interface GalleryFilterState {
  siteId: string;
  uploaderId: string;
  category: ImageCategory | '';
  from: string;
  to: string;
  search: string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
