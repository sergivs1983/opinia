export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/_internal/signals/to-weekly
 *
 * HMAC-protected (same INTERNAL_HMAC_SECRET as rollup).
 * Proactively generates weekly signal-backed recommendations for a business
 * without requiring a user session. Designed for cron / webhook triggers.
 *
 * Body: { biz_id: uuid, provider?: 'google_business', week_start?: 'YYYY-MM-DD' }
 * Response: { ok, week_start, created, existing, signal_count, request_id }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import {
  ensureAndGetWeeklyRecommendations,
  getWeekStartMondayIso,
  mapBusinessTypeToVertical,
} from '@/lib/recommendations/d0';
import { validateHmacHeader } from '@/lib/security/hmac';
import { getSignalsForWeek } from '@/lib/signals/d13';
import { createAdminClient } from '@/lib/supabase/admin';

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  provider: z.literal('google_business').default('google_business'),
  week_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'week_start must be YYYY-MM-DD')
    .optional(),
});

type BusinessRow = {
  id: string;
  org_id: string;
  type: string | null;
  default_language: string | null;
};

function jsonNoStore(body: Record<string, unknown>, requestId: string, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/_internal/signals/to-weekly' });

  // ── HMAC auth ────────────────────────────────────────────────────────────────
  const rawBody = await request.text();
  const hmac = validateHmacHeader({
    timestampHeader: request.headers.get('x-opin-timestamp'),
    signatureHeader: request.headers.get('x-opin-signature'),
    method: 'POST',
    pathname: '/api/_internal/signals/to-weekly',
    rawBody,
  });

  if (!hmac.valid) {
    log.warn('HMAC validation failed', { reason: hmac.reason });
    return jsonNoStore({ error: 'Unauthorized', request_id: requestId }, requestId, 401);
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  let payloadRaw: unknown = {};
  if (rawBody.trim().length > 0) {
    try {
      payloadRaw = JSON.parse(rawBody);
    } catch {
      return jsonNoStore(
        { error: 'bad_request', message: 'Invalid JSON body', request_id: requestId },
        requestId,
        400,
      );
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

  const { biz_id } = parsed.data;
  const admin = createAdminClient();

  // ── Load business ─────────────────────────────────────────────────────────────
  const { data: bizData, error: bizError } = await admin
    .from('businesses')
    .select('id, org_id, type, default_language')
    .eq('id', biz_id)
    .eq('is_active', true)
    .maybeSingle();

  if (bizError || !bizData) {
    return jsonNoStore({ error: 'not_found', request_id: requestId }, requestId, 404);
  }

  const biz = bizData as BusinessRow;
  const vertical = mapBusinessTypeToVertical(biz.type);

  // Use caller-supplied week_start (Monday ISO) or compute from today
  const weekStart = parsed.data.week_start ?? getWeekStartMondayIso(new Date());

  // ── Count existing visible recos before generation ───────────────────────────
  const { count: existingCount } = await admin
    .from('recommendation_log')
    .select('id', { count: 'exact', head: true })
    .eq('biz_id', biz_id)
    .eq('week_start', weekStart)
    .in('status', ['shown', 'accepted', 'published']);

  const existingBefore = existingCount ?? 0;

  // ── Load D1.3 signals (informational — drives ensureAndGetWeeklyRecommendations signal detection) ──
  // getSignalsForWeek uses the same biz_insights_daily data that D0 reads internally.
  // We log the signal count but the actual reco generation is handled by D0.
  let signalCount = 0;
  try {
    const signals = await getSignalsForWeek({
      supabase: admin,
      biz_id,
      provider: parsed.data.provider,
      days: 10,
    });
    signalCount = signals.filter((s) => s.type !== 'evergreen').length;
    log.info('signals_loaded', { biz_id, count: signals.length, actionable: signalCount });
  } catch (err) {
    log.warn('signals_load_skipped', { biz_id, error: err instanceof Error ? err.message : 'unknown' });
  }

  // ── Generate / refill weekly recommendations (D0 engine) ─────────────────────
  try {
    const { items } = await ensureAndGetWeeklyRecommendations({
      readClient: admin,
      writeClient: admin,
      bizId: biz.id,
      orgId: biz.org_id,
      vertical,
      weekStart,
      businessDefaultLanguage: biz.default_language,
    });

    const totalAfter = items.length;
    const signalBacked = items.filter((i) => i.source === 'signal').length;
    const created = Math.max(0, totalAfter - existingBefore);

    log.info('to_weekly_done', {
      biz_id,
      week_start: weekStart,
      created,
      existing: existingBefore,
      signal_backed: signalBacked,
    });

    return jsonNoStore(
      {
        ok: true,
        week_start: weekStart,
        created,
        existing: existingBefore,
        signal_count: signalBacked,
        request_id: requestId,
      },
      requestId,
      200,
    );
  } catch (error) {
    log.error('to_weekly_failed', {
      biz_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonNoStore({ error: 'internal', request_id: requestId }, requestId, 500);
  }
}
