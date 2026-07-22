import type { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '@/lib/env';

import { logger } from '../logger';
import type { PutObjectOptions, PutObjectResult, StorageAdapter } from './adapter';
import { StorageError } from './adapter';

/**
 * S3-compatible storage.
 *
 * Verified shape across providers:
 *   - MinIO   — path-style addressing, any region string
 *   - R2      — virtual-hosted, region "auto"
 *   - S3      — virtual-hosted, a real region
 *   - Spaces  — virtual-hosted, region must match the endpoint (e.g. "sgp1")
 *
 * The two settings that actually differ are the addressing style and the
 * region, which is why both are explicit environment variables rather than
 * inferred. Guessing them produces 404s on every asset with no useful error.
 */
export class S3StorageAdapter implements StorageAdapter {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #publicBaseUrl: string;

  constructor() {
    this.#bucket = env.S3_BUCKET;
    this.#publicBaseUrl = env.S3_PUBLIC_URL.replace(/\/+$/, '');

    this.#client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  async put(
    key: string,
    body: Buffer | Uint8Array,
    options: PutObjectOptions,
  ): Promise<PutObjectResult> {
    try {
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: key,
          Body: body,
          ContentType: options.contentType,
          // Keys embed a content hash, so an object at a given key never
          // changes and can be cached indefinitely.
          CacheControl: options.cacheControl ?? 'public, max-age=31536000, immutable',
          Metadata: options.metadata,
          // Only the public prefix is world-readable; originals stay private
          // and are reached through signed URLs.
          ACL: key.startsWith('public/') ? 'public-read' : 'private',
        }),
      );

      return { key, url: this.publicUrl(key), size: body.byteLength };
    } catch (cause) {
      logger.error('Object upload failed', {
        key,
        bucket: this.#bucket,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      throw new StorageError('Failed to upload the file.', key, cause);
    }
  }

  async get(key: string): Promise<Readable> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      if (!response.Body) {
        throw new StorageError('Object has no body.', key);
      }
      return response.Body as Readable;
    } catch (cause) {
      if (cause instanceof StorageError) throw cause;
      throw new StorageError('Failed to read the file.', key, cause);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.#client.send(
        new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
    } catch (cause) {
      throw new StorageError('Failed to delete the file.', key, cause);
    }
  }

  async deleteMany(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;

    // The DeleteObjects API caps at 1000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      try {
        await this.#client.send(
          new DeleteObjectsCommand({
            Bucket: this.#bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      } catch (cause) {
        throw new StorageError(
          `Failed to delete a batch of ${batch.length} files.`,
          batch[0],
          cause,
        );
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      return true;
    } catch {
      // HeadObject throws for both "absent" and "no permission"; neither is
      // reachable, which is what the caller is asking about.
      return false;
    }
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    try {
      return await getSignedUrl(
        this.#client,
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
        { expiresIn: expiresInSeconds },
      );
    } catch (cause) {
      throw new StorageError('Failed to sign a URL for the file.', key, cause);
    }
  }

  publicUrl(key: string): string {
    return `${this.#publicBaseUrl}/${key}`;
  }

  /**
   * Round-trips a small object to prove the credentials, bucket, addressing
   * style, and region actually agree. Called by the storage health check —
   * misconfiguration here otherwise surfaces as a failed upload much later.
   */
  async healthCheck(): Promise<{ ok: true } | { ok: false; error: string }> {
    const key = `_healthcheck/${Date.now()}.txt`;
    try {
      await this.put(key, Buffer.from('ok', 'utf8'), { contentType: 'text/plain' });
      const present = await this.exists(key);
      await this.delete(key);
      return present
        ? { ok: true }
        : { ok: false, error: 'Object was not readable after upload.' };
    } catch (cause) {
      return {
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }
}
