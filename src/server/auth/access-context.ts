import { ForbiddenError, NoSitesAssignedError, SiteAccessDeniedError } from '../errors';
import type { PermissionKey, RoleKey } from './permissions';

/**
 * Who the caller is and what they may reach. Constructed once per request from
 * the session and threaded through every service and repository call.
 */

/**
 * A caller's site reach.
 *
 * Modelled as a discriminated union rather than a `string[]` on purpose. If
 * "every site" were represented by an empty array, any bug that emptied a
 * normal user's site list would silently promote them to seeing everything —
 * the failure mode points the wrong way. With separate shapes, "all" and "none"
 * cannot be confused, and `limited` with zero entries matches zero rows, which
 * is the safe direction to fail.
 */
export type SiteScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'limited'; readonly siteIds: readonly string[] };

export const ALL_SITES: SiteScope = Object.freeze({ kind: 'all' });

export function limitedTo(siteIds: readonly string[]): SiteScope {
  return Object.freeze({ kind: 'limited', siteIds: Object.freeze([...siteIds]) });
}

export interface AccessContextInit {
  userId: string;
  email: string;
  name: string;
  roleKey: RoleKey | null;
  /** Lower is more authoritative. Null when the user holds no role. */
  roleLevel: number | null;
  permissions: Iterable<PermissionKey>;
  siteScope: SiteScope;
  sessionId: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

export class AccessContext {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly roleKey: RoleKey | null;
  readonly roleLevel: number | null;
  readonly siteScope: SiteScope;
  readonly sessionId: string;
  readonly requestId: string | undefined;
  readonly ip: string | undefined;
  readonly userAgent: string | undefined;

  readonly #permissions: ReadonlySet<PermissionKey>;

  constructor(init: AccessContextInit) {
    this.userId = init.userId;
    this.email = init.email;
    this.name = init.name;
    this.roleKey = init.roleKey;
    this.roleLevel = init.roleLevel;
    this.siteScope = init.siteScope;
    this.sessionId = init.sessionId;
    this.requestId = init.requestId;
    this.ip = init.ip;
    this.userAgent = init.userAgent;
    this.#permissions = new Set(init.permissions);
    Object.freeze(this);
  }

  /**
   * Root is the only principal that bypasses site scoping. Derived from the
   * scope shape rather than the role name so a misconfigured role cannot grant
   * the bypass without also granting `all` reach.
   */
  get isRoot(): boolean {
    return this.siteScope.kind === 'all';
  }

  /** Site identifiers this caller may reach, or `null` when unrestricted. */
  get siteIds(): readonly string[] | null {
    return this.siteScope.kind === 'all' ? null : this.siteScope.siteIds;
  }

  get permissions(): ReadonlySet<PermissionKey> {
    return this.#permissions;
  }

  // -- Permission checks -----------------------------------------------------

  can(permission: PermissionKey): boolean {
    return this.#permissions.has(permission);
  }

  canAny(...permissions: readonly PermissionKey[]): boolean {
    return permissions.some((p) => this.#permissions.has(p));
  }

  canAll(...permissions: readonly PermissionKey[]): boolean {
    return permissions.every((p) => this.#permissions.has(p));
  }

  /** @throws {ForbiddenError} */
  requirePermission(permission: PermissionKey): void {
    if (!this.can(permission)) {
      throw new ForbiddenError('You do not have permission to perform this action.', {
        required: permission,
      });
    }
  }

  /** @throws {ForbiddenError} */
  requireAnyPermission(...permissions: readonly PermissionKey[]): void {
    if (!this.canAny(...permissions)) {
      throw new ForbiddenError('You do not have permission to perform this action.', {
        requiredAnyOf: permissions,
      });
    }
  }

  // -- Site checks -----------------------------------------------------------

  hasSite(siteId: string): boolean {
    return this.siteScope.kind === 'all' || this.siteScope.siteIds.includes(siteId);
  }

  /**
   * Guards a write or read aimed at one specific site.
   *
   * @throws {SiteAccessDeniedError} Surfaces as 404 so the caller cannot learn
   *   whether the site exists.
   */
  requireSite(siteId: string): void {
    if (!this.hasSite(siteId)) {
      throw new SiteAccessDeniedError([siteId]);
    }
  }

  /**
   * Guards a bulk operation. Reports every offending identifier at once so the
   * audit entry records the full attempt rather than only the first rejection.
   *
   * @throws {SiteAccessDeniedError}
   */
  requireSites(siteIds: readonly string[]): void {
    if (this.siteScope.kind === 'all') return;

    const allowed = new Set(this.siteScope.siteIds);
    const denied = siteIds.filter((id) => !allowed.has(id));
    if (denied.length > 0) {
      throw new SiteAccessDeniedError(denied);
    }
  }

  /**
   * Narrows a requested site filter to what the caller may actually see.
   *
   * Use this for list endpoints, where a user picking a site they cannot reach
   * should quietly see nothing rather than trip a security error — the site
   * picker is user input, not an attack. Point-lookups use {@link requireSite}.
   */
  narrowSiteFilter(requested: readonly string[] | undefined): readonly string[] | null {
    if (this.siteScope.kind === 'all') {
      return requested && requested.length > 0 ? requested : null;
    }
    if (!requested || requested.length === 0) {
      return this.siteScope.siteIds;
    }
    const allowed = new Set(this.siteScope.siteIds);
    return requested.filter((id) => allowed.has(id));
  }

  /**
   * An ACTIVE user with no site assigned can reach no data at all. Endpoints
   * call this to return an actionable message instead of an empty table that
   * looks like a bug.
   *
   * @throws {NoSitesAssignedError}
   */
  requireAnySite(): void {
    if (this.siteScope.kind === 'limited' && this.siteScope.siteIds.length === 0) {
      throw new NoSitesAssignedError();
    }
  }

  /**
   * Whether this caller outranks the given role level.
   *
   * Strict inequality, so a peer cannot edit a peer. Without it an admin could
   * assign their own role — or one above it — to someone else, and privilege
   * escalation would only need one cooperating account at the same level.
   */
  outranks(level: number | null): boolean {
    if (this.isRoot) return true;
    if (this.roleLevel === null) return false;
    if (level === null) return true;
    return this.roleLevel < level;
  }

  /** @throws {ForbiddenError} */
  requireOutranks(level: number | null, subject: string): void {
    if (!this.outranks(level)) {
      throw new ForbiddenError(
        `You cannot manage ${subject} at or above your own role level.`,
      );
    }
  }

  /** Redacted shape for audit entries and structured logs. */
  toLogContext(): Record<string, unknown> {
    return {
      userId: this.userId,
      email: this.email,
      role: this.roleKey,
      isRoot: this.isRoot,
      siteCount: this.siteScope.kind === 'all' ? 'all' : this.siteScope.siteIds.length,
      sessionId: this.sessionId,
      requestId: this.requestId,
    };
  }
}
