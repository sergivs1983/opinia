import { NextResponse } from 'next/server';

import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type PushAccessRole = 'owner' | 'admin' | 'manager' | 'staff';

export function parsePushAccessRole(input: string | null | undefined): PushAccessRole | null {
  const normalized = (input || '').trim().toLowerCase();
  if (normalized === 'owner') return 'owner';
  if (normalized === 'admin') return 'admin';
  if (normalized === 'manager') return 'manager';
  if (normalized === 'staff' || normalized === 'responder') return 'staff';
  return null;
}

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
  request: Request;
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
    bizId: string;
    role: 'owner' | 'admin' | 'manager' | 'staff';
    supabase: ReturnType<typeof createServerSupabaseClient>;
  }
> {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, response: unauthorized(params.requestId) };

  const gate = await requireBizAccessPatternB(params.request, params.bizId, {
    supabase,
    user,
  });
  if (gate instanceof NextResponse) {
    return { ok: false, response: notFound(params.requestId) };
  }

  if (!gate.membership.orgId) {
    return { ok: false, response: notFound(params.requestId) };
  }

  const accessRole = parsePushAccessRole(gate.role);
  if (!accessRole) {
    return { ok: false, response: notFound(params.requestId) };
  }

  createLogger({ request_id: params.requestId, route: params.route }).info('push_biz_access_ok', {
    biz_id: gate.bizId,
    user_id: user.id,
    org_id: gate.membership.orgId,
    role: accessRole,
  });

  return {
    ok: true,
    userId: user.id,
    orgId: gate.membership.orgId,
    bizId: gate.bizId,
    role: accessRole,
    supabase,
  };
}
