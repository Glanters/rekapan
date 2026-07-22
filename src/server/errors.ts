/**
 * Typed application errors.
 *
 * Every error carries the HTTP status and machine-readable code the API
 * envelope will surface, so route handlers never hand-roll status numbers and
 * a new error type cannot accidentally become a 500.
 */

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'ACCOUNT_PENDING'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_NO_SITES'
  | 'FORBIDDEN'
  | 'IP_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: unknown;
  /**
   * Whether this error is worth alerting on. Expected conditions — a wrong
   * password, a 404 — are not; they would drown real incidents in noise.
   */
  readonly isOperational: boolean;

  constructor(params: {
    message: string;
    statusCode: number;
    code: ErrorCode;
    details?: unknown;
    isOperational?: boolean;
  }) {
    super(params.message);
    this.name = new.target.name;
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.details = params.details;
    this.isOperational = params.isOperational ?? true;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required.') {
    super({ message, statusCode: 401, code: 'UNAUTHENTICATED' });
  }
}

/**
 * The activation gate. Credentials were valid at Account Center, but no
 * administrator has approved this account yet.
 */
export class AccountPendingError extends AppError {
  constructor(
    message = 'Your account is awaiting administrator approval. You will be able to sign in once it has been activated.',
  ) {
    super({ message, statusCode: 403, code: 'ACCOUNT_PENDING' });
  }
}

export class AccountSuspendedError extends AppError {
  constructor(message = 'Your account has been suspended. Contact an administrator.') {
    super({ message, statusCode: 403, code: 'ACCOUNT_SUSPENDED' });
  }
}

/**
 * Active, but with no site assigned. Distinguished from a permission failure
 * because the remedy is different: an administrator must grant site access.
 */
export class NoSitesAssignedError extends AppError {
  constructor(
    message = 'Your account has no site assigned. Contact an administrator to be granted access to a site.',
  ) {
    super({ message, statusCode: 403, code: 'ACCOUNT_NO_SITES' });
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'You do not have permission to perform this action.',
    details?: unknown,
  ) {
    super({ message, statusCode: 403, code: 'FORBIDDEN', details });
  }
}

/**
 * The caller's address is not on the global IP allowlist.
 *
 * A distinct 403 rather than a generic FORBIDDEN so the client can tell "you
 * are on the wrong network" apart from "your role lacks this permission" — the
 * remedies differ, and only one of them is something the user can act on.
 */
export class IpNotAllowedError extends AppError {
  constructor(
    message = 'Akses dari alamat IP ini tidak diizinkan. Hubungi administrator.',
  ) {
    super({ message, statusCode: 403, code: 'IP_NOT_ALLOWED' });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.') {
    super({ message, statusCode: 404, code: 'NOT_FOUND' });
  }
}

/**
 * Raised when a caller reaches for data belonging to a site they are not
 * assigned to.
 *
 * Deliberately reported as 404, not 403: a 403 confirms the record exists,
 * which lets an attacker enumerate other sites' data by probing identifiers.
 * The distinction is preserved internally — {@link isSecurityEvent} marks it
 * for the audit log and alerting, where a legitimate 404 is not.
 */
export class SiteAccessDeniedError extends NotFoundError {
  readonly isSecurityEvent = true;
  readonly attemptedSiteIds: readonly string[];

  constructor(attemptedSiteIds: readonly string[]) {
    super('Resource not found.');
    this.attemptedSiteIds = attemptedSiteIds;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The submitted data is invalid.', details?: unknown) {
    super({ message, statusCode: 422, code: 'VALIDATION_FAILED', details });
  }
}

export class ConflictError extends AppError {
  constructor(
    message = 'That change conflicts with existing data.',
    details?: unknown,
  ) {
    super({ message, statusCode: 409, code: 'CONFLICT', details });
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(
    retryAfterSeconds: number,
    message = 'Too many requests. Please slow down.',
  ) {
    super({ message, statusCode: 429, code: 'RATE_LIMITED' });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Account Center, object storage, or another dependency is unreachable. */
export class UpstreamUnavailableError extends AppError {
  constructor(service: string, cause?: unknown) {
    super({
      message: `${service} is currently unavailable. Please try again shortly.`,
      statusCode: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      details: { service },
      isOperational: true,
    });
    this.cause = cause;
  }
}

export class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred.', cause?: unknown) {
    super({ message, statusCode: 500, code: 'INTERNAL', isOperational: false });
    this.cause = cause;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** True for errors that should raise an alert rather than just be logged. */
export function isSecurityEvent(error: unknown): boolean {
  return error instanceof SiteAccessDeniedError;
}
