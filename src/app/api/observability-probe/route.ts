export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/observability-probe — Bloc 9
 *
 * DEV-ONLY endpoint for verifying the Sentry monitoring pipeline:
 *   1. Sets Sentry context from the incoming request (request_id tag).
 *   2. Captures a test exception — verifiable in the Sentry dashboard.
 *   3. Returns 200 { ok: true }.
 *
 * PROTECTION: returns 404 in production — this probe must NEVER be reachable
 * in a live environment.
 */

import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { setSentryContextFromRequest } from '@/lib/observability/sentry';

export async function GET(request: Request): Promise<NextResponse> {
  // Block in production — return 404, not 403, to avoid leaking the path.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Set Sentry context: request_id, route, method tags.
  setSentryContextFromRequest(request);

  // Capture a sentinel exception so the event appears in Sentry with the
  // correct request_id tag for end-to-end correlation verification.
  Sentry.captureException(new Error('observability probe'));

  return NextResponse.json({ ok: true }, { status: 200 });
}
