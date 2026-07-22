import { Workbook } from 'exceljs';

import { ValidationError } from '../errors';
import { IMPORT_FILE_SIZE_LIMIT, IMPORT_ROW_LIMIT } from './limits';

/**
 * Reading an uploaded sheet.
 *
 * Unlike the export, an import is read whole. Per-row validation has to report
 * every bad row before the first write lands, which means the file must be in
 * hand anyway — so the defence here is a size ceiling and a row ceiling rather
 * than streaming.
 */

/** One data row, with the row number the operator sees in their spreadsheet. */
export interface SheetRow {
  number: number;
  cells: readonly SheetCell[];
}

export type SheetCell = string | number | boolean | Date | null;

export interface SheetMatrix {
  headers: readonly string[];
  rows: readonly SheetRow[];
}

const XLSX_EXTENSIONS = ['.xlsx', '.xlsm'];
const CSV_EXTENSIONS = ['.csv', '.txt'];

export interface Upload {
  name: string;
  size: number;
  buffer: Buffer;
  isCsv: boolean;
}

/** Pulls the file out of a multipart body and checks it before reading it. */
export async function readUpload(request: Request): Promise<Upload> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ValidationError(
      'Unggahan tidak terbaca. Kirim berkas sebagai form-data.',
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new ValidationError('Berkas belum dipilih.');
  }

  if (file.size === 0) {
    throw new ValidationError('Berkas kosong.');
  }

  if (file.size > IMPORT_FILE_SIZE_LIMIT) {
    throw new ValidationError(
      `Berkas terlalu besar. Maksimum ${Math.round(IMPORT_FILE_SIZE_LIMIT / 1024 / 1024)} MB.`,
      { size: file.size, limit: IMPORT_FILE_SIZE_LIMIT },
    );
  }

  const name = file.name || 'upload';
  const lower = name.toLowerCase();
  const isCsv = CSV_EXTENSIONS.some((extension) => lower.endsWith(extension));
  const isXlsx = XLSX_EXTENSIONS.some((extension) => lower.endsWith(extension));

  if (!isCsv && !isXlsx) {
    throw new ValidationError('Format berkas tidak didukung. Gunakan .xlsx atau .csv.');
  }

  return {
    name,
    size: file.size,
    buffer: Buffer.from(await file.arrayBuffer()),
    isCsv,
  };
}

/**
 * Flattens whatever ExcelJS put in a cell into a primitive.
 *
 * A cell is not always a scalar: formulas arrive as `{ formula, result }`,
 * styled text as `{ richText: [...] }`, links as `{ text, hyperlink }`. Reading
 * `.value` blind would stringify those into `[object Object]` and store it.
 */
function cellToPrimitive(value: unknown): SheetCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;

  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return value as string | number | boolean;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;

    // A formula that evaluated to an error has no usable value; treated as
    // blank so the row fails on the missing value rather than on "#REF!".
    if ('error' in record) return null;
    if ('result' in record) return cellToPrimitive(record['result']);
    if ('text' in record) return cellToPrimitive(record['text']);

    if (Array.isArray(record['richText'])) {
      return (record['richText'] as { text?: unknown }[])
        .map((run) => (typeof run.text === 'string' ? run.text : ''))
        .join('');
    }
  }

  return null;
}

function isBlank(cell: SheetCell): boolean {
  return cell === null || (typeof cell === 'string' && cell.trim() === '');
}

/** Parses one CSV field-by-field, per RFC 4180. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  // Strip the BOM Excel writes, which would otherwise become part of the first
  // header and stop it matching anything.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Reads an upload into a header row plus numbered data rows. */
export async function parseSheet(upload: Upload): Promise<SheetMatrix> {
  const raw = upload.isCsv
    ? parseCsv(upload.buffer.toString('utf8')).map((cells) => cells as SheetCell[])
    : await readXlsxRows(upload.buffer);

  const headerRow = raw[0];
  if (!headerRow || headerRow.every(isBlank)) {
    throw new ValidationError(
      'Baris judul tidak ditemukan. Unduh templat lalu isi ulang.',
    );
  }

  const headers = headerRow.map((cell) => (cell === null ? '' : String(cell).trim()));

  const rows: SheetRow[] = [];
  for (let index = 1; index < raw.length; index += 1) {
    const cells = raw[index] ?? [];
    // Blank rows are skipped rather than reported: a trailing run of them is
    // what a spreadsheet leaves behind after a delete, not an operator error.
    if (cells.every(isBlank)) continue;

    rows.push({ number: index + 1, cells });

    if (rows.length > IMPORT_ROW_LIMIT) {
      throw new ValidationError(
        `Berkas berisi lebih dari ${IMPORT_ROW_LIMIT.toLocaleString('id-ID')} baris data. ` +
          'Pecah menjadi beberapa berkas lalu unggah bergantian.',
        { limit: IMPORT_ROW_LIMIT },
      );
    }
  }

  return { headers, rows };
}

