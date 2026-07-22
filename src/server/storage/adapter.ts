import type { Readable } from 'node:stream';

/**
 * Object storage abstraction.
 *
 * Everything above this interface is provider-agnostic, so moving between
 * MinIO, Cloudflare R2, AWS S3, and DigitalOcean Spaces is a configuration
 * change rather than a code change. The S3 implementation covers all four,
 * because all four speak the S3 API — but the seam exists so a provider that
 * does not (a local disk driver for tests, say) can be dropped in without the
 * gallery knowing.
 */

export interface PutObjectOptions {
  contentType: string;
  /** Cache-Control for the stored object. Assets are immutable by key. */
  cacheControl?: string;
  /** Object metadata; kept small, since providers cap total header size. */
  metadata?: Record<string, string>;
}

export interface PutObjectResult {
  key: string;
  /** Publicly reachable URL, if the object was stored under a public prefix. */
  url: string;
  size: number;
}

export interface StorageAdapter {
  /** Uploads bytes. Overwrites silently if the key already exists. */
  put(
    key: string,
    body: Buffer | Uint8Array,
    options: PutObjectOptions,
  ): Promise<PutObjectResult>;

  /**
   * Streams an object back.
   *
   * A stream, not a Buffer: ZIP archives read hundreds of objects in sequence,
   * and buffering each one would put the whole archive in memory.
   */
  get(key: string): Promise<Readable>;

  delete(key: string): Promise<void>;

  deleteMany(keys: readonly string[]): Promise<void>;

  exists(key: string): Promise<boolean>;

  /**
   * Time-limited URL for a private object.
   *
   * Used for originals: a permanent public URL to a private object is
   * indistinguishable from no access control at all once the link leaks.
   */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;

  /** Permanent URL for objects stored under the public prefix. */
  publicUrl(key: string): string;
}

export class StorageError extends Error {
  readonly key: string | undefined;

  constructor(message: string, key?: string, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.key = key;
    this.cause = cause;
  }
}
