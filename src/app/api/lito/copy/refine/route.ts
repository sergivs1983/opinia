export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAcceptedBusinessMembershipContext } from '@/lib/authz';
import {
  acquireLitoCopyJob,
  buildIdempotencyKey,
  markLitoCopyJobFailed,
  markLitoCopyJobSuccess,
} from '@/lib/ai/idempotency';
import {
  buildDeterministicCopyBase,
  buildRefinePrompt,
  mergeModelOutputIntoCopy,
  parseModelOutput,
  parseStoredGeneratedCopy,
  resolveQuickRefineInstruction,
  type LitoQuickRefineMode,
  type LitoGeneratedCopy,
} from '@/lib/ai/lito-copy';
import { consumeQuota } from '@/lib/ai/quota';
import { consumeStaffDailyAction } from '@/lib/ai/staff-rate-limit';
import { getAIProviderState } from '@/lib/ai/provider';
import { createLogger } from '@/lib/logger';
import { callLLM } from '@/lib/llm/provider';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody } from '@/lib/validations';

const QUICK_MODES = [
  'shorter',
  'premium',
  'funny',
  'formal',
  'translate_ca',
  'translate_es',
  'translate_en',
] as const;

const RefineBodySchema = z.object({
  biz_id: z.string().uuid(),
  recommendation_id: z.string().uuid(),
  instruction: z.string().trim().max(800).optional(),
  mode: z.enum(['quick', 'custom']).default('custom'),
  quick_mode: z.enum(QUICK_MODES).optional(),
}).superRefine((value, ctx) => {
  if (value.mode === 'quick' && !value.quick_mode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['quick_mode'],
      message: 'quick_mode_required',
    });
  }
  if (value.mode === 'custom' && (!value.instruction || value.instruction.trim().length < 2)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['instruction'],
      message: 'instruction_required',
    });
  }
});

type RecommendationRow = {
  id: string;
  biz_id: string;
  org_id: string;
  rule_id: string;
  generated_copy: unknown;
  signal: unknown;
};

type RuleRow = {
  playbook_id: string;
  recommendation_template: unknown;
};

type PlaybookRow = {
  vertical: string | null;
};

type BusinessRow = {
  id: string;
  name: string;
  type: string | null;
  city: string | null;
  default_language: string | null;
  formality: string | null;
};

const SYSTEM_PROMPT =
  "Ets LITO, assistent de social media per negocis locals. No inventis dades. Respon en l'idioma demanat. Retorna NOMÉS JSON vàlid segons l'esquema.";

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function normalizeVertical(value: string | null | undefined): 'general' | 'restaurant' | 'hotel' {
  const normalized = (value || '').toLowerCase();
  if (normalized === 'restaurant') return 'restaurant';
  if (normalized === 'hotel') return 'hotel';
  return 'general';
}

function normalizeLanguage(value: string | null | undefined): 'ca' | 'es' | 'en' {
  const normalized = (value || '').toLowerCase();
  if (normalized === 'es' || normalized === 'en') return normalized;
  return 'ca';
}

function isSchemaMissing(error: unknown): boolean {
  const code = ((error as { code?: string })?.code || '').toUpperCase();
  const message = ((error as { message?: string })?.message || '').toLowerCase();
  return (
    code === '42703'
    || code === '42P01'
    || code === 'PGRST204'
    || code === 'PGRST205'
    || message.includes('column')
    || message.includes('schema cache')
  );
}

function resolveInstruction(payload: z.infer<typeof RefineBodySchema>): string {
  if (payload.mode === 'quick' && payload.quick_mode) {
    return resolveQuickRefineInstruction(payload.quick_mode as LitoQuickRefineMode);
  }
  return payload.instruction?.trim() || 'Refina aquest copy mantenint la mateixa intenció.';
}

