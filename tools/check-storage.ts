/* eslint-disable no-console -- diagnostic CLI; its output is the point */

/**
 * Object-storage connectivity check.
 *
 * Round-trips a small object to prove the credentials, bucket, region, and
 * addressing style actually agree. Run it after changing any S3_* variable:
 * a mismatch otherwise surfaces as a failed upload much later, with an error
 * that names none of the four.
 *
 *   npm run check:storage
 */

import 'dotenv/config';

import { env } from '../src/lib/env';
import { S3StorageAdapter } from '../src/server/storage/s3';

async function main(): Promise<void> {
  console.log('\nObject storage configuration\n');
  console.log(`  endpoint        : ${env.S3_ENDPOINT}`);
  console.log(`  bucket          : ${env.S3_BUCKET}`);
  console.log(`  region          : ${env.S3_REGION}`);
  console.log(`  path style      : ${String(env.S3_FORCE_PATH_STYLE)}`);
  console.log(`  public base URL : ${env.S3_PUBLIC_URL}`);
  console.log(`  access key      : ${env.S3_ACCESS_KEY_ID.slice(0, 4)}…`);

  console.log('\nRound-tripping a test object…\n');

  const adapter = new S3StorageAdapter();
  const result = await adapter.healthCheck();

  if (result.ok) {
    console.log('  PASS — upload, read-back, and delete all succeeded.\n');
    return;
  }

  console.log(`  FAIL — ${result.error}\n`);
  console.log('  Things worth checking, in the order they usually break:');
  console.log('    - region: R2 wants "auto"; S3 and DigitalOcean Spaces want a real');
  console.log(
    '      region matching the endpoint (for sgp1.digitaloceanspaces.com, "sgp1").',
  );
  console.log('    - path style: true for MinIO; false for R2, S3, and Spaces.');
  console.log('    - the bucket exists and the key has write permission on it.\n');
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('\nUnexpected failure:\n', error);
  process.exitCode = 1;
});
