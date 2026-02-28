export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateParams } from '@/lib/validations';

const ThreadParamsSchema = z.object({
  threadId: z.string().uuid(),
});

type ThreadScopeRow = {
  id: string;
  biz_id: string;
};

const LITO_ALLOWED_ROLES = ['owner', 'admin', 'manager', 'responder'] as const;

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(
  request: Request,
  { params }: { params: { threadId: string } },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/threads/[threadId]/close' });

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

    const [routeParams, paramsErr] = validateParams(params, ThreadParamsSchema);
    if (paramsErr) return withStandardHeaders(paramsErr, requestId);

    const { data: threadData, error: threadErr } = await supabase
      .from('lito_threads')
      .select('id, biz_id')
      .eq('id', routeParams.threadId)
      .maybeSingle();

    if (threadErr || !threadData) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const thread = threadData as ThreadScopeRow;
    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: thread.biz_id,
      allowedRoles: [...LITO_ALLOWED_ROLES],
    });
    if (!access.allowed) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const { error: updateErr } = await supabase
      .from('lito_threads')
      .update({ status: 'closed', updated_at: new Date().toISOString() })
      .eq('id', thread.id);

    if (updateErr) {
      log.error('lito_thread_close_failed', {
        error_code: updateErr.code || null,
        error: updateErr.message || null,
        thread_id: thread.id,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({ ok: true, request_id: requestId }),
      requestId,
    );
  } catch (error) {
    log.error('lito_thread_close_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
