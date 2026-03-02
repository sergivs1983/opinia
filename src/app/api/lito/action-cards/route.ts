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

    if (cached.stale) {
      enqueueInBackground({ supabase, bizId: payload.biz_id, log });
    }

    return withNoStore(
      NextResponse.json({
        ok: true,
        generated_at: cached.generated_at || cached.updated_at || new Date().toISOString(),
        mode,
        cards: sortedCards,
        queue_count: sortedCards.length,
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
