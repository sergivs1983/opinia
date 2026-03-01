export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';

import { buildHmacHeaders, CronUnavailableError } from '@/lib/cron/hmac';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';

function jsonNoStore(body: Record<string, unknown>, requestId: string, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function hasValidCronSecret(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const provided = request.headers.get('x-cron-secret');
  if (provided && provided === expected) return true;

  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    return token === expected;
  }

  return false;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/cron/social-reminders' });

  if (!hasValidCronSecret(request)) {
    return jsonNoStore({ error: 'not_found', request_id: requestId }, requestId, 404);
  }

  const path = '/api/_internal/social/reminders/run';
  const body = JSON.stringify({});
  let hmacHeaders: { 'x-opin-timestamp': string; 'x-opin-signature': string };

  try {
    hmacHeaders = buildHmacHeaders({
      method: 'POST',
      path,
      body,
    });
  } catch (error) {
    if (error instanceof CronUnavailableError) {
      return jsonNoStore({ ok: false, code: 'cron_unavailable', request_id: requestId }, requestId, 503);
    }
    return jsonNoStore({ ok: false, code: 'cron_unavailable', request_id: requestId }, requestId, 503);
  }

  try {
    const upstream = await fetch(`${request.nextUrl.origin}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': requestId,
        ...hmacHeaders,
      },
      body,
      cache: 'no-store',
    });

    const payload = await upstream.json().catch(() => ({}));
    const responseBody = (payload && typeof payload === 'object')
      ? { ...payload, request_id: requestId }
      : { ok: false, error: 'upstream_invalid_json', request_id: requestId };

    return jsonNoStore(responseBody as Record<string, unknown>, requestId, upstream.status);
  } catch (error) {
    log.error('cron_social_reminders_upstream_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonNoStore({ ok: false, code: 'cron_unavailable', request_id: requestId }, requestId, 503);
  }
}
