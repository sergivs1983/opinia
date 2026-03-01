export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAcceptedBusinessMembershipContext } from '@/lib/authz';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { buildHmacHeaders } from '@/lib/security/hmac';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  day_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function jsonNoStore(body: Record<string, unknown>, requestId: string, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function resolveOrigin(request: NextRequest): string | null {
  const origin = request.nextUrl?.origin;
  if (origin && /^https?:\/\//.test(origin)) return origin;
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!host) return null;
  return `${proto}://${host}`;
}

function isValidDayIso(day: string): boolean {
  const d = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === day;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/signals-pro/backfill' });

  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonNoStore({ error: 'unauthorized', request_id: requestId }, requestId, 401);
  }

  let bodyRaw: unknown = {};
  try {
    bodyRaw = await request.json();
  } catch {
    return jsonNoStore({ error: 'bad_request', message: 'Invalid JSON body', request_id: requestId }, requestId, 400);
  }

  const parsed = BodySchema.safeParse(bodyRaw);
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

  if (!isValidDayIso(payload.day_from) || !isValidDayIso(payload.day_to) || payload.day_from > payload.day_to) {
    return jsonNoStore({ error: 'invalid_range', request_id: requestId }, requestId, 422);
  }

  const access = await getAcceptedBusinessMembershipContext({
    supabase,
    userId: user.id,
    businessId: payload.biz_id,
  });

  if (!access.allowed) {
    return jsonNoStore({ error: 'not_found', request_id: requestId }, requestId, 404);
  }

  if (access.normalizedRole !== 'owner' && access.normalizedRole !== 'manager') {
    return jsonNoStore({ error: 'insufficient_role', request_id: requestId }, requestId, 403);
  }

  const secret = process.env.INTERNAL_HMAC_SECRET;
  if (!secret) {
    return jsonNoStore(
      { error: 'service_unavailable', reason: 'missing_internal_hmac_secret', request_id: requestId },
      requestId,
      503,
    );
  }

  const origin = resolveOrigin(request);
  if (!origin) {
    return jsonNoStore({ error: 'service_unavailable', reason: 'missing_origin', request_id: requestId }, requestId, 503);
  }

  const internalPayload = {
    biz_id: payload.biz_id,
    provider: 'google_business' as const,
    day_from: payload.day_from,
    day_to: payload.day_to,
  };

  const rawBody = JSON.stringify(internalPayload);
  const hmacHeaders = buildHmacHeaders({
    method: 'POST',
    pathname: '/api/_internal/signals/backfill',
    rawBody,
    secret,
  });

  let internalResponse: Response;
  try {
    internalResponse = await fetch(`${origin}/api/_internal/signals/backfill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': requestId,
        ...hmacHeaders,
      },
      body: rawBody,
      cache: 'no-store',
    });
  } catch (error) {
    log.error('signals_backfill_internal_call_failed', {
      biz_id: payload.biz_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonNoStore({ error: 'service_unavailable', request_id: requestId }, requestId, 503);
  }

  const internalPayloadJson = await internalResponse.json().catch(() => ({})) as Record<string, unknown>;

  if (internalResponse.status === 401) {
    return jsonNoStore({ error: 'service_unavailable', request_id: requestId }, requestId, 503);
  }

  if (internalResponse.status === 404) {
    return jsonNoStore({ error: 'not_found', request_id: requestId }, requestId, 404);
  }

  if (internalResponse.status === 422) {
    return jsonNoStore({ error: 'invalid_range', request_id: requestId }, requestId, 422);
  }

  if (internalResponse.status !== 200) {
    return jsonNoStore(
      {
        error: String(internalPayloadJson.error || 'service_unavailable'),
        request_id: requestId,
      },
      requestId,
      503,
    );
  }

  return jsonNoStore(
    {
      ok: true,
      processed_days: Number(internalPayloadJson.processed_days || 0),
      rollups_ok: Number(internalPayloadJson.rollups_ok || 0),
      signals_ok: Boolean(internalPayloadJson.signals_ok),
      request_id: requestId,
    },
    requestId,
    200,
  );
}
