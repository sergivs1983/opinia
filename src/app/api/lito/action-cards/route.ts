export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import { getLitoBizAccess } from '@/lib/lito/action-drafts';
import {
  enqueueRebuildCards,
  getLitoCardsCacheByBiz,
  normalizeCachedCards,
} from '@/lib/lito/cards-cache';
import {
  projectCardsForRole,
  sortCardsByPriority,
} from '@/lib/lito/orchestrator';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { ActionCardMode, ActionCardRole } from '@/types/lito-cards';

const QuerySchema = z.object({
  biz_id: z.string().uuid(),
  refresh: z.string().optional(),
});

function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function parseRole(role: string | null | undefined): ActionCardRole | null {
  if (role === 'owner' || role === 'manager' || role === 'staff') return role;
  return null;
}

function parseMode(mode: string | null | undefined): ActionCardMode {
  return mode === 'advanced' ? 'advanced' : 'basic';
}

type CardStateRow = {
  card_id: string;
  state: 'dismissed' | 'snoozed' | 'done';
  snoozed_until: string | null;
};

function shouldHideCardByState(state: CardStateRow | undefined, now: Date): boolean {
  if (!state) return false;
  if (state.state === 'dismissed') return true;
  if (state.state === 'snoozed' || state.state === 'done') {
    if (!state.snoozed_until) return state.state === 'snoozed';
    const snoozedUntil = new Date(state.snoozed_until);
    if (Number.isNaN(snoozedUntil.getTime())) return false;
    return now.getTime() < snoozedUntil.getTime();
  }
  return false;
}

function enqueueInBackground(input: {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  bizId: string;
  log: ReturnType<typeof createLogger>;
}): void {
  void enqueueRebuildCards({ supabase: input.supabase, bizId: input.bizId }).catch((error) => {
    input.log.warn('lito_action_cards_enqueue_failed', {
      biz_id: input.bizId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/lito/action-cards' });

  const parsed = QuerySchema.safeParse({
    biz_id: request.nextUrl.searchParams.get('biz_id'),
    refresh: request.nextUrl.searchParams.get('refresh') || undefined,
  });
  if (!parsed.success) {
    return withNoStore(
      NextResponse.json(
        {
          error: 'bad_request',
          message: parsed.error.issues[0]?.message || 'Query invàlida',
          request_id: requestId,
        },
        { status: 400 },
      ),
      requestId,
    );
  }

  const payload = parsed.data;
  const forceRefresh = payload.refresh === '1' || payload.refresh === 'true';
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return withNoStore(
      NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      requestId,
    );
  }

  const access = await getLitoBizAccess({
    supabase,
    userId: user.id,
    bizId: payload.biz_id,
  });

  const role = parseRole(access.role);
  if (!access.allowed || !access.orgId || !role) {
    return withNoStore(
      NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      requestId,
    );
  }

  try {
    const admin = createAdminClient();
    if (forceRefresh) {
      enqueueInBackground({ supabase, bizId: payload.biz_id, log });
    }
    const cached = await getLitoCardsCacheByBiz({ admin, bizId: payload.biz_id });

    if (!cached) {
      enqueueInBackground({ supabase, bizId: payload.biz_id, log });
      return withNoStore(
        NextResponse.json({
          ok: true,
          generated_at: new Date().toISOString(),
          mode: 'basic',
          cards: [],
          queue_count: 0,
          source: 'empty',
          request_id: requestId,
        }),
        requestId,
      );
    }

    const mode = parseMode(cached.mode);
    const cards = normalizeCachedCards(cached.cards);
    const cardsForRole = projectCardsForRole(cards, role);
    const sortedCards = sortCardsByPriority(cardsForRole);

    let filteredCards = sortedCards;
    if (sortedCards.length > 0) {
      const { data: stateRowsData, error: stateRowsError } = await admin
        .from('lito_card_states')
        .select('card_id, state, snoozed_until')
        .eq('biz_id', payload.biz_id)
        .in('card_id', sortedCards.map((card) => card.id));

      if (stateRowsError) {
        throw new Error(stateRowsError.message || 'lito_card_states_fetch_failed');
      }

      const stateByCardId = new Map(
        ((stateRowsData || []) as CardStateRow[]).map((row) => [row.card_id, row]),
      );
      const now = new Date();
      filteredCards = sortedCards.filter((card) => !shouldHideCardByState(stateByCardId.get(card.id), now));
    }

    if (cached.stale) {
      enqueueInBackground({ supabase, bizId: payload.biz_id, log });
    }

    return withNoStore(
      NextResponse.json({
        ok: true,
        generated_at: cached.generated_at || cached.updated_at || new Date().toISOString(),
        mode,
        cards: filteredCards,
        queue_count: filteredCards.length,
        source: cached.stale ? 'stale' : 'cache',
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_action_cards_failed', {
      biz_id: payload.biz_id,
      user_id: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
