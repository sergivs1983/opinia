/**
 * Structured logging for OpinIA — privacy-safe, JSON output.
 * Compatible with Vercel, Datadog, etc.
 *
 * Exports:
 *   log            — singleton  (log.info / log.warn / log.error)
 *   createLogger   — contextual factory (backward-compat)
 *   createRequestId — UUID generator   (backward-compat)
 *   withRequestId  — helper            (backward-compat)
 */

// ── PII sanitization ──────────────────────────────────────────────────────────
const PII_KEYS = new Set([
  // identifiers & contact data
  'email', 'author_email', 'phone', 'address', 'author_name',
  // credentials & tokens
  'token', 'access_token', 'refresh_token',
  'authorization', 'api_key', 'password', 'secret', 'cookie', 'set-cookie', 'jwt',
  // user-generated content that may contain personal data
  'review_text', 'transcript', 'content',
]);

function sanitize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = PII_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : sanitize(v);
  }
  return out;
}

// ── Core emit (shared by singleton + contextual logger) ──────────────────────
function emit(
  level: 'info' | 'warn' | 'error',
  message: string,
  extra?: unknown,
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(extra !== undefined ? (sanitize(extra) as object) : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const log = {
  info:  (message: string, meta?: unknown) => emit('info',  message, meta),
  warn:  (message: string, meta?: unknown) => emit('warn',  message, meta),
  error: (message: string, meta?: unknown) => emit('error', message, meta),
};

// ── Backward-compat exports ───────────────────────────────────────────────────
export function createRequestId(): string {
  return crypto.randomUUID();
}

export interface LogContext {
  request_id: string;
  biz_id?: string;
  org_id?: string;
  user_id?: string;
  [key: string]: unknown;
}

export interface AppLogger {
  info:  (msg: string, data?: unknown) => void;
  warn:  (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
  child: (extra: Partial<LogContext>) => AppLogger;
}

function emitWithCtx(
  level: 'info' | 'warn' | 'error',
  message: string,
  ctx: LogContext,
  data?: unknown,
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(sanitize(ctx) as object),
    ...(data !== undefined ? { data: sanitize(data) } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function createLogger(ctx: LogContext): AppLogger {
  return {
    info:  (msg, data?) => emitWithCtx('info',  msg, ctx, data),
    warn:  (msg, data?) => emitWithCtx('warn',  msg, ctx, data),
    error: (msg, data?) => emitWithCtx('error', msg, ctx, data),
    child: (extra) => createLogger({ ...ctx, ...extra }),
  };
}

export function withRequestId(logger: AppLogger, requestId: string): AppLogger {
  return logger.child({ request_id: requestId });
}
