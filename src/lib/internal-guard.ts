import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { validateHmacHeader } from '@/lib/security/hmac';

type InternalGuardMode = 'secret' | 'hmac' | 'secret_or_hmac' | 'stripe';

type InternalGuardOptions = {
  requestId?: string | null;
  mode?: InternalGuardMode;
  rawBody?: string;
  pathname?: string;
  maxSkewMs?: number;
  allowBearer?: boolean;
  enforceNonce?: boolean;
};

const NONCE_WINDOW_MS = 5 * 60 * 1000;
const NONCE_STORE = new Map<string, number>();

function jsonError(code: string, status: number, requestId?: string | null): NextResponse {
  return NextResponse.json(
    {
      error: 'unauthorized',
      code,
      request_id: requestId || null,
    },
    { status },
  );
}

function timingSafeEqualText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function extractTimestampHeader(request: Request): string | null {
  return request.headers.get('x-timestamp')
    || request.headers.get('x-opin-timestamp');
}

function parseAndValidateTimestamp(
  request: Request,
  options: InternalGuardOptions,
): { ok: true; value: string; parsed: number } | { ok: false; response: NextResponse } {
  const timestamp = extractTimestampHeader(request);
  if (!timestamp || !/^\d+$/.test(timestamp)) {
    return { ok: false, response: jsonError('INTERNAL_BAD_TIMESTAMP', 401, options.requestId) };
  }

  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed)) {
    return { ok: false, response: jsonError('INTERNAL_BAD_TIMESTAMP', 401, options.requestId) };
  }

  const maxSkewMs = options.maxSkewMs ?? NONCE_WINDOW_MS;
  if (Math.abs(Date.now() - parsed) > maxSkewMs) {
    return { ok: false, response: jsonError('INTERNAL_TIMESTAMP_EXPIRED', 401, options.requestId) };
  }

  return { ok: true, value: timestamp, parsed };
}

function cleanupNonceStore(nowMs: number): void {
  for (const [key, expiresAt] of NONCE_STORE.entries()) {
    if (expiresAt <= nowMs) NONCE_STORE.delete(key);
  }
}

function validateNonce(
  request: Request,
  options: InternalGuardOptions,
  mode: InternalGuardMode,
): NextResponse | null {
  const nonce = request.headers.get('x-nonce')?.trim();
  if (!nonce) return null;

  const nowMs = Date.now();
  cleanupNonceStore(nowMs);

  const pathname = options.pathname ?? new URL(request.url).pathname;
  const nonceKey = `${mode}:${pathname}:${nonce}`;
  const existingExpiry = NONCE_STORE.get(nonceKey);
  if (existingExpiry && existingExpiry > nowMs) {
    return jsonError('INTERNAL_NONCE_REPLAY', 403, options.requestId);
  }

  NONCE_STORE.set(nonceKey, nowMs + NONCE_WINDOW_MS);
  return null;
}

function resolveInternalSecret(): string | null {
  return process.env.INTERNAL_SECRET
    || process.env.INTERNAL_ROUTE_SECRET
    || process.env.CRON_SECRET
    || null;
}

function secretHeaderMatches(request: Request, options: InternalGuardOptions): boolean {
  const secret = resolveInternalSecret();
  if (!secret) return false;

  const providedHeader = request.headers.get('x-internal-secret')
    || request.headers.get('x-cron-secret');
  if (providedHeader && timingSafeEqualText(providedHeader, secret)) {
    return true;
  }

  if (options.allowBearer !== false) {
    const auth = request.headers.get('authorization') || '';
    if (auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length).trim();
      if (token && timingSafeEqualText(token, secret)) return true;
    }
  }

  return false;
}

function parseStripeSignature(headerValue: string | null): { timestamp: string | null; signatures: string[] } {
  if (!headerValue) return { timestamp: null, signatures: [] };

  const pairs = headerValue
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  let timestamp: string | null = null;
  const signatures: string[] = [];

  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (!key || !value) continue;
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  }

  return { timestamp, signatures };
}

function stripeSignatureMatches(rawBody: string, headerValue: string | null, secret: string): boolean {
  const parsed = parseStripeSignature(headerValue);
  if (!parsed.timestamp || parsed.signatures.length === 0) return false;

  const expected = createHmac('sha256', secret)
    .update(`${parsed.timestamp}.${rawBody}`)
    .digest('hex');

  for (const candidate of parsed.signatures) {
    try {
      const left = Buffer.from(expected, 'hex');
      const right = Buffer.from(candidate, 'hex');
      if (left.length !== right.length) continue;
      if (timingSafeEqual(left, right)) return true;
    } catch {
      continue;
    }
  }

  return false;
}

