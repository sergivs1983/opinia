export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';

import { requireBizAccessPatternB } from '@/lib/api-handler';
import { buildHmacHeaders, CronUnavailableError } from '@/lib/cron/hmac';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const INTERNAL_PATH = '/api/_internal/gbp/reviews/sync';

function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function getBizIdCandidate(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/reviews/sync' });

  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withNoStore(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
        requestId,
      );
    }

    const queryBizId = getBizIdCandidate(request.nextUrl.searchParams.get('biz_id'));
    const headerBizId = getBizIdCandidate(request.headers.get('x-biz-id'));
    const bizId = queryBizId || headerBizId;

    const access = await requireBizAccessPatternB(request, bizId, {
      supabase,
      user,
      queryBizId,
      headerBizId,
    });
    if (access instanceof NextResponse) return withNoStore(access, requestId);

    if (access.role !== 'owner' && access.role !== 'manager') {
      return withNoStore(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const body = JSON.stringify({ biz_id: access.bizId });
    let hmacHeaders: { 'x-opin-timestamp': string; 'x-opin-signature': string };

    try {
      hmacHeaders = buildHmacHeaders({
        method: 'POST',
        path: INTERNAL_PATH,
        body,
      });
    } catch (error) {
      if (error instanceof CronUnavailableError) {
        return withNoStore(
          NextResponse.json({ error: 'sync_unavailable', message: 'Sync unavailable', request_id: requestId }, { status: 503 }),
          requestId,
        );
      }
      return withNoStore(
        NextResponse.json({ error: 'sync_unavailable', message: 'Sync unavailable', request_id: requestId }, { status: 503 }),
        requestId,
      );
    }

    const upstream = await fetch(`${request.nextUrl.origin}${INTERNAL_PATH}`, {
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
    if (!upstream.ok) {
      return withNoStore(
        NextResponse.json(
          {
            error: typeof payload?.error === 'string' ? payload.error : 'sync_failed',
            message: typeof payload?.message === 'string' ? payload.message : 'Google reviews sync failed',
            request_id: requestId,
          },
          { status: upstream.status },
        ),
        requestId,
      );
    }

    return withNoStore(
      NextResponse.json({
        ok: true,
        biz_id: access.bizId,
        sync: payload,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('reviews_sync_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
