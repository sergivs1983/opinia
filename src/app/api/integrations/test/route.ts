export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { dispatchEvent } from '@/lib/integrations';
import { validateBody, IntegrationsTestSchema } from '@/lib/validations';
import type { ConnectorRow } from '@/lib/integrations/connectors';
import { hasAcceptedBusinessMembership } from '@/lib/authz';

type TestBody = {
  connectorId: string;
  event: 'planner.ready';
  channel: 'ig_feed' | 'ig_story' | 'ig_reel';
  demo: boolean;
};

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/integrations/test' });

  const withRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return withRequestId(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      );
    }

    const businessId = request.headers.get('x-biz-id')?.trim();
    if (!businessId) {
      return withRequestId(
        NextResponse.json({ error: 'validation_error', message: 'Missing x-biz-id workspace header', request_id: requestId }, { status: 400 }),
      );
    }

    const [body, bodyErr] = await validateBody(request, IntegrationsTestSchema);
    if (bodyErr) return withRequestId(bodyErr);
    const payload = body as TestBody;

    const businessAccess = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId,
      allowedRoles: ['owner', 'admin'],
    });
    if (!businessAccess.allowed) {
      return withRequestId(
        NextResponse.json({ error: 'forbidden', message: 'No tens permisos per gestionar integracions', request_id: requestId }, { status: 403 }),
      );
    }

    const { data: connectorData, error: connectorError } = await supabase
      .from('connectors')
      .select('id, business_id, type, enabled, url, secret, allowed_channels')
      .eq('id', payload.connectorId)
      .eq('business_id', businessId)
      .single();

    if (connectorError || !connectorData) {
      return withRequestId(
        NextResponse.json({ error: 'not_found', message: 'Connector not found', request_id: requestId }, { status: 404 }),
      );
    }

    const connector = connectorData as ConnectorRow;

    const result = await dispatchEvent({
      businessId,
      event: payload.event,
      data: {
        demo: true,
        channel: payload.channel,
        item: {
          id: `demo-${payload.channel}`,
          channel: payload.channel,
          scheduled_at: new Date().toISOString(),
          title: 'Demo planner item',
          caption: 'Demo caption from OpinIA',
        },
      },
      requestId,
      userId: user.id,
      plannerItemId: null,
      connectorsOverride: [{
        id: connector.id,
        business_id: connector.business_id,
        type: 'webhook',
        enabled: !!connector.enabled,
        url: connector.url,
        secret: connector.secret,
        allowed_channels: Array.isArray(connector.allowed_channels) ? connector.allowed_channels : [],
      }],
      log,
    });

    return withRequestId(
      NextResponse.json({
        ok: result.status === 'sent',
        status: result.status,
        response_code: result.responseCode,
        error: result.error,
        request_id: requestId,
      }),
    );
  } catch (error: unknown) {
    log.error('Unhandled integrations test error', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return withRequestId(
      NextResponse.json({ error: 'internal_error', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
    );
  }
}
