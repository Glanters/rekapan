import { NextResponse } from 'next/server';

import { isAppError, isSecurityEvent } from '../errors';
import { logger } from '../logger';

/**
 * The uniform API response envelope.
 *
 * Every endpoint returns this shape, success or failure, so clients parse one
 * contract instead of guessing per route.
 *
 *   { success, message, data, meta }
 */

export interface ResponseMeta {
  page?: number;
  perPage?: number;
  total?: number;
  totalPages?: number;
  [key: string]: unknown;
}

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T | null;
  meta: ResponseMeta;
}

export function ok<T>(
  data: T,
  options: { message?: string; meta?: ResponseMeta; status?: number } = {},
): NextResponse<ApiEnvelope<T>> {
  return NextResponse.json(
    {
      success: true,
      message: options.message ?? 'Success',
      data,
      meta: options.meta ?? {},
    },
    { status: options.status ?? 200 },
  );
}

export interface PaginationInput {
  page: number;
  perPage: number;
  total: number;
}

export function paginated<T>(
  data: T[],
  pagination: PaginationInput,
  options: { message?: string; meta?: ResponseMeta } = {},
): NextResponse<ApiEnvelope<T[]>> {
  return ok(data, {
    ...options,
    meta: {
      ...options.meta,
      page: pagination.page,
      perPage: pagination.perPage,
      total: pagination.total,
      totalPages: Math.max(1, Math.ceil(pagination.total / pagination.perPage)),
    },
  });
}

/**
 * Converts any thrown value into the envelope.
 *
 * Known {@link AppError}s carry their own status and a message written for the
 * user. Anything else is reported as a generic 500: an unexpected error's
 * message describes internals — table names, driver text, file paths — and
 * handing that to a caller is a disclosure, so it goes to the log instead.
 */
export function fail(
  error: unknown,
  context: { requestId?: string; path?: string; userId?: string } = {},
): NextResponse<ApiEnvelope<never>> {
  if (isAppError(error)) {
    if (isSecurityEvent(error)) {
      logger.error('Security event: cross-site access attempt', {
        ...context,
        code: error.code,
        details: error.details,
      });
    } else if (!error.isOperational) {
      logger.error('Application fault', {
        ...context,
        code: error.code,
        message: error.message,
        stack: error.stack,
      });
    }

    return NextResponse.json(
      {
        success: false,
        message: error.message,
        data: null,
        meta: {
          code: error.code,
          ...(error.details !== undefined ? { details: error.details } : {}),
          ...(context.requestId ? { requestId: context.requestId } : {}),
        },
      },
      {
        status: error.statusCode,
        ...(error.code === 'RATE_LIMITED' && 'retryAfterSeconds' in error
          ? {
              headers: {
                'Retry-After': String(
                  (error as { retryAfterSeconds: number }).retryAfterSeconds,
                ),
              },
            }
          : {}),
      },
    );
  }

  logger.error('Unhandled error', {
    ...context,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  return NextResponse.json(
    {
      success: false,
      message: 'An unexpected error occurred.',
      data: null,
      meta: {
        code: 'INTERNAL',
        ...(context.requestId ? { requestId: context.requestId } : {}),
      },
    },
    { status: 500 },
  );
}
