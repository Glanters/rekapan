/* eslint-disable no-console -- this module is the one sanctioned console boundary */

import { isDevelopment } from '@/lib/env';

/**
 * Minimal structured logger.
 *
 * Deliberately dependency-free and small. Swapping in pino or an OTLP exporter
 * later means reimplementing `emit`; nothing else in the codebase touches
 * `console` directly, which is what the lint rule enforces.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MIN_LEVEL: LogLevel = isDevelopment ? 'debug' : 'info';

/**
 * Field names whose values are replaced before anything is written.
 *
 * Matching is on the key, not the value, because a secret that reaches a log
 * cannot be unlogged — log shipping, backups, and screenshots all copy it.
 */
const REDACTED_KEYS = new Set([
  'password',
  'secret',
  'token',
  'accesstoken',
  'access_token',
  'jwt',
  'authorization',
  'signature',
  'cookie',
  'sessionsecret',
  'encryptionkey',
  'apikey',
  'api_key',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = REDACTED_KEYS.has(key.toLowerCase())
      ? '[redacted]'
      : redact(item, depth + 1);
  }
  return output;
}

function emit(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };

  const line = isDevelopment ? entry : JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) =>
    emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) =>
    emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) =>
    emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) =>
    emit('error', message, context),
};
