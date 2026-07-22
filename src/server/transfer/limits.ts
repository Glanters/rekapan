/**
 * Ceilings for bulk transfer.
 *
 * Each of these exists because the operation behind it is unbounded by nature:
 * a date range can span years, an uploaded file can be any size, and both reach
 * the database. The numbers are deliberately modest — this is an operator-driven
 * feature reached from a toolbar, not a data pipeline.
 */

/**
 * Rows an export may contain before it is refused outright.
 *
 * Refused, not truncated. A file that stops early still looks complete when it
 * is opened, and a total computed from it is wrong in a way nobody notices — so
 * the request fails loudly and asks for a narrower range instead.
 */
export const EXPORT_ROW_LIMIT = 25_000;

/** Reports fetched per round trip while an export streams. */
export const EXPORT_BATCH_SIZE = 500;

/**
 * Data rows an uploaded file may contain.
 *
 * Sized against the commit, not the parse: every row is a report upsert plus one
 * upsert per column, and all of it runs inside a single transaction that holds a
 * connection for its duration.
 */
export const IMPORT_ROW_LIMIT = 1_000;

/** Upload size ceiling, in bytes. */
export const IMPORT_FILE_SIZE_LIMIT = 8 * 1024 * 1024;

/**
 * Transaction budget for a commit. Prisma's 5s default would abort a legitimate
 * thousand-row import halfway through, which is precisely the outcome running
 * the import in one transaction is meant to prevent.
 */
export const IMPORT_TRANSACTION_TIMEOUT_MS = 180_000;
export const IMPORT_TRANSACTION_MAX_WAIT_MS = 15_000;
