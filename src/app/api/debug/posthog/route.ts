export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';

import { track } from '@/lib/analytics/posthog-server';
import { getRequestIdFromHeaders } from '@/lib/request-id';

function withHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);

  await track('test_event_opinia_debug', { where: 'api_debug' }, 'debug-user-1');

  return withHeaders(
    NextResponse.json({ ok: true, request_id: requestId }),
    requestId,
  );
}
