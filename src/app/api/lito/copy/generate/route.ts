export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { buildIkeaPayload, type IkeaVertical } from '@/lib/lito/ikea';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody } from '@/lib/validations';

const GenerateBodySchema = z.object({
  biz_id: z.string().uuid(),
  recommendation_id: z.string().uuid(),
});

type RecommendationRow = {
  id: string;
  biz_id: string;
  org_id: string;
  rule_id: string;
  generated_copy: string | null;
  signal: unknown;
};

type RuleRow = {
  playbook_id: string;
  recommendation_template: unknown;
};

type PlaybookRow = {
  vertical: string | null;
};

type QuotaRow = {
  allowed: boolean;
  used: number;
  quota_limit: number;
};

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function mapVertical(value: string | null | undefined): IkeaVertical {
  const normalized = (value || '').toLowerCase();
  if (normalized === 'restaurant') return 'restaurant';
  if (normalized === 'hotel') return 'hotel';
  return 'general';
}

function isMissingMetaDependency(error: unknown): boolean {
  const code = ((error as { code?: string })?.code || '').toUpperCase();
  const message = ((error as { message?: string })?.message || '').toLowerCase();
  return code === '42P01' || code === '42703' || code === 'PGRST205' || message.includes('recommendation_log_meta');
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/copy/generate' });

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

    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: payload.biz_id,
      allowedRoles: ['owner', 'admin', 'manager', 'responder'],
    });
    if (!access.allowed) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    const { data: recommendationData, error: recommendationErr } = await admin
      .from('recommendation_log')
      .select('id, biz_id, org_id, rule_id, generated_copy, signal')
      .eq('id', payload.recommendation_id)
      .eq('biz_id', payload.biz_id)
      .maybeSingle();

    if (recommendationErr || !recommendationData) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const recommendation = recommendationData as RecommendationRow;

    const { data: quotaData, error: quotaErr } = await supabase.rpc('consume_draft_quota', {
      p_org_id: recommendation.org_id,
      p_increment: 1,
    });

    if (quotaErr) {
      log.error('lito_copy_generate_quota_failed', {
        error_code: quotaErr.code || null,
        error: quotaErr.message || null,
        org_id: recommendation.org_id,
      });
      return withStandardHeaders(
        NextResponse.json(
          { error: 'internal', message: 'No s\'ha pogut validar la quota ara mateix.', request_id: requestId },
          { status: 500 },
        ),
        requestId,
      );
    }

    const quota = (Array.isArray(quotaData) ? quotaData[0] : quotaData) as QuotaRow | null;
    const used = Number(quota?.used || 0);
    const limit = Number(quota?.quota_limit || 0);
    const remaining = Math.max(limit - used, 0);

    if (!quota?.allowed) {
      return withStandardHeaders(
        NextResponse.json(
          { error: 'quota_exhausted', message: 'Quota mensual assolida. Pots escriure manualment o ampliar el pla.', remaining, used, limit, request_id: requestId },
          { status: 429 },
        ),
        requestId,
      );
    }

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

    const rule = ruleData as RuleRow;
    const { data: playbookData } = await admin
      .from('social_playbooks')
      .select('vertical')
      .eq('id', rule.playbook_id)
      .maybeSingle();
    const vertical = mapVertical((playbookData as PlaybookRow | null)?.vertical);

    const generated = buildIkeaPayload({
      templateRaw: rule.recommendation_template,
      generatedCopyRaw: recommendation.generated_copy,
      vertical,
      signal: (recommendation.signal || {}) as Record<string, unknown>,
    });

    const { error: updateErr } = await admin
      .from('recommendation_log')
      .update({
        format: generated.format,
        steps: generated.steps,
        assets_needed: generated.assets_needed,
        copy_short: generated.copy_short,
        copy_long: generated.copy_long,
        hashtags: generated.hashtags,
      })
      .eq('id', recommendation.id);

    if (updateErr) {
      log.error('lito_copy_generate_update_failed', {
        error_code: updateErr.code || null,
        error: updateErr.message || null,
        recommendation_id: recommendation.id,
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
              generated_at: new Date().toISOString(),
              director_notes: generated.director_notes,
            },
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'recommendation_id' },
      );

    if (metaErr && !isMissingMetaDependency(metaErr)) {
      log.warn('lito_copy_generate_meta_upsert_failed', {
        error_code: metaErr.code || null,
        error: metaErr.message || null,
      });
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        steps: generated.steps,
        director_notes: generated.director_notes,
        copy_short: generated.copy_short,
        copy_long: generated.copy_long,
        hashtags: generated.hashtags,
        assets_needed: generated.assets_needed,
        remaining,
        used,
        limit,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_copy_generate_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
