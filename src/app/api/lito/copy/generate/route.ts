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
  buildGeneratePrompt,
  buildRefinePrompt,
  mergeModelOutputIntoCopy,
  parseModelOutput,
  type LitoCopyChannel,
  type LitoCopyFormat,
  type LitoCopyTone,
  type LitoGeneratedCopy,
} from '@/lib/ai/lito-copy';
import { consumeQuota } from '@/lib/ai/quota';
import { consumeStaffDailyAction } from '@/lib/ai/staff-rate-limit';
import { getAIProviderState } from '@/lib/ai/provider';
import { createLogger } from '@/lib/logger';
import { callLLM } from '@/lib/llm/provider';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { ensureTemplateOrFallback } from '@/lib/recommendations/d0';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody } from '@/lib/validations';

const GenerateBodySchema = z.object({
  biz_id: z.string().uuid(),
  recommendation_id: z.string().uuid(),
  format: z.enum(['post', 'story', 'reel']).optional(),
  language: z.enum(['ca', 'es', 'en']).optional(),
  channel: z.enum(['instagram', 'tiktok', 'facebook']).optional(),
  tone: z.enum(['formal', 'neutral', 'friendly']).optional(),
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
  country: string | null;
  default_language: string | null;
  formality: string | null;
  ai_instructions: string | null;
  tags: string[] | null;
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

function normalizeChannel(value: string | null | undefined): LitoCopyChannel {
  const normalized = (value || '').toLowerCase();
  if (normalized === 'tiktok' || normalized === 'facebook') return normalized;
  return 'instagram';
}

function normalizeTone(value: string | null | undefined): LitoCopyTone {
  const normalized = (value || '').toLowerCase();
  if (normalized === 'formal' || normalized === 'friendly') return normalized as LitoCopyTone;
  return 'neutral';
}

function normalizeFormat(value: string | null | undefined): LitoCopyFormat {
  const normalized = (value || '').toLowerCase();
  if (normalized === 'story' || normalized === 'reel') return normalized;
  return 'post';
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

async function loadThreadContext(admin: ReturnType<typeof createAdminClient>, bizId: string, recommendationId: string): Promise<string[]> {
  const { data: threadData } = await admin
    .from('lito_threads')
    .select('id')
    .eq('biz_id', bizId)
    .eq('recommendation_id', recommendationId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const threadId = (threadData as { id?: string } | null)?.id;
  if (!threadId) return [];

  const { data: messagesData } = await admin
    .from('lito_messages')
    .select('role, content')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(10);

  const raw = (messagesData || []) as Array<{ role?: string; content?: string }>;
  return raw
    .reverse()
    .map((message) => {
      const role = typeof message.role === 'string' ? message.role : 'user';
      const content = typeof message.content === 'string' ? message.content.trim() : '';
      return content ? `${role}: ${content}` : '';
    })
    .filter(Boolean)
    .slice(-10);
}

async function persistGeneratedCopy(params: {
  admin: ReturnType<typeof createAdminClient>;
  recommendationId: string;
  orgId: string;
  bizId: string;
  copy: LitoGeneratedCopy;
  requestId: string;
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
    generated_copy_status: 'generated',
    generated_copy_updated_at: nowIso,
    last_action_at: nowIso,
  };

  const { error: fullErr } = await params.admin
    .from('recommendation_log')
    .update(fullPayload)
    .eq('id', params.recommendationId);

  if (!fullErr) return true;

  if (!isSchemaMissing(fullErr)) {
    params.log.error('lito_copy_generate_update_failed', {
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
    params.log.error('lito_copy_generate_update_legacy_failed', {
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
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/copy/generate' });
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

    const [body, bodyErr] = await validateBody(request, GenerateBodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof GenerateBodySchema>;

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
        .select('id, name, type, city, country, default_language, formality, ai_instructions, tags')
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

    const { data: ruleData, error: ruleErr } = await admin
      .from('playbook_rules')
      .select('playbook_id, recommendation_template')
      .eq('id', recommendation.rule_id)
      .maybeSingle();
    if (ruleErr || !ruleData) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const { data: playbookData } = await admin
      .from('social_playbooks')
      .select('vertical')
      .eq('id', (ruleData as RuleRow).playbook_id)
      .maybeSingle();

    const language = normalizeLanguage(payload.language || business.default_language);
    const format = normalizeFormat(payload.format || undefined);
    const channel = normalizeChannel(payload.channel || undefined);
    const tone = normalizeTone(payload.tone || business.formality || undefined);
    const providerState = getAIProviderState();

    const idempotencyKey = buildIdempotencyKey({
      org_id: recommendation.org_id,
      biz_id: recommendation.biz_id,
      recommendation_id: recommendation.id,
      action: 'generate',
      instruction: '',
      model: providerState.model,
      lang: language,
      format,
      channel,
      tone,
    });

    const jobAcquire = await acquireLitoCopyJob({
      admin,
      orgId: recommendation.org_id,
      bizId: recommendation.biz_id,
      recommendationId: recommendation.id,
      userId: user.id,
      role: memberRole,
      action: 'generate',
      idempotencyKey,
    });

    log.info('lito_copy_generate_idempotency', {
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
      log.error('lito_copy_generate_quota_failed', {
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

    const vertical = normalizeVertical((playbookData as PlaybookRow | null)?.vertical || business.type);

    const rule = ruleData as RuleRow;
    const template = ensureTemplateOrFallback(rule.recommendation_template);
    const baseCopy = buildDeterministicCopyBase({
      templateRaw: rule.recommendation_template,
      generatedCopyRaw: recommendation.generated_copy,
      vertical,
      signal: (recommendation.signal || {}) as Record<string, unknown>,
      format,
      language,
      channel,
      tone,
    });

    const threadContext = await loadThreadContext(admin, payload.biz_id, payload.recommendation_id);
    const llmPrompt = buildGeneratePrompt({
      businessName: business.name,
      vertical,
      city: business.city,
      language,
      channel,
      tone,
      format: baseCopy.format,
      template: {
        hook: template.hook,
        idea: template.idea,
        cta: template.cta,
      },
      aiInstructions: business.ai_instructions || null,
      threadContext,
    });

    const llmResult = await callLLM({
      provider: providerState.provider,
      model: providerState.model,
      json: true,
      temperature: 0.35,
      maxTokens: 900,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: llmPrompt },
      ],
    });

    const parsed = parseModelOutput(llmResult.content);
    if (!parsed) {
      const retryPrompt = buildRefinePrompt({
        language,
        instruction: 'Reescriu la resposta i retorna estrictament JSON vàlid.',
        current: baseCopy,
      });
      const retry = await callLLM({
        provider: providerState.provider,
        model: providerState.model,
        json: true,
        temperature: 0.2,
        maxTokens: 900,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: retryPrompt },
        ],
      });
      const retryParsed = parseModelOutput(retry.content);
      if (!retryParsed) {
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
      const copy = mergeModelOutputIntoCopy(baseCopy, retryParsed);
      const persisted = await persistGeneratedCopy({
        admin,
        recommendationId: recommendation.id,
        orgId: recommendation.org_id,
        bizId: recommendation.biz_id,
        copy,
        requestId,
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
      const resultPayload = {
        ok: true,
        copy,
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
    }

    const copy = mergeModelOutputIntoCopy(baseCopy, parsed);
    const persisted = await persistGeneratedCopy({
      admin,
      recommendationId: recommendation.id,
      orgId: recommendation.org_id,
      bizId: recommendation.biz_id,
      copy,
      requestId,
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
              mode: 'generate',
              provider: providerState.provider,
              model: providerState.model,
              generated_at: new Date().toISOString(),
            },
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'recommendation_id' },
      );
    if (metaErr && !isSchemaMissing(metaErr)) {
      log.warn('lito_copy_generate_meta_upsert_failed', {
        error_code: metaErr.code || null,
        error: metaErr.message || null,
      });
    }

    const resultPayload = {
      ok: true,
      copy,
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
    log.error('lito_copy_generate_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
