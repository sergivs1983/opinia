import { NextResponse } from 'next/server';

import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { createLogger } from '@/lib/logger';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

export function unauthorized(requestId: string): NextResponse {
  return withNoStore(
    NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
    requestId,
  );
}

export function notFound(requestId: string): NextResponse {
  return withNoStore(
    NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
    requestId,
  );
}

export async function requirePushBizAccess(params: {
  bizId: string;
  requestId: string;
  route: string;
}): Promise<
  | {
    ok: false;
    response: NextResponse;
  }
  | {
    ok: true;
    userId: string;
    orgId: string;
    supabase: ReturnType<typeof createServerSupabaseClient>;
  }
> {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, response: unauthorized(params.requestId) };

  const access = await hasAcceptedBusinessMembership({
    supabase,
    userId: user.id,
    businessId: params.bizId,
    allowedRoles: ['owner', 'manager', 'staff'],
  });

  if (!access.allowed || !access.orgId) {
    return { ok: false, response: notFound(params.requestId) };
  }

  createLogger({ request_id: params.requestId, route: params.route }).info('push_biz_access_ok', {
    biz_id: params.bizId,
    user_id: user.id,
    org_id: access.orgId,
  });

  return {
    ok: true,
    userId: user.id,
    orgId: access.orgId,
    supabase,
  };
}
