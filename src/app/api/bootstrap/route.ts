export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/bootstrap — DEPRECATED
 * Forwards to /api/_internal/bootstrap.
 * Callers should update to use /api/_internal/bootstrap directly.
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  url.pathname = '/api/_internal/bootstrap';

  // Forward the request including cookies and headers
  const body = await request.text();
  const forwardHeaders = new Headers(request.headers);

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
