export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAcceptedOrgMembership } from '@/lib/authz';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trackEvent } from '@/lib/telemetry';
import { validateBody } from '@/lib/validations';

const BodySchema = z.object({
  org_id: z.string().uuid(),
  event_name: z.string().trim().min(3).max(80).regex(/^[a-z0-9_]+$/),
  props: z.record(z.unknown()).optional(),
});

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/telemetry' });

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

    const membership = await getAcceptedOrgMembership({
      supabase,
      userId: user.id,
      orgId: payload.org_id,
    });

    if (!membership) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    await trackEvent({
      supabase,
      orgId: payload.org_id,
      userId: user.id,
      name: payload.event_name,
      props: payload.props || {},
      requestId,
    });

    return withStandardHeaders(
      NextResponse.json({ ok: true, request_id: requestId }),
      requestId,
    );
  } catch (error) {
    log.error('telemetry_post_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
