import { randomUUID } from 'node:crypto';

import type { NextRequest } from 'next/server';
import type { ZodType } from 'zod';

import type { AccessContext } from '../auth/access-context';
import type { PermissionKey } from '../auth/permissions';
import { resolveSession } from '../auth/session';
import {
  IpNotAllowedError,
  RateLimitError,
  UnauthenticatedError,
  ValidationError,
} from '../errors';
import { getIpRules, isIpAllowed } from '../security/ip-allowlist';
import { fail } from './envelope';
import { clientIp, consume } from './rate-limit';

/**
 * Route handler composition.
 *
 * Wrapping every endpoint in one pipeline is what makes the cross-cutting
 * concerns non-optional. Authentication, permission checks, body validation,
 * rate limiting, and error shaping all happen here, so an endpoint cannot ship
 * without them by forgetting a line — the omission has to be an explicit
 * `auth: false` that shows up in review.
 */

/** Shape Next.js passes as the second argument to a dynamic route handler. */
export interface NextRouteArgs {
  params: Promise<Record<string, string | string[]>>;
}

export interface RouteContext<TBody> {
  request: NextRequest;
  /** Non-null unless the route opted out of authentication. */
  access: AccessContext;
  body: TBody;
  /** Resolved dynamic segments; empty for static routes. */
  params: Record<string, string | string[]>;
  requestId: string;
  ip: string;
  userAgent: string | undefined;
}

export interface PublicRouteContext<TBody> extends Omit<RouteContext<TBody>, 'access'> {
  access: null;
}

interface BaseConfig<TBody> {
  /** Validates and narrows the JSON body. Omit for routes that take none. */
  bodySchema?: ZodType<TBody>;
  rateLimit?: {
    limit: number;
    windowSeconds: number;
    /** Bucket discriminator; defaults to the client address. */
    key?: (request: NextRequest, ip: string) => string;
  };
}

/**
 * `Response`, not `NextResponse`: streaming endpoints (ZIP archives, Excel
 * exports) construct a plain Response around a stream, and `NextResponse` is a
 * subtype, so requiring it would exclude them.
 */
type RouteResult = Promise<Response>;

interface AuthedConfig<TBody> extends BaseConfig<TBody> {
  auth?: true;
  /** Enforced before the handler runs. */
  permission?: PermissionKey;
  /**
   * Skips the global IP allowlist check. Only sign-out should set this: a user
   * blocked by a newly-tightened allowlist must still be able to end their own
   * session rather than being stranded in it.
   */
  ipExempt?: boolean;
  handler: (context: RouteContext<TBody>) => RouteResult;
}

interface PublicConfig<TBody> extends BaseConfig<TBody> {
  /** Explicit opt-out. Only login and health checks should set this. */
  auth: false;
  handler: (context: PublicRouteContext<TBody>) => RouteResult;
}

export type RouteConfig<TBody> = AuthedConfig<TBody> | PublicConfig<TBody>;

async function parseBody<TBody>(
  request: NextRequest,
  schema: ZodType<TBody> | undefined,
): Promise<TBody> {
  if (!schema) return undefined as TBody;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON.');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError('The submitted data is invalid.', {
      fields: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  return result.data;
}

export function route<TBody = undefined>(
  config: RouteConfig<TBody>,
): (request: NextRequest, args: NextRouteArgs) => Promise<Response> {
  // `args` is declared required to satisfy the handler signature Next.js
  // generates and type-checks against, but is still read defensively: static
  // routes are invoked without dynamic segments.
  return async function handle(
    request: NextRequest,
    args: NextRouteArgs,
  ): Promise<Response> {
    const requestId = randomUUID();
    const ip = clientIp(request.headers);
    const userAgent = request.headers.get('user-agent') ?? undefined;
    const params = args ? await args.params : {};

    try {
      if (config.rateLimit) {
        const key =
          config.rateLimit.key?.(request, ip) ?? `${request.nextUrl.pathname}:${ip}`;
        const result = await consume(
          key,
          config.rateLimit.limit,
          config.rateLimit.windowSeconds,
        );
        if (!result.allowed) {
          throw new RateLimitError(result.retryAfterSeconds);
        }
      }

      const body = await parseBody(request, config.bodySchema);

      if (config.auth === false) {
        return await config.handler({
          request,
          access: null,
          body,
          params,
          requestId,
          ip,
          userAgent,
        });
      }

      const access = await resolveSession({ ip, userAgent });
      if (!access) {
        throw new UnauthenticatedError();
      }

      // The global IP allowlist gates authenticated access. Login is a public
      // route (`auth: false`) and never reaches here, so a blocked address can
      // still sign in — it just cannot use the API afterwards. Sign-out sets
      // `ipExempt` so a blocked session is never trapped.
      if (!config.ipExempt && !isIpAllowed(ip, await getIpRules())) {
        throw new IpNotAllowedError();
      }

      if (config.permission) {
        access.requirePermission(config.permission);
      }

      return await config.handler({
        request,
        access,
        body,
        params,
        requestId,
        ip,
        userAgent,
      });
    } catch (error) {
      return fail(error, {
        requestId,
        path: request.nextUrl.pathname,
      });
    }
  };
}
