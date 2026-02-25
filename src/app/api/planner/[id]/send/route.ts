export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { sendPlannerItemWebhook, toWebhookTestResponse } from '@/lib/webhooks';
import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { asMembershipRoleFilter, PUBLISH_ROLES } from '@/lib/roles';
import {
  validateBody,
  validateParams,
  PlannerItemParamsSchema,
  PlannerSendSchema,
} from '@/lib/validations';
import type { ContentPlannerChannel } from '@/types/database';

type PlannerItemRow = {
  id: string;
  business_id: string;
  scheduled_at: string;
  channel: ContentPlannerChannel;
  title: string;
  suggestion_id: string | null;
  asset_id: string | null;
};

type PlannerSendBody = {
  event: 'planner.ready' | 'planner.published';
};

type BusinessWebhookRow = {
  id: string;
  org_id: string;
  name: string;
  default_language: string | null;
  webhook_enabled: boolean | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_channels: string[] | null;
};

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/planner/[id]/send' });

  const withResponseRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return withResponseRequestId(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      );
    }

    const [routeParams, paramsErr] = validateParams(params, PlannerItemParamsSchema);
    if (paramsErr) return withResponseRequestId(paramsErr);

    const [body, bodyErr] = await validateBody(request, PlannerSendSchema);
    if (bodyErr) return withResponseRequestId(bodyErr);
    const payload = body as PlannerSendBody;

    const { data: plannerData, error: plannerError } = await supabase
      .from('content_planner_items')
      .select('id, business_id, scheduled_at, channel, title, suggestion_id, asset_id')
      .eq('id', routeParams.id)
      .single();

    if (plannerError || !plannerData) {
      return withResponseRequestId(
        NextResponse.json({ error: 'not_found', message: 'Planner item not found', request_id: requestId }, { status: 404 }),
      );
    }

    const plannerItem = plannerData as PlannerItemRow;
    const workspaceBusinessId = request.headers.get('x-biz-id')?.trim();
    if (workspaceBusinessId && workspaceBusinessId !== plannerItem.business_id) {
      return withResponseRequestId(
        NextResponse.json({ error: 'forbidden', message: 'Planner item does not belong to current workspace', request_id: requestId }, { status: 403 }),
      );
    }

    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id, org_id, name, default_language, webhook_enabled, webhook_url, webhook_secret, webhook_channels')
      .eq('id', plannerItem.business_id)
      .single();

    if (businessError || !businessData) {
      return withResponseRequestId(
        NextResponse.json({ error: 'forbidden', message: 'No access to this business', request_id: requestId }, { status: 403 }),
      );
    }

    const business = businessData as BusinessWebhookRow;
    const publishAccess = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: plannerItem.business_id,
      allowedRoles: asMembershipRoleFilter(PUBLISH_ROLES),
    });
    if (!publishAccess.allowed) {
      return withResponseRequestId(
        NextResponse.json({ error: 'forbidden', message: 'No tens permisos per publicar', request_id: requestId }, { status: 403 }),
      );
    }

    const sendResult = await sendPlannerItemWebhook({
      event: payload.event,
      business,
      plannerItem,
      requestId,
      userId: user.id,
      log,
    });

    const mapped = toWebhookTestResponse(sendResult);
    return withResponseRequestId(
      NextResponse.json({
        ok: mapped.ok,
        status: mapped.status,
        response_code: sendResult.responseCode,
        error: sendResult.error,
        request_id: requestId,
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown';
    log.error('Unhandled planner send webhook error', { error: message });
    return withResponseRequestId(
      NextResponse.json({ error: 'internal_error', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
    );
  }
}
