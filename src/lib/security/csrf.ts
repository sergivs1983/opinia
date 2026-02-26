/**
 * src/lib/security/csrf.ts
 *
 * Origin-based CSRF validation for user-facing mutation endpoints.
 *
 * Strategy: compare the request's Origin header (or Referer fallback)
 * to the app's known origin (NEXT_PUBLIC_APP_URL env var or localhost in dev).
 *
 * NO Bearer-token exemption: user endpoints are always browser-originated
 * (session cookie auth). Any call with a Bearer token to a user endpoint
 * is suspicious and should still pass CSRF validation.
 *
 * Internal worker endpoints (/api/_internal/*) are HMAC-protected and do NOT
 * call validateCsrf at all — they're a separate security boundary.
 *
 * Returns:
 *   null            → CSRF check passed, proceed
 *   NextResponse    → 403, abort the request
 *
 * Usage in a route handler:
 *   const csrfErr = validateCsrf(request);
 *   if (csrfErr) return csrfErr;
 */

import { NextResponse } from 'next/server';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate CSRF for a browser-originated mutation.
 * Returns null on success, a 403 NextResponse on failure.
 *
 * No exemptions: every user-endpoint mutation must come from the same origin.
 */
export function validateCsrf(request: Request): NextResponse | null {
  const appOrigin = getAppOrigin();

  // 1. Check Origin header (present in cross-origin requests and same-site fetches)
  const origin = request.headers.get('origin');
  if (origin) {
    if (!isSameOrigin(origin, appOrigin)) {
      return NextResponse.json(
        { error: 'csrf_failed', message: 'Cross-origin request rejected' },
        { status: 403 },
      );
    }
    return null; // Valid origin
  }

  // 2. Fall back to Referer (older browsers / some fetch implementations)
  const referer = request.headers.get('referer');
  if (referer) {
    if (!isSameOriginFromUrl(referer, appOrigin)) {
      return NextResponse.json(
        { error: 'csrf_failed', message: 'Cross-origin request rejected' },
        { status: 403 },
      );
    }
    return null; // Valid referer
  }

  // 3. No Origin or Referer present
  //    - In production: reject (no legitimate browser omits both headers for a POST)
  //    - In development: allow (curl, Postman, local scripts without origin)
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'csrf_failed', message: 'Origin header required' },
      { status: 403 },
    );
  }

  return null; // Dev: allow
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getAppOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function isSameOrigin(origin: string, appOrigin: string): boolean {
  try {
    return new URL(origin).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

function isSameOriginFromUrl(fullUrl: string, appOrigin: string): boolean {
  try {
    return new URL(fullUrl).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}
