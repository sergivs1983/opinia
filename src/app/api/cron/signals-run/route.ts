export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';

import { buildHmacHeaders, CronUnavailableError } from '@/lib/cron/hmac';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';

type IntegrationBizRow = {
  biz_id: string | null;
};

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
  const log = createLogger({ request_id: requestId, route: 'POST /api/cron/signals-run' });

  if (!hasValidCronSecret(request)) {
    return jsonNoStore({ error: 'not_found', request_id: requestId }, requestId, 404);
  }

  const path = '/api/_internal/signals/run';
  const admin = createAdminClient();

  const { data: integrationRows, error: integrationError } = await admin
    .from('integrations')
    .select('biz_id')
    .eq('provider', 'google_business')
    .eq('is_active', true)
    .eq('status', 'connected')
    .limit(500);

  if (integrationError) {
    log.error('cron_signals_integrations_query_failed', {
      error_code: integrationError.code || null,
      error: integrationError.message || null,
    });
    return jsonNoStore({ ok: false, code: 'cron_unavailable', request_id: requestId }, requestId, 503);
  }

  const bizIds = Array.from(
    new Set(
      ((integrationRows || []) as IntegrationBizRow[])
        .map((row) => row.biz_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );

  if (bizIds.length === 0) {
    return jsonNoStore(
      {
        ok: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        request_id: requestId,
      },
      requestId,
      200,
    );
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const failures: Array<{ biz_id: string; status: number; error?: string }> = [];

  for (const bizId of bizIds) {
    const body = JSON.stringify({
      biz_id: bizId,
      provider: 'google_business',
      range_days: 7,
    });

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
      processed += 1;

      if (upstream.status === 200) {
        succeeded += 1;
        continue;
      }

      if (upstream.status === 404) {
        skipped += 1;
        continue;
      }

      failed += 1;
      if (failures.length < 10) {
        failures.push({
          biz_id: bizId,
          status: upstream.status,
          error: typeof payload?.error === 'string' ? payload.error : undefined,
        });
      }
    } catch (error) {
      processed += 1;
      failed += 1;
      if (failures.length < 10) {
        failures.push({
          biz_id: bizId,
          status: 503,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return jsonNoStore(
    {
      ok: true,
      processed,
      succeeded,
      failed,
      skipped,
      failures,
      request_id: requestId,
    },
    requestId,
    200,
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return POST(request);
}
