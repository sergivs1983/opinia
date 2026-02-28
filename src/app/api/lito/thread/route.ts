export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createRequestId } from '@/lib/logger';
import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody, validateQuery } from '@/lib/validations';
import { POST as createThreadFromThreadsRoute } from '@/app/api/lito/threads/route';

const LitoCreateThreadSchema = z.object({
  biz_id: z.string().uuid(),
  recommendation_id: z.string().uuid().optional().nullable(),
});

const LitoGetThreadSchema = z.object({
  id: z.string().uuid(),
});

type LitoThreadRow = {
  id: string;
  org_id: string;
  biz_id: string;
  recommendation_id: string | null;
  title: string;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
};

type LitoMessageRow = {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta: unknown;
  created_at: string;
};

type BusinessRow = {
  id: string;
  name: string;
  type: string | null;
  default_language: string | null;
};

const missingDependencyCodes = new Set(['42703', '42P01', 'PGRST205']);

function isMissingDependencyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string };
  if (err.code && missingDependencyCodes.has(err.code)) return true;
  const message = (err.message || '').toLowerCase();
  return message.includes('does not exist') || message.includes('schema cache');
}

export async function POST(request: Request) {
  const upstream = await createThreadFromThreadsRoute(request);
  const contentType = (upstream.headers.get('content-type') || '').toLowerCase();

  // Keep legacy /api/lito/thread contract while delegating create logic to /api/lito/threads.
  if (!contentType.includes('application/json')) {
    return upstream;
  }

  let body: unknown = null;
  try {
    body = await upstream.clone().json();
  } catch {
    return upstream;
  }

  if (!body || typeof body !== 'object') {
    return upstream;
  }

  const record = body as Record<string, unknown>;
  const maybeThread = (record.thread || null) as { id?: string } | null;
  if (!maybeThread?.id || typeof maybeThread.id !== 'string') {
    return upstream;
  }

  const compat = NextResponse.json(
    {
      ...record,
      thread_id: maybeThread.id,
      created: upstream.status === 201,
    },
    { status: upstream.status },
  );

  const requestId = upstream.headers.get('x-request-id');
  const cacheControl = upstream.headers.get('cache-control') || upstream.headers.get('Cache-Control');
  if (requestId) compat.headers.set('x-request-id', requestId);
  if (cacheControl) compat.headers.set('Cache-Control', cacheControl);
  return compat;
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const withHeaders = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };

  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withHeaders(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
      );
    }

    const [query, queryError] = validateQuery(request, LitoGetThreadSchema);
    if (queryError) return withHeaders(queryError);
    const payload = query as z.infer<typeof LitoGetThreadSchema>;

    const { data: threadData, error: threadError } = await supabase
      .from('lito_threads')
      .select('id, org_id, biz_id, recommendation_id, title, status, created_at, updated_at')
      .eq('id', payload.id)
      .single();

    if (threadError || !threadData) {
      return withHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }

    const thread = threadData as LitoThreadRow;
    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: thread.biz_id,
    });

    if (!access.allowed) {
      return withHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      );
    }

    const { data: messagesData, error: messagesError } = await supabase
      .from('lito_messages')
      .select('id, thread_id, role, content, meta, created_at')
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true })
      .limit(50);

    if (messagesError) {
      return withHeaders(
        NextResponse.json(
          { error: 'internal', message: 'Error intern del servidor', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    const { data: businessData } = await supabase
      .from('businesses')
      .select('id, name, type, default_language')
      .eq('id', thread.biz_id)
      .maybeSingle();

    let suggestedLang: string | null = null;
    const { data: insightData, error: insightError } = await supabase
      .from('insights_daily')
      .select('dominant_lang, date')
      .eq('biz_id', thread.biz_id)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!insightError && insightData) {
      suggestedLang = (insightData as { dominant_lang?: string | null }).dominant_lang || null;
    } else if (insightError && !isMissingDependencyError(insightError)) {
      return withHeaders(
        NextResponse.json(
          { error: 'internal', message: 'Error intern del servidor', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    return withHeaders(
      NextResponse.json({
        ok: true,
        thread,
        messages: (messagesData || []) as LitoMessageRow[],
        business: (businessData || null) as BusinessRow | null,
        language: {
          base_lang: ((businessData as BusinessRow | null)?.default_language || 'ca'),
          suggested_lang: suggestedLang,
        },
        request_id: requestId,
      }),
    );
  } catch {
    return withHeaders(
      NextResponse.json(
        { error: 'internal', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
