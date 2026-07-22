import { z } from 'zod';

/**
 * Validated server environment.
 *
 * Parsed once at module load so a misconfigured deployment fails at boot with a
 * list of every problem, rather than at 3am inside whichever request first
 * touched the bad variable.
 *
 * Import this module only from server code. It throws if evaluated in a browser
 * bundle, which turns an accidental secret leak into a build-time failure.
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'src/lib/env.ts was imported into client code. It reads server secrets and ' +
      'must never reach the browser bundle. Pass the values you need down as ' +
      'props, or expose them explicitly via NEXT_PUBLIC_* variables.',
  );
}

/** Postgres connection strings are not http(s), so `z.url()` is the wrong tool. */
const postgresUrl = z
  .string()
  .min(1, 'is required')
  .refine(
    (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
    'must start with postgres:// or postgresql://',
  );

/** 32 bytes, hex-encoded — the key size AES-256-GCM requires. */
const encryptionKey = z
  .string()
  .regex(
    /^[0-9a-fA-F]{64}$/,
    'must be 64 hex characters (32 bytes). Generate one with: ' +
      "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Public origin of this app; used for absolute links and cookie scoping. */
  APP_URL: z.url('must be an absolute URL').default('http://localhost:7564'),

  DATABASE_URL: postgresUrl,

  // -- Account Center (identity provider) ----------------------------------
  // Names mirror the Laravel config keys these values came from:
  //   services.accountcenter.uri    -> ACCOUNT_CENTER_URL
  //   services.accountcenter.name   -> ACCOUNT_CENTER_CLIENT_ID
  //   services.accountcenter.secret -> ACCOUNT_CENTER_SECRET
  ACCOUNT_CENTER_URL: z.url('must be an absolute URL'),
  ACCOUNT_CENTER_CLIENT_ID: z.string().min(1, 'is required'),
  /** Hashed with md5 to derive the AES key. Never sent over the wire. */
  ACCOUNT_CENTER_SECRET: z.string().min(1, 'is required'),
  ACCOUNT_CENTER_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  // -- Bootstrap -----------------------------------------------------------
  /**
   * Identifies which Account Center account is seeded as Root and activated
   * automatically. Every other account starts PENDING and needs approval.
   */
  ROOT_EMAIL: z.email('must be a valid email address'),

  // -- Secrets -------------------------------------------------------------
  /**
   * NOT YET CONSUMED. Reserved for signing CSRF tokens once that middleware
   * lands; session cookies do not use it, because they carry 256 bits of
   * randomness and are matched by digest, which a signature would not improve.
   *
   * Flagged explicitly rather than left to look load-bearing: a validated
   * secret that nothing reads invites the belief that something is protected
   * when nothing is.
   */
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** Encrypts Account Center tokens at rest in the sessions table. */
  ENCRYPTION_KEY: encryptionKey,
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),

  // -- Infrastructure ------------------------------------------------------
  REDIS_URL: z.string().min(1, 'is required').default('redis://localhost:6379'),

  // -- Object storage (S3-compatible: MinIO, Cloudflare R2, AWS S3) --------
  S3_ENDPOINT: z.url('must be an absolute URL'),
  S3_REGION: z.string().min(1).default('auto'),
  S3_BUCKET: z.string().min(1, 'is required'),
  S3_ACCESS_KEY_ID: z.string().min(1, 'is required'),
  S3_SECRET_ACCESS_KEY: z.string().min(1, 'is required'),
  /** Base URL assets are served from; the CDN hostname in production. */
  S3_PUBLIC_URL: z.url('must be an absolute URL'),
  /**
   * MinIO needs path-style addressing; R2 and S3 use virtual-hosted style.
   * Getting this wrong yields 404s on every asset, so it is explicit.
   */
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // -- Limits --------------------------------------------------------------
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(25),
  /**
   * Selections larger than this are handed to a background job instead of
   * streamed inline, so a request cannot hold a connection open for minutes.
   */
  ZIP_SYNC_THRESHOLD: z.coerce.number().int().positive().default(50),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  // Docker image builds run `next build` without runtime secrets present.
  if (process.env.SKIP_ENV_VALIDATION === 'true') {
    return process.env as unknown as Env;
  }

  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'} ${issue.message}`)
      .sort()
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n\n${problems}\n\n` +
        'Copy .env.example to .env and fill in the missing values.\n',
    );
  }

  return parsed.data;
}

export const env: Env = loadEnv();

/** The 32-byte key for at-rest encryption, decoded once. */
export const encryptionKeyBytes: Buffer = Buffer.from(env.ENCRYPTION_KEY, 'hex');

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
