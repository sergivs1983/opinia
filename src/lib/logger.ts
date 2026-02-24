/**
 * Structured logging for OpinIA pipeline and jobs.
 * Logs JSON to stdout — compatible with Vercel, Datadog, etc.
 */
import type { JsonValue } from '@/types/json';

let _counter = 0;

export function createRequestId(): string {
  return `req_${Date.now()}_${(++_counter).toString(36)}`;
}

export interface LogContext {
  request_id: string;
  biz_id?: string;
  org_id?: string;
  user_id?: string;
  [key: string]: JsonValue | undefined;
}

export interface AppLogger {
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
  child: (extra: Partial<LogContext>) => AppLogger;
}

function log(level: 'info' | 'warn' | 'error', message: string, ctx: LogContext, data?: unknown) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...ctx,
    ...(data ? { data } : {}),
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export function createLogger(ctx: LogContext): AppLogger {
  return {
    info: (msg: string, data?: unknown) => log('info', msg, ctx, data),
    warn: (msg: string, data?: unknown) => log('warn', msg, ctx, data),
    error: (msg: string, data?: unknown) => log('error', msg, ctx, data),
    child: (extra: Partial<LogContext>) => createLogger({ ...ctx, ...extra }),
  };
}

/**
 * Helper to keep request correlation explicit without changing logger behavior.
 */
export function withRequestId(logger: AppLogger, requestId: string): AppLogger {
  return logger.child({ request_id: requestId });
}
