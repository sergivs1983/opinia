export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getLitoBizAccess } from '@/lib/lito/action-drafts';
import { enqueueRebuildCards } from '@/lib/lito/cards-cache';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trackEvent } from '@/lib/telemetry';
import { validateBody } from '@/lib/validations';

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  card_id: z.string().trim().min(1).max(180),
  action: z.enum(['dismiss', 'snooze', 'done']),
  snooze_hours: z.number().int().min(1).max(168).optional(),
});

type CardState = 'dismissed' | 'snoozed' | 'done';

function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function mapActionToState(action: z.infer<typeof BodySchema>['action']): CardState {
  if (action === 'dismiss') return 'dismissed';
  if (action === 'snooze') return 'snoozed';
  return 'done';
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/cards/state' });

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

    const [body, bodyErr] = await validateBody(request, BodySchema);
    if (bodyErr) return withNoStore(bodyErr, requestId);
    const payload = body as z.infer<typeof BodySchema>;

    const access = await getLitoBizAccess({
      supabase,
      userId: user.id,
      bizId: payload.biz_id,
    });
    if (!access.allowed || !access.orgId || !access.role) {
      return withNoStore(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const canManage = access.role === 'owner' || access.role === 'manager';
    if ((payload.action === 'dismiss' || payload.action === 'snooze') && !canManage) {
      return withNoStore(
        NextResponse.json({ error: 'forbidden', message: 'Cal owner o manager', request_id: requestId }, { status: 403 }),
        requestId,
      );
    }

    const state = mapActionToState(payload.action);
    const now = new Date();
    const snoozeHours = payload.action === 'snooze'
      ? Math.max(1, Math.min(payload.snooze_hours ?? 24, 168))
      : null;
    const snoozedUntil = snoozeHours ? new Date(now.getTime() + (snoozeHours * 60 * 60 * 1000)).toISOString() : null;

    const admin = createAdminClient();
    const { data: stateRow, error: upsertError } = await admin
      .from('lito_card_states')
      .upsert(
        {
          biz_id: payload.biz_id,
          card_id: payload.card_id,
          state,
          snoozed_until: snoozedUntil,
          updated_at: now.toISOString(),
        },
        { onConflict: 'biz_id,card_id' },
      )
      .select('biz_id, card_id, state, snoozed_until, updated_at')
      .single();

    if (upsertError || !stateRow) {
      log.error('lito_card_state_upsert_failed', {
        biz_id: payload.biz_id,
        card_id: payload.card_id,
        action: payload.action,
        error_code: upsertError?.code || null,
        error: upsertError?.message || null,
      });
      return withNoStore(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    if (payload.action === 'done' && payload.card_id.startsWith('review_unanswered:')) {
      await trackEvent({
        supabase,
        orgId: access.orgId,
        userId: user.id,
        name: 'review_marked_done',
        props: {
          biz_id: payload.biz_id,
          card_id: payload.card_id,
          action: payload.action,
          source: 'lito_cards_state',
        },
        requestId,
        sendPosthog: true,
      });
    }

    try {
      await enqueueRebuildCards({
        supabase,
        bizId: payload.biz_id,
      });
    } catch (error) {
      log.warn('lito_card_state_enqueue_failed', {
        biz_id: payload.biz_id,
        card_id: payload.card_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return withNoStore(
      NextResponse.json({
        ok: true,
        state: stateRow,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_card_state_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
