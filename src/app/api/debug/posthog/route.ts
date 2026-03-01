export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';

import { trackAsync } from '@/lib/analytics/posthog-server';
import { getRequestIdFromHeaders } from '@/lib/request-id';

function withHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const configuredSecret = (process.env.POSTHOG_DEBUG_SECRET || '').trim();
  const providedSecret = (request.headers.get('x-debug-secret') || '').trim();

  if (!configuredSecret || providedSecret !== configuredSecret) {
    return withHeaders(
      NextResponse.json({ ok: false, error: 'not_found', request_id: requestId }, { status: 404 }),
      requestId,
    );
  }

  trackAsync('test_event_opinia_debug', { where: 'api_debug' }, 'debug-user-1');

  return withHeaders(
    NextResponse.json({ ok: true, request_id: requestId }),
    requestId,
  );
}
