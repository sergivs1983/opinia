export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAcceptedBusinessMembershipContext } from '@/lib/authz';
import { createLogger, createRequestId } from '@/lib/logger';
import {
  ensureAndGetWeeklyRecommendations,
  mapBusinessTypeToVertical,
  type WeeklyRecommendationItem,
} from '@/lib/recommendations/d0';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody, validateParams } from '@/lib/validations';

const FeedbackParamsSchema = z.object({
  id: z.string().uuid(),
});

const FeedbackBodySchema = z.object({
  status: z.enum(['accepted', 'dismissed', 'published']),
});

type RecommendationLogLookupRow = {
  id: string;
  biz_id: string;
  week_start: string;
  status: 'shown' | 'accepted' | 'dismissed' | 'published';
};

type BusinessLookupRow = {
  id: string;
  org_id: string;
  type: string | null;
  default_language: string | null;
};

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/recommendations/[id]/feedback' });

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

    const [routeParams, paramsError] = validateParams(params, FeedbackParamsSchema);
    if (paramsError) return withHeaders(paramsError);

    const [body, bodyError] = await validateBody(request, FeedbackBodySchema);
    if (bodyError) return withHeaders(bodyError);

    const { data: logRowData, error: logRowError } = await supabase
      .from('recommendation_log')
      .select('id, biz_id, week_start, status')
      .eq('id', routeParams.id)
      .single();

    if (logRowError || !logRowData) {
      return withHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }

    const logRow = logRowData as RecommendationLogLookupRow;
    const access = await getAcceptedBusinessMembershipContext({
      supabase,
      userId: user.id,
      businessId: logRow.biz_id,
    });
    if (!access.allowed) {
      return withHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }
    const memberRole = access.role || 'responder';

    if (body.status === 'published' && memberRole === 'staff') {
      return withHeaders(
        NextResponse.json(
          {
            error: 'forbidden',
            message: "No tens permís per marcar aquesta recomanació com a publicada.",
            request_id: requestId,
          },
          { status: 403 },
        ),
      );
    }

    const admin = createAdminClient();
    const { error: updateError } = await admin
      .from('recommendation_log')
      .update({ status: body.status })
      .eq('id', routeParams.id);

    if (updateError) {
      log.error('recommendation feedback update failed', {
        error: updateError.message,
        error_code: updateError.code || null,
        recommendation_id: routeParams.id,
      });
      return withHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      );
    }

    if (body.status === 'published') {
      return withHeaders(
        NextResponse.json({
          ok: true,
          id: routeParams.id,
          status: body.status,
          request_id: requestId,
        }),
      );
    }

    const { data: businessData, error: businessError } = await admin
      .from('businesses')
      .select('id, org_id, type, default_language')
      .eq('id', logRow.biz_id)
      .single();

    if (businessError || !businessData) {
      return withHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }

    const business = businessData as BusinessLookupRow;
    const vertical = mapBusinessTypeToVertical(business.type);

    const { data: visibleBeforeData, error: visibleBeforeError } = await admin
      .from('recommendation_log')
      .select('id')
      .eq('biz_id', business.id)
      .eq('week_start', logRow.week_start)
      .in('status', ['shown', 'accepted', 'published']);

    if (visibleBeforeError) {
      log.error('recommendation feedback visible-before query failed', {
        error: visibleBeforeError.message,
        error_code: visibleBeforeError.code || null,
        biz_id: business.id,
        week_start: logRow.week_start,
      });
      return withHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      );
    }

    const visibleBeforeIds = new Set(
      (visibleBeforeData || [])
        .map((row) => (row as { id?: string }).id)
        .filter((id): id is string => typeof id === 'string'),
    );

    const { items } = await ensureAndGetWeeklyRecommendations({
      readClient: admin,
      writeClient: admin,
      bizId: business.id,
      orgId: business.org_id,
      vertical,
      weekStart: logRow.week_start,
      businessDefaultLanguage: business.default_language,
    });

    const newRecommendation = items.find((item) => !visibleBeforeIds.has(item.id)) || null;
    const replaced = items.length >= 3 && Boolean(newRecommendation);

    return withHeaders(
      NextResponse.json({
        ok: true,
        id: routeParams.id,
        status: body.status,
        replaced,
        new_recommendation: replaced
          ? toReplacementPayload(newRecommendation as WeeklyRecommendationItem)
          : null,
        request_id: requestId,
      }),
    );
  } catch (error) {
    log.error('Unhandled recommendation feedback error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withHeaders(
      NextResponse.json(
        { error: 'internal', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}

function toReplacementPayload(item: WeeklyRecommendationItem) {
  return {
    id: item.id,
    rule_id: item.rule_id,
    week_start: item.week_start,
    generated_at: item.generated_at,
    status: item.status,
    priority: item.priority,
    vertical: item.vertical,
    format: item.format,
    hook: item.hook,
    idea: item.idea,
    cta: item.cta,
    how_to: item.how_to,
    signal_meta: item.signal_meta,
    language: item.language,
    recommendation_template: item.recommendation_template,
  };
}
