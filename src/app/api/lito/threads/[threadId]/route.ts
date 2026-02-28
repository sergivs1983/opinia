export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateParams, validateQuery } from '@/lib/validations';

const ThreadParamsSchema = z.object({
  threadId: z.string().uuid(),
});

const ThreadQuerySchema = z.object({
  limit: z
    .preprocess((value) => {
      if (typeof value !== 'string') return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }, z.number().int().min(1).max(200).optional())
    .optional(),
});

type ThreadRow = {
  id: string;
  biz_id: string;
  recommendation_id: string | null;
  title: string;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta: unknown;
  created_at: string;
};

const LITO_ALLOWED_ROLES = ['owner', 'admin', 'manager', 'responder'] as const;

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(
  request: Request,
  { params }: { params: { threadId: string } },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/lito/threads/[threadId]' });

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
    const [query, queryErr] = validateQuery(request, ThreadQuerySchema);
    if (queryErr) return withStandardHeaders(queryErr, requestId);
    const limit = (query as z.infer<typeof ThreadQuerySchema>).limit ?? 50;

    const { data: threadData, error: threadErr } = await supabase
      .from('lito_threads')
      .select('id, biz_id, recommendation_id, title, status, created_at, updated_at')
      .eq('id', routeParams.threadId)
      .maybeSingle();

    if (threadErr || !threadData) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const thread = threadData as ThreadRow;
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

    const { data: messagesData, error: messagesErr } = await supabase
      .from('lito_messages')
      .select('id, thread_id, role, content, meta, created_at')
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (messagesErr) {
      log.error('lito_thread_detail_messages_failed', {
        error_code: messagesErr.code || null,
        error: messagesErr.message || null,
        thread_id: thread.id,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        thread,
        messages: (messagesData || []) as MessageRow[],
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_thread_detail_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
