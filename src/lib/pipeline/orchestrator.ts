/**
 * ═══════════════════════════════════════════
 * Pipeline Orchestrator
 * ═══════════════════════════════════════════
 *
 * Chains: Classify → RAG → Generate → Guardrails → Triggers → Save
 * Single entry point for the generate route.
 *
 * All business logic is preserved exactly as it was in the monolithic route.
 * This file only orchestrates — each step lives in its own module.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkUsageLimit, incrementUsage } from '@/lib/billing/plans';
import { sanitizeForPrompt } from '@/lib/api-handler';
import { audit } from '@/lib/audit';
import { addAiUsage, bumpDailyMetric, collectAiUsageByRequestId } from '@/lib/metrics';
import type { ReplyTone } from '@/types/database';

import type { FiredTrigger, GeneratedResponses, PipelineInput, PipelineOutput } from './types';
import { classifyReview, saveTopics } from './classify';
import { buildRAGContext } from './context';
import { buildPrompt, generateDrafts, CircuitOpenError } from './generate';
import { runGuardrails, hasSeoAutofixWarnings, isSeoAutofixWarning } from './guardrails';
import { matchAndFireTriggers } from './triggers';

export { CircuitOpenError };

export type OrchestratorResult = {
  ok: true;
  data: PipelineOutput;
} | {
  ok: false;
  error: string;
  message: string;
  status: number;
  extra?: Record<string, unknown>;
}

export async function runPipeline(
  input: PipelineInput,
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  },
): Promise<OrchestratorResult> {
  const { biz, reviewId, modifier } = input;
  const supabase = createServerSupabaseClient();
  const admin = input.admin;

  // ── PRE-CHECKS ──

  // Panic mode
  if (biz.panic_mode) {
    log.warn('Panic mode active — generation blocked', { panic_reason: biz.panic_reason });
    return {
      ok: false,
      error: 'panic_mode_enabled',
      message: 'La generació IA està aturada (mode pànic). Desactiva-ho a Settings per continuar.',
      status: 409,
      extra: { panic_reason: biz.panic_reason || null },
    };
  }

  // Usage limit
  const usageCheck = await checkUsageLimit(admin, biz.org_id);
  if (!usageCheck.allowed) {
    log.warn('Usage limit reached', { current: usageCheck.current, limit: usageCheck.limit, plan: usageCheck.plan });
    return {
      ok: false,
      error: 'usage_limit',
      message: usageCheck.message || 'Límit d’ús assolit',
      status: 429,
      extra: { usage: { current: usageCheck.current, limit: usageCheck.limit, plan: usageCheck.plan } },
    };
  }

  log.info('Pipeline started', {
    review_id: reviewId,
    modifier,
    provider: input.llmProvider,
    usage: `${usageCheck.current}/${usageCheck.limit}`,
  });

  const safeText = sanitizeForPrompt(input.reviewText);

  // ── STEP 1: Classify ──
  const classification = await classifyReview(input, safeText, log);

  // Save topics (non-blocking)
  saveTopics(reviewId, input.review.biz_id, input.review.org_id, classification, admin);

  // ── STEP 2: RAG + Anti-repetition ──
  const rag = await buildRAGContext(input.review.biz_id, input.reviewText, classification, admin);

  // ── STEP 3: Generate drafts ──
  const prompt = buildPrompt(input, classification, rag, safeText);

  let responses: GeneratedResponses;
  try {
    responses = await generateDrafts(input, prompt, log);
  } catch (e: unknown) {
    if (e instanceof CircuitOpenError) {
      log.error('Circuit open — both providers down', { error: (e as Error).message });
      return {
        ok: false,
        error: 'llm_unavailable',
        message: 'El servei de generació no està disponible temporalment. Reintenta en uns minuts.',
        status: 503,
      };
    }
    throw e; // unexpected — let the route catch it
  }

  // ── STEP 4: Guardrails ──
  let effectiveBiz = biz;
  let guardrailWarnings = runGuardrails(responses, effectiveBiz, rag);

  // ── STEP 4.1: G6 auto-fix (single retry, silent) ──
  if (hasSeoAutofixWarnings(guardrailWarnings)) {
    log.warn('G6 detected — applying SEO fallback regeneration', {
      review_id: reviewId,
      warnings: guardrailWarnings.filter(isSeoAutofixWarning).length,
    });

    try {
      const fallbackBiz = {
        ...biz,
        seo_enabled: false,
        seo_mode: false,
        seo_aggressiveness: 1,
        seo_rules: {
          ...(biz.seo_rules || {
            max_keywords_per_reply: 1,
            avoid_if_negative: true,
            min_rating_for_keywords: 4,
          }),
          max_keywords_per_reply: 1,
        },
      };
      const fallbackInput: PipelineInput = { ...input, biz: fallbackBiz };
      const fallbackPrompt = buildPrompt(fallbackInput, classification, rag, safeText);

      responses = await generateDrafts(fallbackInput, fallbackPrompt, log);
      effectiveBiz = fallbackBiz;
      guardrailWarnings = runGuardrails(responses, effectiveBiz, rag);

      await audit(supabase, {
        orgId: biz.org_id,
        bizId: biz.id,
        userId: input.userId,
        action: 'SEO_FALLBACK_APPLIED',
        targetType: 'review',
        targetId: reviewId,
        metadata: {
          request_id: input.requestId,
          reason: 'g6_seo_keyword_stuffing_or_artificial_list',
        },
      });

      log.info('SEO fallback applied', { review_id: reviewId });
    } catch (fallbackErr: unknown) {
      const msg = fallbackErr instanceof Error ? fallbackErr.message : 'Unknown';
      log.warn('SEO fallback failed (non-blocking)', { review_id: reviewId, error: msg });
    }
  }

  // ── STEP 4.5: Action Triggers ──
  let firedTriggers: FiredTrigger[] = [];
  try {
    firedTriggers = await matchAndFireTriggers(
      admin, biz, reviewId,
      input.reviewText, input.rating,
      classification.sentiment,
      classification.topics || [],
    );
    if (firedTriggers.length > 0) {
      log.info('Triggers fired', { count: firedTriggers.length, triggers: firedTriggers.map(t => t.triggerName) });
    }
  } catch (trigErr: unknown) {
    const msg = trigErr instanceof Error ? trigErr.message : 'Unknown';
    log.warn('Trigger matching failed (non-blocking)', { error: msg });
  }

  // ── SAVE: Delete old drafts, insert new ──
  await supabase.from('replies').delete().eq('review_id', reviewId).eq('status', 'draft');

  const tones: { tone: ReplyTone; content: string }[] = [
    { tone: 'proper', content: responses.option_a },
    { tone: 'professional', content: responses.option_b },
    { tone: 'premium', content: responses.option_c },
  ];

  await supabase.from('replies').insert(
    tones.map(t => ({
      review_id: reviewId,
      biz_id: input.review.biz_id,
      org_id: input.review.org_id,
      tone: t.tone,
      content: t.content,
      status: 'draft' as const,
    }))
  );

  // Update review language if detected
  if (classification.language && classification.language !== input.review.language_detected) {
    await supabase.from('reviews').update({
      language_detected: classification.language,
      sentiment: classification.sentiment,
    }).eq('id', reviewId);
  }

  // ── USAGE: increment after success ──
  await incrementUsage(admin, biz.org_id, 'ai_generations').catch((e: Error) => {
    log.error('Usage increment failed (non-blocking)', { error: e?.message });
  });

  // ── METRICS: replies generated + AI usage (non-blocking) ──
  const metricsDay = new Date().toISOString().slice(0, 10);
  await bumpDailyMetric(
    biz.id,
    metricsDay,
    { replies_generated: 1 },
    { admin, log },
  );

  try {
    const aiUsage = await collectAiUsageByRequestId(biz.id, input.requestId, { admin });
    if (aiUsage.tokensIn > 0 || aiUsage.tokensOut > 0 || aiUsage.costCents > 0) {
      await addAiUsage(
        biz.id,
        metricsDay,
        {
          tokensIn: aiUsage.tokensIn,
          tokensOut: aiUsage.tokensOut,
          costCents: aiUsage.costCents,
        },
        { admin, log },
      );
    }
  } catch (usageErr: unknown) {
    const message = usageErr instanceof Error ? usageErr.message : String(usageErr);
    log.warn('Failed to aggregate AI usage for metrics (non-blocking)', { error: message });
  }

  // ── AUDIT ──
  await audit(supabase, {
    orgId: biz.org_id, bizId: biz.id, userId: input.userId,
    action: 'generate_reply', targetType: 'review', targetId: reviewId,
    metadata: { request_id: input.requestId, provider: input.llmProvider, warnings: guardrailWarnings.length },
  });

  log.info('Pipeline complete', {
    review_id: reviewId,
    warnings: guardrailWarnings.length,
    kb_matched: rag.relevantKB.length,
    topics: classification.topic_details?.length || 0,
  });

  return {
    ok: true,
    data: {
      language_detected: classification.language,
      classification,
      matched_kb: rag.relevantKB.map(e => ({ id: e.id, category: e.category, content: e.content, triggers: e.triggers })),
      option_a: responses.option_a,
      option_b: responses.option_b,
      option_c: responses.option_c,
      guardrail_warnings: guardrailWarnings,
      triggers_fired: firedTriggers,
    },
  };
}