function validateStripeTimestamp(
  request: Request,
  options: InternalGuardOptions,
): NextResponse | null {
  const parsed = parseStripeSignature(request.headers.get('stripe-signature'));
  if (!parsed.timestamp || !/^\d+$/.test(parsed.timestamp)) {
    return jsonError('INTERNAL_BAD_TIMESTAMP', 401, options.requestId);
  }
  const ts = Number(parsed.timestamp) * 1000;
  if (!Number.isFinite(ts)) {
    return jsonError('INTERNAL_BAD_TIMESTAMP', 401, options.requestId);
  }
  const maxSkewMs = options.maxSkewMs ?? NONCE_WINDOW_MS;
  if (Math.abs(Date.now() - ts) > maxSkewMs) {
    return jsonError('INTERNAL_TIMESTAMP_EXPIRED', 401, options.requestId);
  }
  return null;
}

/**
 * requireInternalGuard
 *
 * Canonical internal guard for cron/worker/webhook routes.
 * - `secret`: x-internal-secret/x-cron-secret or Bearer token + x-timestamp.
 * - `hmac`: x-hmac-signature/x-opin-signature + x-timestamp + raw body.
 * - `stripe`: stripe-signature + raw body (Stripe HMAC) + timestamp window.
 */
export function requireInternalGuard(
  request: Request,
  options: InternalGuardOptions = {},
): NextResponse | null {
  const mode = options.mode ?? 'secret_or_hmac';

  if (mode === 'stripe') {
    if (typeof options.rawBody !== 'string') {
      return jsonError('INTERNAL_RAW_BODY_REQUIRED', 401, options.requestId);
    }
    const stripeTimestampBlocked = validateStripeTimestamp(request, options);
    if (stripeTimestampBlocked) return stripeTimestampBlocked;

    const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripeSecret) {
      return NextResponse.json(
        { error: 'service_unavailable', code: 'STRIPE_WEBHOOK_SECRET_MISSING', request_id: options.requestId || null },
        { status: 503 },
      );
    }
    const ok = stripeSignatureMatches(options.rawBody, request.headers.get('stripe-signature'), stripeSecret);
    if (!ok) return jsonError('INTERNAL_BAD_SIGNATURE', 401, options.requestId);
    return validateNonce(request, options, mode);
  }

  const timestampCheck = parseAndValidateTimestamp(request, options);
  if (!timestampCheck.ok) return timestampCheck.response;

  if (mode === 'secret') {
    const secret = resolveInternalSecret();
    if (!secret) {
      return NextResponse.json(
        { error: 'service_unavailable', code: 'INTERNAL_SECRET_MISSING', request_id: options.requestId || null },
        { status: 503 },
      );
    }
    if (!secretHeaderMatches(request, options)) {
      return jsonError('INTERNAL_BAD_SECRET', 401, options.requestId);
    }
    return validateNonce(request, options, mode);
  }

  const signatureHeader = request.headers.get('x-hmac-signature')
    || request.headers.get('x-opin-signature');

  if (mode === 'hmac' || signatureHeader) {
    if (typeof options.rawBody !== 'string') {
      return jsonError('INTERNAL_RAW_BODY_REQUIRED', 401, options.requestId);
    }
    const pathname = options.pathname ?? new URL(request.url).pathname;
    const hmac = validateHmacHeader({
      timestampHeader: timestampCheck.value,
      signatureHeader,
      method: request.method,
      pathname,
      rawBody: options.rawBody,
      maxSkewMs: options.maxSkewMs ?? NONCE_WINDOW_MS,
    });
    if (!hmac.valid) {
      return jsonError(`INTERNAL_${hmac.reason?.toUpperCase() || 'BAD_SIGNATURE'}`, 401, options.requestId);
    }
    return validateNonce(request, options, mode);
  }

  // secret_or_hmac fallback when HMAC signature header is missing
  const secret = resolveInternalSecret();
  if (!secret) {
    return NextResponse.json(
      { error: 'service_unavailable', code: 'INTERNAL_SECRET_MISSING', request_id: options.requestId || null },
      { status: 503 },
    );
  }
  if (!secretHeaderMatches(request, options)) {
    return jsonError('INTERNAL_BAD_SECRET', 401, options.requestId);
  }
  return validateNonce(request, options, mode);
}

