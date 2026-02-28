export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { createRequestId } from '@/lib/logger';
import { parseTemplateFromGeneratedCopy, ensureTemplateOrFallback } from '@/lib/recommendations/d0';
import { buildHowToGuide, type RecommendationVertical } from '@/lib/recommendations/howto';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateParams } from '@/lib/validations';

const HowToParamsSchema = z.object({
  id: z.string().uuid(),
});

type RecommendationLogRow = {
  id: string;
  biz_id: string;
  rule_id: string;
  generated_copy: unknown;
};

type RuleRow = {
  id: string;
  playbook_id: string;
  trigger_type: string;
  recommendation_template: unknown;
};

type PlaybookRow = {
  id: string;
  vertical: string | null;
};

function mapVertical(value: string | null | undefined): RecommendationVertical {
  const normalized = (value || '').toLowerCase();
  if (normalized === 'restaurant') return 'restaurant';
  if (normalized === 'hotel') return 'hotel';
  return 'general';
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const withHeaders = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withHeaders(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      );
    }

    const [routeParams, paramsError] = validateParams(params, HowToParamsSchema);
    if (paramsError) return withHeaders(paramsError);

    const { data: recommendationData, error: recommendationError } = await supabase
      .from('recommendation_log')
      .select('id, biz_id, rule_id, generated_copy')
      .eq('id', routeParams.id)
      .single();

    if (recommendationError || !recommendationData) {
      return withHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }

    const recommendation = recommendationData as RecommendationLogRow;
    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: recommendation.biz_id,
    });

    if (!access.allowed) {
      return withHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }

    const { data: ruleData, error: ruleError } = await supabase
      .from('playbook_rules')
      .select('id, playbook_id, trigger_type, recommendation_template')
      .eq('id', recommendation.rule_id)
      .single();

    if (ruleError || !ruleData) {
      return withHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }

    const rule = ruleData as RuleRow;
    const { data: playbookData, error: playbookError } = await supabase
      .from('social_playbooks')
      .select('id, vertical')
      .eq('id', rule.playbook_id)
      .single();

    if (playbookError || !playbookData) {
      return withHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }

    const vertical = mapVertical((playbookData as PlaybookRow).vertical);
    const generatedTemplate = parseTemplateFromGeneratedCopy(recommendation.generated_copy);
    const fallbackTemplate = ensureTemplateOrFallback(rule.recommendation_template);
    const template = generatedTemplate || fallbackTemplate;

    const guide = buildHowToGuide({
      vertical,
      format: template.format as 'post' | 'story' | 'reel',
      trigger_type: rule.trigger_type || 'evergreen',
      template: {
        hook: template.hook,
        idea: template.idea,
        cta: template.cta,
        format: template.format as 'post' | 'story' | 'reel',
      },
    });

    return withHeaders(
      NextResponse.json({
        ok: true,
        id: recommendation.id,
        biz_id: recommendation.biz_id,
        vertical,
        guide,
        request_id: requestId,
      }),
    );
  } catch {
    return withHeaders(
      NextResponse.json(
        { error: 'internal', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
