export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { buildGlobalProps } from '@/lib/analytics/properties';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trackEvent } from '@/lib/telemetry';
import { validateBody } from '@/lib/validations';
import { getLitoBizAccess } from '@/lib/lito/action-drafts';

const AllowedEventSchema = z.enum([
  'open_app',
  'test_event_opinia',
  'start_weekly_wizard',
  'approve_draft',
  'handoff_to_planner',
  'enable_push',
  'notification_opened',
  'ikea_action',
  'post_executed',
  'wizard_abandoned',
  'post_snoozed',
  'post_expired',
]);

const BodySchema = z.object({
  biz_id: z.string().uuid(),
  event: AllowedEventSchema,
  mode: z.enum(['basic', 'advanced']).optional(),
  properties: z.record(z.unknown()).optional(),
});

const REDACTED_KEY_PATTERN = /text|copy|transcript|message|body|caption|draft/i;
const SAFE_PROPERTY_KEYS = new Set([
  'source',
  'role',
  'target_count',
  'approved',
  'index',
  'format',
  'edited',
  'regenerations',
  'platform_target',
  'count_posts',
  'wizard_duration_ms',
  'scheduled_count',
  'push_enabled',
  'os_permission_granted',
  'push_subscription_active',
  'schedule_id',
  'push_triggered',
  'missed_count',
  'reason',
  'session_id',
  'timezone',
  'type',
  'action',
]);

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function sanitizeProperties(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};

  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_PROPERTY_KEYS.has(key)) continue;
    if (REDACTED_KEY_PATTERN.test(key)) continue;

    if (typeof value === 'string') {
      if (value.length <= 120) {
        next[key] = value;
      }
      continue;
    }

    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      next[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      next[key] = value.slice(0, 10).map((item) => {
        if (typeof item === 'string') return item.slice(0, 60);
        if (typeof item === 'number' || typeof item === 'boolean' || item === null) return item;
        return '[redacted]';
      });
    }
  }

  return next;
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/analytics/capture' });

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

    const [body, bodyErr] = await validateBody(request, BodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof BodySchema>;

    const access = await getLitoBizAccess({
      supabase,
      userId: user.id,
      bizId: payload.biz_id,
    });

    if (!access.allowed || !access.role || !access.orgId) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const sanitized = sanitizeProperties(payload.properties);
    const timezone = typeof sanitized.timezone === 'string' ? sanitized.timezone : undefined;
    const sessionId = typeof sanitized.session_id === 'string' ? sanitized.session_id : undefined;

    const props = {
      ...buildGlobalProps({
        userId: user.id,
        bizId: payload.biz_id,
        orgId: access.orgId,
        role: access.role,
        mode: payload.mode || 'basic',
        platform: 'web',
        timezone,
        sessionId,
      }),
      ...sanitized,
    };

    await trackEvent({
      supabase,
      orgId: access.orgId,
      userId: user.id,
      name: payload.event,
      props,
      requestId,
      sendPosthog: true,
    });

    return withStandardHeaders(
      NextResponse.json({ ok: true, request_id: requestId }),
      requestId,
    );
  } catch (error) {
    log.error('analytics_capture_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });

    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
