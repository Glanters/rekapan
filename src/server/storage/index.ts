import { S3StorageAdapter } from './s3';

import type { StorageAdapter } from './adapter';

export type { PutObjectOptions, PutObjectResult, StorageAdapter } from './adapter';
export { StorageError } from './adapter';

/**
 * The storage singleton.
 *
 * One place to swap the provider. Everything else imports `storage` and sees
 * only the {@link StorageAdapter} interface, so a different backend needs no
 * changes above this file.
 */
let instance: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  instance ??= new S3StorageAdapter();
  return instance;
}

export const storage = new Proxy({} as StorageAdapter, {
  get(_target, property) {
    // Lazily constructed: building the S3 client at module load would run
    // during `next build`, where the credentials are not present.
    const adapter = getStorage();
    const value = Reflect.get(adapter, property) as unknown;

    // The bind is load-bearing, not tidiness. An unbound method invoked as
    // `storage.put(...)` receives the Proxy as `this`, and the adapter's
    // private `#bucket` field is not readable through a different object —
    // it fails at runtime with "Cannot read private member", which no amount
    // of type checking would have caught.
    return typeof value === 'function' ? value.bind(adapter) : value;
  },
});
