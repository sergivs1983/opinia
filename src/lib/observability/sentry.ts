/**
 * src/lib/observability/sentry.ts — Bloc 9
 *
 * Sentry helpers for OpinIA:
 *
 *   setSentryContextFromRequest(req, opts?)
 *     — Sets request_id, route, method as Sentry tags.
 *     — Optionally tags biz_id and user_id (NEVER email, name, or tokens).
 *
 *   beforeSendPIISafe(event)
 *     — Sentry beforeSend hook: redacts PII in headers, extra, breadcrumbs.
 *     — Applied recursively. Never drops events — only sanitises values.
 *
 * USAGE in a Route Handler:
 *   import { setSentryContextFromRequest } from '@/lib/observability/sentry';
 *   setSentryContextFromRequest(request, { bizId: biz.id, userId: user.id });
 *   Sentry.captureException(err);
 */

import * as Sentry from '@sentry/nextjs';
import type { ErrorEvent, EventHint } from '@sentry/core';
import { getRequestIdFromHeaders } from '@/lib/request-id';

// ─── PII redaction constants ──────────────────────────────────────────────────

/**
 * Header/field names whose VALUES must be redacted (case-insensitive key match).
 */
const REDACT_KEYS = new Set([
  'email',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'set-cookie',
  'api_key',
  'password',
  'secret',
  'jwt',
  'x-api-key',
  'x-auth-token',
  'x-supabase-auth',
]);

/**
 * Value patterns whose presence (in string values) triggers redaction.
 * Matches Supabase JWTs, OpenAI keys, Anthropic keys, Bearer tokens.
 */
const TOKEN_PATTERNS = [
  /^eyJhbGci/,         // JWT header prefix
  /^sk-/,              // OpenAI / Anthropic API key prefix
  /^sk-ant-/,          // Anthropic key prefix
  /^Bearer\s+/i,       // Authorization Bearer
  /^Basic\s+/i,        // Authorization Basic
];

// ─── Recursive value sanitiser ────────────────────────────────────────────────

function isTokenLike(value: string): boolean {
  return TOKEN_PATTERNS.some((re) => re.test(value.trim()));
}

/**
 * redactValue — Returns '[REDACTED]' for known-sensitive field names,
 * or if the string value looks like a token.  Otherwise returns the value as-is.
 */
function redactValue(key: string, value: unknown): unknown {
  if (REDACT_KEYS.has(key.toLowerCase())) return '[REDACTED]';
  if (typeof value === 'string' && value.length > 6 && isTokenLike(value)) {
    return '[REDACTED]';
  }
  return value;
}

/**
 * sanitiseObject — Recursively walk an object/array and redact PII values.
 * Depth-capped at 8 to protect against circular structures.
 */
function sanitiseObject(obj: unknown, depth = 0): unknown {
  if (depth > 8 || obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;   // bare strings: no key context, keep
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitiseObject(item, depth + 1));
  }
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = sanitiseObject(redactValue(k, v), depth + 1);
    }
    return out;
  }
  return obj;
}

// ─── beforeSend hook ──────────────────────────────────────────────────────────

/**
 * beforeSendPIISafe — Sentry beforeSend hook.
 *
 * Sanitises:
 *   - event.request.headers  (Authorization, Cookie, etc.)
 *   - event.extra            (arbitrary extra data)
 *   - event.breadcrumbs[].data  (each breadcrumb's data payload)
 *
 * Never returns null (does not drop events).
 * Export and pass to `Sentry.init({ beforeSend })` in every config file.
 */
export function beforeSendPIISafe(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  // Sanitise request headers
  if (event.request?.headers) {
    event.request.headers = sanitiseObject(event.request.headers) as Record<string, string>;
  }

  // Sanitise extra context
  if (event.extra) {
    event.extra = sanitiseObject(event.extra) as Record<string, unknown>;
  }

  // Sanitise breadcrumbs (Sentry v10: breadcrumbs is Breadcrumb[] directly)
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
      ...crumb,
      data: crumb.data ? (sanitiseObject(crumb.data) as Record<string, unknown>) : crumb.data,
    }));
  }

  return event; // never returns null — only sanitises, never drops events
}

// ─── Request context helper ───────────────────────────────────────────────────

interface SentryRequestOpts {
  /** Business UUID — safe to tag; never use email or business name. */
  bizId?: string;
  /** User UUID — safe to tag; never use email or display name. */
  userId?: string;
}

/**
 * setSentryContextFromRequest — Correlates every Sentry event with the
 * current HTTP request by setting standard tags and scope context.
 *
 * Tags added (all safe, no PII):
 *   request_id  — x-request-id header value (UUID)
 *   route       — URL pathname
 *   method      — HTTP verb
 *   biz_id      — (optional) business UUID
 *   user_id     — (optional) user UUID
 *
 * Call this as early as possible in each Route Handler, before
 * any potential Sentry.captureException() call.
 */
export function setSentryContextFromRequest(
  req: Request,
  opts: SentryRequestOpts = {},
): void {
  const requestId = getRequestIdFromHeaders(new Headers(req.headers));
  const url = new URL(req.url);

  // Set tags on the current scope so they appear on the next captureException.
  Sentry.setTag('request_id', requestId);
  Sentry.setTag('route', url.pathname);
  Sentry.setTag('method', req.method);

  if (opts.bizId) Sentry.setTag('biz_id', opts.bizId);
  if (opts.userId) Sentry.setTag('user_id', opts.userId);

  // Add structured context (visible in Sentry's "Additional Data" panel).
  Sentry.setContext('request_meta', {
    request_id: requestId,
    route: url.pathname,
    method: req.method,
  });
}
