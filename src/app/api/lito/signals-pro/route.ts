export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { getOrgEntitlements, getSignalsLevel } from '@/lib/billing/entitlements';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import {
  buildEvergreenSignals,
  getSignalById,
  getSignalsLevelLimit,
  listSignalsForBusiness,
  resolveVertical,
  toSignalCards,
  type SignalCard,
} from '@/lib/signals/pro';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const QuerySchema = z.object({
  biz_id: z.string().uuid(),
  range_days: z
    .preprocess((value) => {
      if (typeof value !== 'string') return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }, z.number().int().min(1).max(30).optional())
    .optional(),
  signal_id: z.string().uuid().optional(),
});

type BusinessRow = {
  id: string;
  org_id: string;
  type: string | null;
};

const LITO_ALLOWED_ROLES = ['owner', 'manager', 'staff'] as const;

function jsonNoStore(body: Record<string, unknown>, requestId: string, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function addDays(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/lito/signals-pro' });

  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return jsonNoStore({ error: 'unauthorized', request_id: requestId }, requestId, 401);
  }

  const parsed = QuerySchema.safeParse({
    biz_id: request.nextUrl.searchParams.get('biz_id'),
    range_days: request.nextUrl.searchParams.get('range_days') || undefined,
    signal_id: request.nextUrl.searchParams.get('signal_id') || undefined,
  });

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

  const access = await hasAcceptedBusinessMembership({
    supabase,
    userId: user.id,
    businessId: payload.biz_id,
    allowedRoles: [...LITO_ALLOWED_ROLES],
  });

  if (!access.allowed) {
    return jsonNoStore({ error: 'not_found', request_id: requestId }, requestId, 404);
  }

  const { data: businessData, error: businessErr } = await supabase
    .from('businesses')
    .select('id, org_id, type')
    .eq('id', payload.biz_id)
    .eq('is_active', true)
    .maybeSingle();

  if (businessErr || !businessData) {
    return jsonNoStore({ error: 'not_found', request_id: requestId }, requestId, 404);
  }

  const business = businessData as BusinessRow;

  let signalsLevel: 'basic' | 'advanced' | 'full' = 'basic';
  try {
    const entitlements = await getOrgEntitlements({
      supabase,
      orgId: business.org_id,
    });
    signalsLevel = getSignalsLevel(entitlements);
  } catch (error) {
    log.warn('signals_pro_entitlements_fallback_basic', {
      biz_id: business.id,
      org_id: business.org_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const signalDay = todayIsoUtc();
  const rangeDays = payload.range_days ?? 7;
  const sinceDay = addDays(signalDay, -(Math.max(1, rangeDays) - 1));
  const signalsLimit = getSignalsLevelLimit(signalsLevel);

  try {
    let cards: SignalCard[] = [];

    if (payload.signal_id) {
      const signal = await getSignalById({
        admin: supabase,
        signalId: payload.signal_id,
        bizId: payload.biz_id,
      });

      if (!signal || !signal.is_active) {
        return jsonNoStore({ error: 'not_found', request_id: requestId }, requestId, 404);
      }

      cards = toSignalCards({
        rows: [signal],
        bizId: payload.biz_id,
        level: signalsLevel,
      });
    } else {
      const rows = await listSignalsForBusiness({
        admin: supabase,
        bizId: payload.biz_id,
        provider: 'google_business',
        sinceDay,
        limit: Math.max(signalsLimit, 5),
      });

      cards = toSignalCards({
        rows,
        bizId: payload.biz_id,
        level: signalsLevel,
      });
    }

    if (cards.length === 0) {
      cards = buildEvergreenSignals({
        bizId: payload.biz_id,
        orgId: business.org_id,
        provider: 'google_business',
        vertical: resolveVertical(business.type),
        limit: signalsLimit,
        signalDay,
      });
    }

    const normalized = cards.slice(0, signalsLimit);

    return jsonNoStore(
      {
        ok: true,
        biz_id: payload.biz_id,
        signals_level: signalsLevel,
        source: normalized.some((card) => card.source === 'signal') ? 'signal' : 'evergreen',
        signals: normalized,
        signal: payload.signal_id ? normalized[0] || null : null,
        request_id: requestId,
      },
      requestId,
      200,
    );
  } catch (error) {
    log.error('signals_pro_fetch_failed', {
      biz_id: payload.biz_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonNoStore({ error: 'internal', request_id: requestId }, requestId, 500);
  }
}