async function readXlsxRows(buffer: Buffer): Promise<SheetCell[][]> {
  const workbook = new Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ValidationError('Berkas Excel tidak dapat dibaca atau rusak.');
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new ValidationError('Berkas tidak memiliki lembar kerja.');
  }

  const columnCount = Math.max(sheet.columnCount, sheet.actualColumnCount);
  const rows: SheetCell[][] = [];

  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: SheetCell[] = [];
    for (let column = 1; column <= columnCount; column += 1) {
      cells.push(cellToPrimitive(row.getCell(column).value));
    }
    // `eachRow` skips nothing with includeEmpty, so the index is the real row
    // number and gaps are preserved — the numbers we report back match Excel.
    rows[rowNumber - 1] = cells;
  });

  for (let index = 0; index < rows.length; index += 1) {
    rows[index] ??= [];
  }

  return rows;
}

// ============================================================================
// HEADER MATCHING
// ============================================================================

/** Case, spacing, and separator differences are not worth failing an import over. */
export function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

export const SITE_HEADERS = new Set(
  ['site code', 'site', 'sitecode', 'kode site', 'kode'].map(normaliseHeader),
);

export const DATE_HEADERS = new Set(
  ['report date', 'date', 'tanggal', 'tgl', 'periode'].map(normaliseHeader),
);

export const NOTE_HEADERS = new Set(
  ['note', 'catatan', 'keterangan'].map(normaliseHeader),
);

/**
 * Headers the exports emit for the reader's benefit and the importer has no
 * business writing back.
 *
 * Without this list a round trip would fail: an operator exports, edits, and
 * re-uploads the very file this application produced, and the derived columns
 * it added would be rejected as unknown.
 */
export const DERIVED_HEADERS = new Set(
  ['site name', 'nama site', 'total', 'jumlah', 'status'].map(normaliseHeader),
);

// ============================================================================
// CELL COERCION
// ============================================================================

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const SLASHED_ISO = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const DAY_FIRST = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

function toIsoParts(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  // Round-trip check: Date.UTC rolls 31 February forward to 2 March rather
  // than rejecting it, so a typo would otherwise be stored as a real date.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ValidationError('tanggal tidak valid');
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Reads a date cell as `YYYY-MM-DD`.
 *
 * Accepts what operators actually type: an Excel date cell, ISO, or the
 * day-first forms used locally. A bare number is refused rather than guessed at
 * as an Excel serial — silently reading 45000 as a date is worse than asking.
 *
 * @throws {ValidationError} With a fragment meant to be embedded in a row error.
 */
export function parseDateCell(value: SheetCell): string {
  if (value instanceof Date) {
    // ExcelJS materialises date cells at UTC midnight; reading them back with
    // UTC accessors avoids the local-timezone shift that turns the 1st into
    // the 31st for anyone east of Greenwich.
    return toIsoParts(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  }

  if (typeof value === 'string') {
    const text = value.trim();

    const iso = ISO_DATE.exec(text) ?? SLASHED_ISO.exec(text);
    if (iso?.[1] && iso[2] && iso[3]) {
      return toIsoParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    }

    const dayFirst = DAY_FIRST.exec(text);
    if (dayFirst?.[1] && dayFirst[2] && dayFirst[3]) {
      return toIsoParts(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
    }
  }

  throw new ValidationError('tanggal tidak dikenali, gunakan format YYYY-MM-DD');
}

/**
 * Reads a numeric cell, tolerating the thousands separators operators paste in.
 *
 * Separator handling is necessarily a judgement call. When both `.` and `,`
 * appear, the last one is the decimal point. When only one appears, a
 * three-digit grouping (`1,250`) is read as a thousands separator and anything
 * else (`1,25`) as a decimal point — which resolves `1,250` to 1250 rather than
 * 1.25. That is the reading an Indonesian operator means far more often, but it
 * is a guess, and the template exists so it rarely has to be made.
 *
 * @throws {ValidationError} With a fragment meant to be embedded in a row error.
 */
export function parseNumberCell(value: SheetCell): number | null {
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ValidationError('bukan angka');
    return value;
  }
  if (typeof value !== 'string') throw new ValidationError('bukan angka');

  let text = value
    .trim()
    .replace(/^(rp|idr|\$)\s*/i, '')
    .replace(/\s/g, '');
  if (text === '' || text === '-') return null;

  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-')) {
    sign = -1;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let normalised: string;

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalAt = Math.max(lastDot, lastComma);
    normalised = `${text.slice(0, decimalAt).replace(/[.,]/g, '')}.${text.slice(decimalAt + 1)}`;
  } else if (lastComma >= 0) {
    normalised = /^\d{1,3}(,\d{3})+$/.test(text)
      ? text.replaceAll(',', '')
      : text.replace(',', '.');
  } else if (lastDot >= 0) {
    normalised = /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replaceAll('.', '') : text;
  } else {
    normalised = text;
  }

  if (!/^\d+(\.\d+)?$/.test(normalised)) {
    throw new ValidationError(`"${value}" bukan angka`);
  }

  return sign * Number(normalised);
}

/** Reads a cell as trimmed text, or null when blank. */
export function parseTextCell(value: SheetCell): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  const text = String(value).trim();
  return text === '' ? null : text;
}

/** Reads the loose truthy spellings operators use for a yes/no column. */
export function parseBooleanCell(value: SheetCell): boolean | null {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;

  const text = String(value).trim().toLowerCase();
  if (text === '') return null;
  if (['1', 'true', 'ya', 'yes', 'y'].includes(text)) return true;
  if (['0', 'false', 'tidak', 'no', 'n'].includes(text)) return false;

  throw new ValidationError(`"${value}" bukan nilai ya/tidak`);
}
