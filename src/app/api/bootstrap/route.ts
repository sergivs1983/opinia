export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

/**
 * POST /api/bootstrap — DEPRECATED
 * Forwards to /api/_internal/bootstrap.
 * Callers should update to use /api/_internal/bootstrap directly.
 */
export async function POST(request: NextRequest) {
  const internalSecret = process.env.INTERNAL_SECRET
    || process.env.INTERNAL_ROUTE_SECRET
    || process.env.CRON_SECRET
    || null;
  if (!internalSecret) {
    return NextResponse.json(
      { error: 'service_unavailable', code: 'INTERNAL_SECRET_MISSING' },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  url.pathname = '/api/_internal/bootstrap';

  // Forward the request including cookies and headers
  const body = await request.text();
  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.set('x-internal-secret', internalSecret);
  forwardHeaders.set('x-timestamp', Date.now().toString());
  forwardHeaders.set('x-nonce', randomUUID());

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: forwardHeaders,
    body: body || undefined,
  });

  const responseData = await response.text();
  const newResponse = new NextResponse(responseData, {
    status: response.status,
    headers: response.headers,
  });

  return newResponse;
}
