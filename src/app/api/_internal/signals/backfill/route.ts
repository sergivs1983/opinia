export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getOrgEntitlements, getSignalsLevel } from '@/lib/billing/entitlements';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { buildHmacHeaders, validateHmacHeader } from '@/lib/security/hmac';
import { runSignalsForBusiness } from '@/lib/signals/pro';
import { createAdminClient } from '@/lib/supabase/admin';

type BusinessRow = {
  id: string;
  org_id: string;
  name: string | null;
  type: string | null;
  default_language: string | null;
};

type IntegrationRow = {
  id: string;
};

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  provider: z.literal('google_business').default('google_business'),
  day_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function jsonNoStore(body: Record<string, unknown>, requestId: string, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function isValidDayIso(day: string): boolean {
  const d = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === day;
}

function buildDaysInclusive(dayFrom: string, dayTo: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${dayFrom}T00:00:00.000Z`);
  const end = new Date(`${dayTo}T00:00:00.000Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function resolveOrigin(request: NextRequest): string | null {
  const origin = request.nextUrl?.origin;
  if (origin && /^https?:\/\//.test(origin)) return origin;
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!host) return null;
  return `${proto}://${host}`;
}

async function postInternalWorker(params: {
  origin: string;
  pathname: string;
  payload: Record<string, unknown>;
  secret: string;
  requestId: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const rawBody = JSON.stringify(params.payload);
  const hmacHeaders = buildHmacHeaders({
    method: 'POST',
    pathname: params.pathname,
    rawBody,
    secret: params.secret,
  });

  const response = await fetch(`${params.origin}${params.pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': params.requestId,
      ...hmacHeaders,
    },
    body: rawBody,
    cache: 'no-store',
  });

  const parsed = await response.json().catch(() => ({ error: 'upstream_invalid_json' }));
  return {
    status: response.status,
    body: (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {},
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/_internal/signals/backfill' });
  const rawBody = await request.text();
  const secret = process.env.INTERNAL_HMAC_SECRET;

  if (!secret) {
    return jsonNoStore(
      { error: 'service_unavailable', reason: 'missing_internal_hmac_secret', request_id: requestId },
      requestId,
      503,
    );
  }

  const hmac = validateHmacHeader({
    timestampHeader: request.headers.get('x-opin-timestamp'),
    signatureHeader: request.headers.get('x-opin-signature'),
    method: 'POST',
    pathname: '/api/_internal/signals/backfill',
    rawBody,
    secret,
  });

  if (!hmac.valid) {
    return jsonNoStore({ error: 'unauthorized', reason: hmac.reason, request_id: requestId }, requestId, 401);
  }

  let payloadRaw: unknown = {};
  if (rawBody.trim().length > 0) {
    try {
      payloadRaw = JSON.parse(rawBody);
    } catch {
      return jsonNoStore({ error: 'bad_request', message: 'Invalid JSON body', request_id: requestId }, requestId, 400);
    }
  }

  const parsed = BodySchema.safeParse(payloadRaw);
  if (!parsed.success) {
    return jsonNoStore(
      { error: 'bad_request', message: parsed.error.issues[0]?.message ?? 'Invalid request', request_id: requestId },
      requestId,
      400,
    );
  }

  const payload = parsed.data;

  if (!isValidDayIso(payload.day_from) || !isValidDayIso(payload.day_to)) {
    return jsonNoStore({ error: 'invalid_range', request_id: requestId }, requestId, 422);
  }

  if (payload.day_from > payload.day_to) {
    return jsonNoStore({ error: 'invalid_range', request_id: requestId }, requestId, 422);
  }

  const days = buildDaysInclusive(payload.day_from, payload.day_to);
  if (days.length < 1 || days.length > 90) {
    return jsonNoStore({ error: 'invalid_range', request_id: requestId }, requestId, 422);
  }

  const admin = createAdminClient();

  const { data: businessData, error: businessErr } = await admin
    .from('businesses')
    .select('id, org_id, name, type, default_language')
    .eq('id', payload.biz_id)
    .eq('is_active', true)
    .maybeSingle();

  if (businessErr || !businessData) {
    return jsonNoStore({ error: 'not_found', request_id: requestId }, requestId, 404);
  }

  const { data: integrationData, error: integrationErr } = await admin
    .from('integrations')
    .select('id')
    .eq('biz_id', payload.biz_id)
    .eq('provider', payload.provider)
    .eq('is_active', true)
    .limit(1);

  if (integrationErr) {
    log.error('signals_backfill_integration_check_failed', {
      biz_id: payload.biz_id,
      error: integrationErr.message,
      code: integrationErr.code || null,
    });
    return jsonNoStore({ error: 'service_unavailable', request_id: requestId }, requestId, 503);
  }

  const integrations = (integrationData || []) as IntegrationRow[];
  if (integrations.length === 0) {
    return jsonNoStore({ error: 'not_found', request_id: requestId }, requestId, 404);
  }

  const origin = resolveOrigin(request);
  if (!origin) {
    return jsonNoStore({ error: 'service_unavailable', reason: 'missing_origin', request_id: requestId }, requestId, 503);
  }

  let rollupsOk = 0;
  for (const day of days) {
    const rollupResponse = await postInternalWorker({
      origin,
      pathname: '/api/_internal/insights/rollup',
      payload: {
        biz_id: payload.biz_id,
        provider: payload.provider,
        day,
        range_days: 1,
      },
      secret,
      requestId,
    });

    if (rollupResponse.status === 200) {
      rollupsOk += 1;
      continue;
    }

    if (rollupResponse.status === 404) {
      return jsonNoStore({ error: 'not_found', request_id: requestId }, requestId, 404);
    }

    if (rollupResponse.status === 422) {
      return jsonNoStore({ error: 'invalid_range', request_id: requestId }, requestId, 422);
    }

    log.warn('signals_backfill_rollup_failed', {
      biz_id: payload.biz_id,
      day,
      status: rollupResponse.status,
      error: rollupResponse.body?.error || null,
    });
    return jsonNoStore({ error: 'service_unavailable', request_id: requestId }, requestId, 503);
  }

  let signalsLevel: 'basic' | 'advanced' | 'full' = 'basic';
  try {
    const entitlements = await getOrgEntitlements({
      supabase: admin,
      orgId: (businessData as BusinessRow).org_id,
    });
    signalsLevel = getSignalsLevel(entitlements);
  } catch {
    signalsLevel = 'basic';
  }

  const signalsRangeDays = Math.min(days.length, 30);
  try {
    await runSignalsForBusiness({
      admin,
      business: businessData as BusinessRow,
      provider: payload.provider,
      signalsLevel,
      signalDay: payload.day_to,
      rangeDays: signalsRangeDays,
    });
  } catch (error) {
    log.error('signals_backfill_signals_run_failed', {
      biz_id: payload.biz_id,
      day_to: payload.day_to,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonNoStore({ error: 'service_unavailable', request_id: requestId }, requestId, 503);
  }

  return jsonNoStore(
    {
      ok: true,
      processed_days: days.length,
      rollups_ok: rollupsOk,
      signals_ok: true,
      request_id: requestId,
    },
    requestId,
    200,
  );
}
