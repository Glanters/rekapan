import Redis from 'ioredis';

import { env, isProduction } from '@/lib/env';

import { logger } from '../logger';

/**
 * Fixed-window rate limiting.
 *
 * Redis-backed so the limit holds across instances; a per-process counter would
 * multiply the effective limit by the number of running instances, which is the
 * opposite of what a limit is for.
 *
 * If Redis is unreachable the limiter degrades to an in-process counter rather
 * than failing the request. That is a deliberate trade: a degraded limit still
 * blunts a brute-force attempt, whereas failing closed would turn a Redis
 * outage into a total login outage. The degradation is logged, loudly and once,
 * because a silently weakened control is worse than none.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

let redis: Redis | null = null;
let redisUnavailable = false;

function getRedis(): Redis | null {
  if (redisUnavailable) return null;
  if (redis) return redis;

  try {
    redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      // Fail fast: a rate-limit check must not become the slowest part of a
      // request while ioredis retries a dead host.
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      commandTimeout: 1_000,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1_000)),
    });

    redis.on('error', (error: Error) => {
      if (!redisUnavailable) {
        redisUnavailable = true;
        logger.error(
          'Redis unavailable — rate limiting has degraded to per-process ' +
            'counters, which do not hold across instances.',
          { error: error.message },
        );
      }
    });

    return redis;
  } catch (error) {
    redisUnavailable = true;
    logger.error('Could not construct the Redis client', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Per-process fallback. Bounded so a flood of distinct keys cannot exhaust memory. */
const memoryCounters = new Map<string, { count: number; expiresAt: number }>();
const MEMORY_LIMIT_ENTRIES = 10_000;

function consumeInMemory(
  key: string,
  limit: number,
  windowSeconds: number,
): RateLimitResult {
  const now = Date.now();

  if (memoryCounters.size > MEMORY_LIMIT_ENTRIES) {
    for (const [k, entry] of memoryCounters) {
      if (entry.expiresAt <= now) memoryCounters.delete(k);
    }
    // Still oversized after pruning: drop the oldest half rather than grow.
    if (memoryCounters.size > MEMORY_LIMIT_ENTRIES) {
      const keys = [...memoryCounters.keys()].slice(0, MEMORY_LIMIT_ENTRIES / 2);
      for (const k of keys) memoryCounters.delete(k);
    }
  }

  const existing = memoryCounters.get(key);
  if (!existing || existing.expiresAt <= now) {
    memoryCounters.set(key, { count: 1, expiresAt: now + windowSeconds * 1_000 });
    return { allowed: true, limit, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.expiresAt - now) / 1_000));

  return {
    allowed: existing.count <= limit,
    limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: existing.count > limit ? retryAfterSeconds : 0,
  };
}

/**
 * Records one hit against a key.
 *
 * @param key - Identifies the bucket, e.g. `login:203.0.113.5`. Callers scope
 *   it themselves so unrelated limits cannot collide.
 * @param limit - Permitted hits per window.
 * @param windowSeconds - Window length.
 */
export async function consume(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const client = getRedis();
  if (!client) return consumeInMemory(key, limit, windowSeconds);

  const namespaced = `ratelimit:${key}`;

  try {
    if (client.status === 'wait' || client.status === 'end') {
      await client.connect();
    }

    // INCR then EXPIRE only on first hit: the window starts when the first
    // request lands and is not extended by later ones, so a steady stream
    // cannot hold the key alive indefinitely.
    const [[, count]] = (await client
      .multi()
      .incr(namespaced)
      .expire(namespaced, windowSeconds, 'NX')
      .exec()) as [[Error | null, number], [Error | null, number]];

    const ttl = count > limit ? await client.ttl(namespaced) : 0;

    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: count > limit ? Math.max(1, ttl) : 0,
    };
  } catch (error) {
    if (!redisUnavailable) {
      redisUnavailable = true;
      logger.error('Rate-limit check failed against Redis; using memory fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return consumeInMemory(key, limit, windowSeconds);
  }
}

/**
 * Limits tuned per surface.
 *
 * Login is by far the tightest: it is the one endpoint where an attacker gains
 * something from volume, and it forwards to Account Center, so an unbounded
 * flood here becomes a flood there.
 */
export const RATE_LIMITS = {
  login: { limit: isProduction ? 8 : 100, windowSeconds: 300 },
  api: { limit: 300, windowSeconds: 60 },
  upload: { limit: 60, windowSeconds: 60 },
  export: { limit: 10, windowSeconds: 300 },
} as const;

/**
 * Best-effort client address.
 *
 * Proxy headers are attacker-controlled unless a trusted proxy sets them, so a
 * deployment behind an untrusted edge must not rely on this for anything but
 * rate limiting — where the worst case is one client sharing a bucket.
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip') ?? 'unknown';
}