async function persistRefinedCopy(params: {
  admin: ReturnType<typeof createAdminClient>;
  recommendationId: string;
  copy: LitoGeneratedCopy;
  log: ReturnType<typeof createLogger>;
}): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const fullPayload = {
    format: params.copy.format,
    steps: params.copy.execution_checklist,
    assets_needed: params.copy.assets_needed,
    copy_short: params.copy.caption_short,
    copy_long: params.copy.caption_long,
    hashtags: params.copy.hashtags,
    generated_copy: params.copy,
    generated_copy_status: 'refined',
    generated_copy_updated_at: nowIso,
    last_action_at: nowIso,
  };

  const { error: fullErr } = await params.admin
    .from('recommendation_log')
    .update(fullPayload)
    .eq('id', params.recommendationId);

  if (!fullErr) return true;
  if (!isSchemaMissing(fullErr)) {
    params.log.error('lito_copy_refine_update_failed', {
      error_code: fullErr.code || null,
      error: fullErr.message || null,
      recommendation_id: params.recommendationId,
    });
    return false;
  }

  const legacyPayload = {
    format: params.copy.format,
    steps: params.copy.execution_checklist,
    assets_needed: params.copy.assets_needed,
    copy_short: params.copy.caption_short,
    copy_long: params.copy.caption_long,
    hashtags: params.copy.hashtags,
    generated_copy: JSON.stringify(params.copy),
  };

  const { error: legacyErr } = await params.admin
    .from('recommendation_log')
    .update(legacyPayload)
    .eq('id', params.recommendationId);

  if (legacyErr) {
    params.log.error('lito_copy_refine_update_legacy_failed', {
      error_code: legacyErr.code || null,
      error: legacyErr.message || null,
      recommendation_id: params.recommendationId,
    });
    return false;
  }

  return true;
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/copy/refine' });
  let jobId: string | null = null;

  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withStandardHeaders(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
        requestId,
      );
    }

    const [body, bodyErr] = await validateBody(request, RefineBodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof RefineBodySchema>;

    const access = await getAcceptedBusinessMembershipContext({
      supabase,
      userId: user.id,
      businessId: payload.biz_id,
      allowedRoles: ['owner', 'admin', 'manager', 'responder', 'staff'],
    });
    if (!access.allowed) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }
    const memberRole = access.role || 'responder';

    const admin = createAdminClient();
    const [{ data: recommendationData, error: recommendationErr }, { data: businessData, error: businessErr }] = await Promise.all([
      admin
        .from('recommendation_log')
        .select('id, biz_id, org_id, rule_id, generated_copy, signal')
        .eq('id', payload.recommendation_id)
        .eq('biz_id', payload.biz_id)
        .maybeSingle(),
      admin
        .from('businesses')
        .select('id, name, type, city, default_language, formality')
        .eq('id', payload.biz_id)
        .maybeSingle(),
    ]);

    if (recommendationErr || !recommendationData || businessErr || !businessData) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const recommendation = recommendationData as RecommendationRow;
    const business = businessData as BusinessRow;

    const instruction = resolveInstruction(payload);
    const targetLanguage = normalizeLanguage(business.default_language);

    let current = parseStoredGeneratedCopy(recommendation.generated_copy);
    let ruleData: RuleRow | null = null;
    if (!current) {
      const { data: fetchedRuleData } = await admin
        .from('playbook_rules')
        .select('playbook_id, recommendation_template')
        .eq('id', recommendation.rule_id)
        .maybeSingle();
      ruleData = (fetchedRuleData as RuleRow | null) || null;

      if (ruleData) {
        const { data: playbookData } = await admin
          .from('social_playbooks')
          .select('vertical')
          .eq('id', ruleData.playbook_id)
          .maybeSingle();

        const vertical = normalizeVertical((playbookData as PlaybookRow | null)?.vertical || business.type);
        current = buildDeterministicCopyBase({
          templateRaw: ruleData.recommendation_template,
          generatedCopyRaw: recommendation.generated_copy,
          vertical,
          signal: (recommendation.signal || {}) as Record<string, unknown>,
          language: targetLanguage,
          channel: 'instagram',
          tone: business.formality === 'voste' ? 'formal' : 'neutral',
        });
      }
    }

    if (!current) {
      return withStandardHeaders(
        NextResponse.json(
          { error: 'not_found', message: 'No hi ha cap copy generat encara.', request_id: requestId },
          { status: 404 },
        ),
        requestId,
      );
    }

    const providerState = getAIProviderState();
    const idempotencyKey = buildIdempotencyKey({
      org_id: recommendation.org_id,
      biz_id: recommendation.biz_id,
      recommendation_id: recommendation.id,
      action: 'refine',
      instruction,
      model: providerState.model,
      lang: targetLanguage,
      format: current.format,
      channel: current.channel,
      tone: current.tone,
    });

    const jobAcquire = await acquireLitoCopyJob({
      admin,
      orgId: recommendation.org_id,
      bizId: recommendation.biz_id,
      recommendationId: recommendation.id,
      userId: user.id,
      role: memberRole,
      action: 'refine',
      idempotencyKey,
    });

    log.info('lito_copy_refine_idempotency', {
      recommendation_id: recommendation.id,
      idempotency_key: idempotencyKey,
      state: jobAcquire.state,
    });

    if (jobAcquire.state === 'cached') {
      return withStandardHeaders(
        NextResponse.json({
          ...jobAcquire.result,
          request_id: requestId,
        }),
        requestId,
      );
    }

    if (jobAcquire.state === 'in_flight') {
      return withStandardHeaders(
        NextResponse.json(
          {
            error: 'in_flight',
            message: 'LITO està generant el copy… (uns segons)',
            request_id: requestId,
          },
          { status: 409 },
        ),
        requestId,
      );
    }

    if (jobAcquire.state === 'retry_later') {
      return withStandardHeaders(
        NextResponse.json(
          {
            error: 'retry_later',
            message: 'LITO acaba d\'intentar aquesta acció. Torna-ho a provar en uns segons.',
            request_id: requestId,
          },
          { status: 409 },
        ),
        requestId,
      );
    }

    jobId = jobAcquire.jobId;
    const activeJobId = jobAcquire.jobId;

    if (memberRole === 'staff') {
      const staffLimit = await consumeStaffDailyAction({
        admin,
        userId: user.id,
        limit: 10,
      });
      if (!staffLimit.ok) {
        await markLitoCopyJobFailed({
          admin,
          jobId: activeJobId,
          error: staffLimit.reason,
        });
        if (staffLimit.reason === 'staff_daily_limit') {
          return withStandardHeaders(
            NextResponse.json(
              {
                error: 'staff_daily_limit',
                message: "Has arribat al límit diari d'accions de LITO.",
                limit: staffLimit.limit,
                used: staffLimit.used,
                request_id: requestId,
              },
              { status: 429 },
            ),
            requestId,
          );
        }
        return withStandardHeaders(
          NextResponse.json(
            { error: 'internal', message: "No s'ha pogut validar el límit diari.", request_id: requestId },
            { status: 500 },
          ),
          requestId,
        );
      }
    }

    if (!providerState.available) {
      await markLitoCopyJobFailed({
        admin,
        jobId: activeJobId,
        error: 'ai_unavailable',
      });
      return withStandardHeaders(
        NextResponse.json(
          {
            error: 'ai_unavailable',
            message: 'Activa LITO Copy a Configuració (Admin).',
            request_id: requestId,
          },
          { status: 503 },
        ),
        requestId,
      );
    }

    const quota = await consumeQuota(supabase, recommendation.org_id, 1);
    if (!quota.ok) {
      await markLitoCopyJobFailed({
        admin,
        jobId: activeJobId,
        error: quota.reason || 'quota_failed',
      });
      if (quota.reason === 'quota_exceeded') {
        return withStandardHeaders(
          NextResponse.json(
            {
              error: 'quota_exhausted',
              message: 'Quota mensual assolida. Pots escriure manualment o ampliar el pla.',
              used: quota.used,
              limit: quota.limit,
              remaining: quota.remaining,
              request_id: requestId,
            },
            { status: 402 },
          ),
          requestId,
        );
      }
      log.error('lito_copy_refine_quota_failed', {
        reason: quota.reason || null,
        org_id: recommendation.org_id,
      });
      return withStandardHeaders(
        NextResponse.json(
          { error: 'internal', message: "No s'ha pogut validar la quota ara mateix.", request_id: requestId },
          { status: 500 },
        ),
        requestId,
      );
    }
    const prompt = buildRefinePrompt({
      language: targetLanguage,
      instruction,
      current,
    });

    const llmResult = await callLLM({
      provider: providerState.provider,
      model: providerState.model,
      json: true,
      temperature: 0.35,
      maxTokens: 900,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    });

    const parsed = parseModelOutput(llmResult.content);
    if (!parsed) {
      await markLitoCopyJobFailed({
        admin,
        jobId: activeJobId,
        error: 'invalid_ai_output',
      });
      return withStandardHeaders(
        NextResponse.json(
          { error: 'invalid_ai_output', message: "La resposta de LITO no és vàlida ara mateix.", request_id: requestId },
          { status: 502 },
        ),
        requestId,
      );
    }

    const refined = mergeModelOutputIntoCopy(current, parsed);
    const persisted = await persistRefinedCopy({
      admin,
      recommendationId: recommendation.id,
      copy: refined,
      log,
    });
    if (!persisted) {
      await markLitoCopyJobFailed({
        admin,
        jobId: activeJobId,
        error: 'persist_failed',
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    const { error: metaErr } = await admin
      .from('recommendation_log_meta')
      .upsert(
        {
          recommendation_id: recommendation.id,
          org_id: recommendation.org_id,
          biz_id: recommendation.biz_id,
          internal_meta: {
            lito: {
              mode: 'refine',
              refine_mode: payload.mode,
              quick_mode: payload.quick_mode || null,
              provider: providerState.provider,
              model: providerState.model,
              refined_at: new Date().toISOString(),
            },
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'recommendation_id' },
      );
    if (metaErr && !isSchemaMissing(metaErr)) {
      log.warn('lito_copy_refine_meta_upsert_failed', {
        error_code: metaErr.code || null,
        error: metaErr.message || null,
      });
    }

    const resultPayload = {
      ok: true,
      copy: refined,
      quota: { used: quota.used, limit: quota.limit, remaining: quota.remaining },
    };
    await markLitoCopyJobSuccess({
      admin,
      jobId: activeJobId,
      result: resultPayload,
    });

    return withStandardHeaders(
      NextResponse.json({
        ...resultPayload,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    if (jobId) {
      try {
        await markLitoCopyJobFailed({
          admin: createAdminClient(),
          jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // ignore best-effort job failure marking
      }
    }
    log.error('lito_copy_refine_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
