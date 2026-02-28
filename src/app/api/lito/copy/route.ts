export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAcceptedBusinessMembershipContext } from '@/lib/authz';
import { toLitoMemberRole } from '@/lib/ai/lito-rbac';
import { resolveLitoCopyStatus } from '@/lib/ai/copy-status';
import { resolveProvider } from '@/lib/ai/provider';
import { getDraftUsage } from '@/lib/ai/quota';
import { parseStoredGeneratedCopy, type LitoGeneratedCopy } from '@/lib/ai/lito-copy';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateQuery } from '@/lib/validations';

const QuerySchema = z.object({
  biz_id: z.string().uuid(),
  recommendation_id: z.string().uuid(),
});

type RecommendationRow = {
  id: string;
  biz_id: string;
  org_id: string;
  generated_copy: unknown;
  copy_short: string | null;
  copy_long: string | null;
  hashtags: string[] | null;
  format: string | null;
  assets_needed: string[] | null;
  steps: unknown;
};

type OrganizationSettingsRow = {
  id: string;
  ai_provider: string | null;
  lito_staff_ai_paused: boolean | null;
};

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function fallbackCopyFromColumns(row: RecommendationRow): LitoGeneratedCopy | null {
  if (!row.copy_short && !row.copy_long) return null;

  const steps = Array.isArray(row.steps)
    ? row.steps.filter((item): item is string => typeof item === 'string')
    : [];
  const assets = Array.isArray(row.assets_needed)
    ? row.assets_needed.filter((item): item is string => typeof item === 'string')
    : [];
  const hashtags = Array.isArray(row.hashtags)
    ? row.hashtags.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    caption_short: row.copy_short || '',
    caption_long: row.copy_long || row.copy_short || '',
    hashtags,
    shotlist: [],
    image_idea: '',
    execution_checklist: steps,
    stickers: [],
    director_notes: [],
    assets_needed: assets,
    format: row.format === 'story' || row.format === 'reel' ? row.format : 'post',
    language: 'ca',
    channel: 'instagram',
    tone: 'neutral',
  };
}

export async function GET(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/lito/copy' });

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

    const [query, queryErr] = validateQuery(request, QuerySchema);
    if (queryErr) return withStandardHeaders(queryErr, requestId);
    const payload = query as z.infer<typeof QuerySchema>;

    const access = await getAcceptedBusinessMembershipContext({
      supabase,
      userId: user.id,
      businessId: payload.biz_id,
    });
    const memberRole = toLitoMemberRole(access.role);
    if (!access.allowed || !memberRole) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const admin = createAdminClient();
    const { data: recommendationData, error: recommendationErr } = await admin
      .from('recommendation_log')
      .select('id, biz_id, org_id, generated_copy, copy_short, copy_long, hashtags, format, assets_needed, steps')
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
    const copy = parseStoredGeneratedCopy(recommendation.generated_copy) || fallbackCopyFromColumns(recommendation);
    const quota = await getDraftUsage(supabase, recommendation.org_id);
    const { data: orgData } = await admin
      .from('organizations')
      .select('id, ai_provider, lito_staff_ai_paused')
      .eq('id', recommendation.org_id)
      .maybeSingle();
    const orgSettings = (orgData || null) as OrganizationSettingsRow | null;
    const providerState = resolveProvider({
      orgProvider: orgSettings?.ai_provider ?? null,
    });
    const copyStatus = resolveLitoCopyStatus({
      providerState,
      paused: memberRole === 'staff' && Boolean(orgSettings?.lito_staff_ai_paused),
    });

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        copy,
        quota,
        ai: {
          available: copyStatus.enabled,
          provider: copyStatus.provider,
          reason: copyStatus.reason,
        },
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_copy_get_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
