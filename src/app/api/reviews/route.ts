export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import {
  createGoogleReviewsProvider,
  ReviewsProviderError,
} from '@/lib/providers/google/google-reviews-provider';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const QuerySchema = z.object({
  biz_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'replied']).optional().default('pending'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

type ReviewRow = {
  id: string;
  provider: string;
  provider_review_id: string | null;
  rating: number;
  text_snippet: string;
  author?: string | null;
  reply_status: 'pending' | 'replied';
  created_at: string;
};

function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function normalizeCandidate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/reviews' });

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

    const parsed = QuerySchema.safeParse({
      biz_id: request.nextUrl.searchParams.get('biz_id') || undefined,
      status: request.nextUrl.searchParams.get('status') || undefined,
      limit: request.nextUrl.searchParams.get('limit') || undefined,
      cursor: request.nextUrl.searchParams.get('cursor') || undefined,
    });

    if (!parsed.success) {
      return withNoStore(
        NextResponse.json({
          error: 'validation_error',
          message: parsed.error.issues[0]?.message || 'Query invàlida',
          request_id: requestId,
        }, { status: 400 }),
        requestId,
      );
    }

    const queryBizId = normalizeCandidate(parsed.data.biz_id || null);
    const headerBizId = normalizeCandidate(request.headers.get('x-biz-id'));
    const bizId = queryBizId || headerBizId;

    const access = await requireBizAccessPatternB(request, bizId, {
      supabase,
      user,
      queryBizId,
      headerBizId,
    });
    if (access instanceof NextResponse) return withNoStore(access, requestId);

    const provider = createGoogleReviewsProvider({ supabase, log });
    const listed = await provider.listReviews(access.bizId, {
      status: parsed.data.status,
      limit: parsed.data.limit,
      cursor: parsed.data.cursor || null,
    });

    const items: ReviewRow[] = listed.items.map((item) => ({
      id: item.id,
      provider: 'google',
      provider_review_id: item.provider_review_id,
      rating: item.rating,
      text_snippet: item.text || '',
      author: item.author_name || null,
      reply_status: item.reply_status,
      created_at: item.created_at,
    }));

    return withNoStore(
      NextResponse.json({
        ok: true,
        items,
        next_cursor: listed.next_cursor || null,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    if (error instanceof ReviewsProviderError) {
      if (error.status >= 500) {
        log.error('reviews_list_failed', {
          error: error.message,
        });
      }
      return withNoStore(
        NextResponse.json(
          { error: error.code, message: error.message, request_id: requestId },
          { status: error.status },
        ),
        requestId,
      );
    }

    log.error('reviews_list_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
