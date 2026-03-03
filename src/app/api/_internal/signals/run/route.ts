export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getOrgEntitlements, getSignalsLevel } from '@/lib/billing/entitlements';
import { requireInternalGuard } from '@/lib/internal-guard';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { runSignalsForBusiness, type SignalsLevel } from '@/lib/signals/pro';
import { createAdminClient } from '@/lib/supabase/admin';

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  provider: z.literal('google_business').default('google_business'),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD')
    .optional(),
  range_days: z.number().int().min(1).max(30).optional(),
});

type BusinessRow = {
  id: string;
  org_id: string;
  name: string | null;
  type: string | null;
  default_language: string | null;
};

function jsonNoStore(body: Record<string, unknown>, requestId: string, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/_internal/signals/run' });
  const rawBody = await request.text();

  const blocked = requireInternalGuard(request, {
    requestId,
    mode: 'hmac',
    rawBody,
    pathname: '/api/_internal/signals/run',
  });
  if (blocked) {
    blocked.headers.set('Cache-Control', 'no-store');
    blocked.headers.set('x-request-id', requestId);
    return blocked;
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
      {
        error: 'bad_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
        request_id: requestId,
      },
      requestId,
      400,
    );
  }

  const payload = parsed.data;
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

  const business = businessData as BusinessRow;

  let signalsLevel: SignalsLevel = 'basic';
  try {
    const entitlements = await getOrgEntitlements({
      supabase: admin,
      orgId: business.org_id,
    });
    signalsLevel = getSignalsLevel(entitlements);
  } catch (error) {
    log.warn('signals_worker_entitlements_fallback_basic', {
      biz_id: business.id,
      org_id: business.org_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const result = await runSignalsForBusiness({
      admin,
      business,
      provider: payload.provider,
      signalsLevel,
      signalDay: payload.day ?? todayIsoUtc(),
      rangeDays: payload.range_days ?? 7,
    });

    return jsonNoStore(
      {
        ok: true,
        biz_id: business.id,
        org_id: business.org_id,
        provider: payload.provider,
        signals_level: signalsLevel,
        processed: result.processed,
        active: result.active,
        deactivated: result.deactivated,
        signal_day: result.signal_day,
        request_id: requestId,
      },
      requestId,
      200,
    );
  } catch (error) {
    log.error('signals_worker_failed', {
      biz_id: business.id,
      org_id: business.org_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonNoStore({ error: 'internal', request_id: requestId }, requestId, 500);
  }
}
