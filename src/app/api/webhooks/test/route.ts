export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger, createRequestId } from '@/lib/logger';
import { roleCanManageIntegrations } from '@/lib/roles';
import { buildWebhookTestPayload, sendWebhook, toWebhookTestResponse } from '@/lib/webhooks';
import { validateBody, WebhookTestSchema } from '@/lib/validations';
import type { ContentPlannerChannel } from '@/types/database';

type WebhookBusinessRow = {
  id: string;
  org_id: string;
  name: string;
  default_language: string | null;
  webhook_enabled: boolean | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_channels: string[] | null;
};

type WebhookTestBody = {
  event: 'planner.ready' | 'planner.published';
  webhookUrl?: string;
  channel: ContentPlannerChannel;
  language?: 'ca' | 'es' | 'en';
};

function asLanguage(value: string | null | undefined): 'ca' | 'es' | 'en' {
  if (value === 'es' || value === 'en') return value;
  return 'ca';
}

function asChannels(value: string[] | null | undefined): ContentPlannerChannel[] {
  const allowed = new Set<ContentPlannerChannel>(['ig_story', 'ig_feed', 'ig_reel', 'x', 'threads']);
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ContentPlannerChannel => allowed.has(entry as ContentPlannerChannel));
}

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/webhooks/test' });

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

    const [body, bodyErr] = await validateBody(request, WebhookTestSchema);
    if (bodyErr) return withResponseRequestId(bodyErr);
    const payload = body as WebhookTestBody;

    const businessId = request.headers.get('x-biz-id')?.trim();
    const access = await requireBizAccessPatternB(request, businessId, {
      supabase,
      user,
      headerBizId: businessId || null,
    });
    if (access instanceof NextResponse) return withResponseRequestId(access);
    if (!roleCanManageIntegrations(access.role)) {
      return withResponseRequestId(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }

    const { data: businessData, error: businessError } = await supabase
      .from('businesses')
      .select('id, org_id, name, default_language, webhook_enabled, webhook_url, webhook_secret, webhook_channels')
      .eq('id', access.bizId)
      .single();

    if (businessError || !businessData) {
      return withResponseRequestId(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }

    const businessRow = businessData as WebhookBusinessRow;
    const effectiveBusiness: WebhookBusinessRow = {
      ...businessRow,
      webhook_enabled: payload.webhookUrl ? true : !!businessRow.webhook_enabled,
      webhook_url: payload.webhookUrl?.trim() || businessRow.webhook_url,
      webhook_channels: (() => {
        if (!payload.channel) return businessRow.webhook_channels;
        const base = asChannels(businessRow.webhook_channels);
        return base.includes(payload.channel) ? base : [...base, payload.channel];
      })(),
    };

    const webhookPayload = buildWebhookTestPayload({
      event: payload.event,
      requestId,
      businessId: effectiveBusiness.id,
      businessName: effectiveBusiness.name,
      language: payload.language || asLanguage(businessRow.default_language),
      channel: payload.channel,
    });

    const sendResult = await sendWebhook({
      business: effectiveBusiness,
      event: payload.event,
      payload: webhookPayload,
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
    log.error('Unhandled webhook test error', { error: message });
    return withResponseRequestId(
      NextResponse.json({ error: 'internal_error', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
    );
  }
}
