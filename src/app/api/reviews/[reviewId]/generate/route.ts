export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

/**
 * POST /api/reviews/[reviewId]/generate
 *
 * AI Pipeline V2 — Entry point.
 * Validates input → delegates to pipeline orchestrator → returns result.
 *
 * All business logic lives in src/lib/pipeline/.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { createLogger, createRequestId, withRequestId } from '@/lib/logger';
import {
  validateBody,
  validateParams,
  ReviewGenerateBodySchema,
  ReviewGenerateParamsSchema,
  resolveGenerateSeoStrategy,
} from '@/lib/validations';
import { runPipeline } from '@/lib/pipeline';
import type { PipelineInput } from '@/lib/pipeline';
import type { LLMProvider } from '@/lib/llm/provider';
import { requireBizAccess } from '@/lib/api-handler';
import { rateLimitAI, checkDailyAIQuota } from '@/lib/security/ratelimit';

export async function POST(
  request: Request,
  { params }: { params: { reviewId: string } }
) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  let requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  let log = createLogger({ request_id: requestId, route: '/api/reviews/generate' });
  const withResponseRequestId = (res: NextResponse) => {
    res.headers.set('x-request-id', requestId);
    return res;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return withResponseRequestId(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const [routeParams, paramsErr] = validateParams(params, ReviewGenerateParamsSchema);
    if (paramsErr) return withResponseRequestId(paramsErr);

    // ── Validate body ──
    const [body, err] = await validateBody(request, ReviewGenerateBodySchema);
    if (err) return withResponseRequestId(err);

    if (body.request_id) {
      requestId = body.request_id;
      log = withRequestId(log, requestId);
    }

    // ── Load review + business ──
    const { data: review } = await supabase.from('reviews').select('*').eq('id', routeParams.reviewId).single();
    if (!review) return withResponseRequestId(NextResponse.json({ error: 'Review not found' }, { status: 404 }));

    // ── Biz-level guard (defense-in-depth, layer 2 after RLS) ──
    const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId: review.biz_id });
    if (bizGuard) return withResponseRequestId(bizGuard);

    const { data: biz } = await supabase.from('businesses').select('*').eq('id', review.biz_id).single();
    if (!biz) return withResponseRequestId(NextResponse.json({ error: 'Business not found' }, { status: 404 }));

    // ── Bloc 8: Rate limit + AI daily quota ──
    const rlKey = `${review.biz_id}:${user.id}`;
    const rl = await rateLimitAI(rlKey);
    if (!rl.ok) return withResponseRequestId(rl.res);
    const quota = await checkDailyAIQuota(review.biz_id, 'free');
    if (!quota.ok) return withResponseRequestId(quota.res);

    const mismatches = [];
    if (body.platform !== review.source) {
      mismatches.push({ path: 'platform', message: 'Platform does not match review source.', code: 'custom' });
    }
    if (body.rating !== review.rating) {
      mismatches.push({ path: 'rating', message: 'Rating does not match review rating.', code: 'custom' });
    }
    if (mismatches.length > 0) {
      return withResponseRequestId(
        NextResponse.json(
          { error: 'validation_error', message: 'Invalid request body.', details: mismatches },
          { status: 400 }
        )
      );
    }

    const seo_strategy = resolveGenerateSeoStrategy(body.rating);
    log.info('Generate request validated', {
      review_id: routeParams.reviewId,
      platform: body.platform,
      rating: body.rating,
      language: body.language || review.language_detected,
      regenerate: body.regenerate,
      seo_strategy,
    });

    const llmProvider: LLMProvider = biz.llm_provider || 'openai';
    const hasApiKey = llmProvider === 'anthropic'
      ? !!process.env.ANTHROPIC_API_KEY
      : !!process.env.OPENAI_API_KEY;

    // ── Build pipeline input ──
    const input: PipelineInput = {
      reviewId: routeParams.reviewId,
      reviewText: review.review_text as string,
      rating: body.rating,
      review: {
        id: review.id,
        biz_id: review.biz_id,
        org_id: review.org_id,
        language_detected: body.language || review.language_detected,
        sentiment: review.sentiment,
        review_text: review.review_text,
        rating: body.rating,
      },
      biz,
      modifier: body.modifier ?? null,
      userId: user.id,
      requestId,
      llmProvider,
      hasApiKey,
      admin: supabase,
    };

    // ── Run pipeline ──
    const result = await runPipeline(input, log);

    if (!result.ok) {
      return withResponseRequestId(
        NextResponse.json(
          { error: result.error, message: result.message, request_id: requestId, ...result.extra },
          { status: result.status }
        )
      );
    }

    return withResponseRequestId(NextResponse.json({ ...result.data, request_id: requestId }));

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown';
    log.error('Unhandled pipeline error', { error: msg, stack: e instanceof Error ? e.stack?.slice(0, 500) : '' });
    return withResponseRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 }
      )
    );
  }
}
