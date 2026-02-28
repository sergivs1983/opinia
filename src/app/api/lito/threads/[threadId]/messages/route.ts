export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody, validateParams, validateQuery } from '@/lib/validations';

const ThreadParamsSchema = z.object({
  threadId: z.string().uuid(),
});

const ThreadMessagesQuerySchema = z.object({
  limit: z
    .preprocess((value) => {
      if (typeof value !== 'string') return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }, z.number().int().min(1).max(500).optional())
    .optional(),
});

const ThreadMessagesBodySchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().trim().min(1).max(8000),
  meta: z.unknown().optional(),
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

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function isServiceRoleRequest(request: Request): boolean {
  const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const authHeader = (request.headers.get('authorization') || '').trim();
  if (!serviceRole || !authHeader.toLowerCase().startsWith('bearer ')) return false;
  const token = authHeader.slice(7).trim();

  const serviceBuf = Buffer.from(serviceRole);
  const tokenBuf = Buffer.from(token);
  if (serviceBuf.length !== tokenBuf.length) return false;
  return timingSafeEqual(serviceBuf, tokenBuf);
}

async function loadThreadForUser(params: {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  userId: string;
  threadId: string;
}): Promise<{ thread: ThreadRow | null; allowed: boolean }> {
  const { data, error } = await params.supabase
    .from('lito_threads')
    .select('id, biz_id, recommendation_id, title, status, created_at, updated_at')
    .eq('id', params.threadId)
    .maybeSingle();

  if (error || !data) return { thread: null, allowed: false };
  const thread = data as ThreadRow;
  const access = await hasAcceptedBusinessMembership({
    supabase: params.supabase,
    userId: params.userId,
    businessId: thread.biz_id,
    allowedRoles: ['owner', 'manager', 'responder'],
  });

  return {
    thread,
    allowed: access.allowed,
  };
}

export async function GET(
  request: Request,
  { params }: { params: { threadId: string } },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/lito/threads/[threadId]/messages' });

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
    const [query, queryErr] = validateQuery(request, ThreadMessagesQuerySchema);
    if (queryErr) return withStandardHeaders(queryErr, requestId);
    const limit = (query as z.infer<typeof ThreadMessagesQuerySchema>).limit ?? 200;

    const { thread, allowed } = await loadThreadForUser({
      supabase,
      userId: user.id,
      threadId: routeParams.threadId,
    });
    if (!thread || !allowed) {
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
      log.error('lito_thread_messages_query_failed', {
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
    log.error('lito_thread_messages_get_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: { threadId: string } },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/lito/threads/[threadId]/messages' });
  const serviceRoleRequest = isServiceRoleRequest(request);

  try {
    const [routeParams, paramsErr] = validateParams(params, ThreadParamsSchema);
    if (paramsErr) return withStandardHeaders(paramsErr, requestId);
    const [body, bodyErr] = await validateBody(request, ThreadMessagesBodySchema);
    if (bodyErr) return withStandardHeaders(bodyErr, requestId);
    const payload = body as z.infer<typeof ThreadMessagesBodySchema>;

    const canWriteAssistantRole = serviceRoleRequest
      || (process.env.NODE_ENV === 'development' && request.headers.get('x-dev-allow-assistant') === 'true');
    if ((payload.role === 'assistant' || payload.role === 'system') && !canWriteAssistantRole) {
      return withStandardHeaders(
        NextResponse.json({ error: 'forbidden', message: 'No disponible', request_id: requestId }, { status: 403 }),
        requestId,
      );
    }

    let thread: ThreadRow | null = null;
    let dbClient:
      | ReturnType<typeof createServerSupabaseClient>
      | ReturnType<typeof createAdminClient>;

    if (serviceRoleRequest) {
      const admin = createAdminClient();
      dbClient = admin;
      const { data: threadData } = await admin
        .from('lito_threads')
        .select('id, biz_id, recommendation_id, title, status, created_at, updated_at')
        .eq('id', routeParams.threadId)
        .maybeSingle();
      thread = (threadData || null) as ThreadRow | null;
    } else {
      const supabase = createServerSupabaseClient();
      dbClient = supabase;
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return withStandardHeaders(
          NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
          requestId,
        );
      }

      const loaded = await loadThreadForUser({
        supabase,
        userId: user.id,
        threadId: routeParams.threadId,
      });
      if (!loaded.thread || !loaded.allowed) {
        return withStandardHeaders(
          NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
          requestId,
        );
      }
      thread = loaded.thread;
    }

    if (!thread) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const { data: insertedData, error: insertErr } = await dbClient
      .from('lito_messages')
      .insert({
        thread_id: thread.id,
        role: payload.role,
        content: payload.content,
        meta: payload.meta ?? null,
      })
      .select('id, thread_id, role, content, meta, created_at')
      .single();

    if (insertErr || !insertedData) {
      log.error('lito_message_insert_failed', {
        error_code: insertErr?.code || null,
        error: insertErr?.message || null,
        thread_id: thread.id,
      });
      return withStandardHeaders(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    const now = new Date().toISOString();
    await dbClient
      .from('lito_threads')
      .update({ updated_at: now })
      .eq('id', thread.id);

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        message: insertedData as MessageRow,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('lito_thread_messages_post_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
