export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { GET as getThreadByIdRoute, } from '@/app/api/lito/threads/[threadId]/route';
import { POST as createThreadRoute } from '@/app/api/lito/threads/route';
import { createRequestId } from '@/lib/logger';
import { validateQuery } from '@/lib/validations';

const LegacyGetThreadSchema = z.object({
  id: z.string().uuid(),
});

function preserveHeaders(upstream: Response, response: NextResponse): NextResponse {
  const requestId = upstream.headers.get('x-request-id');
  const cacheControl = upstream.headers.get('cache-control') || upstream.headers.get('Cache-Control');
  if (requestId) response.headers.set('x-request-id', requestId);
  if (cacheControl) response.headers.set('Cache-Control', cacheControl);
  return response;
}

export async function POST(request: Request) {
  const upstream = await createThreadRoute(request);
  const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) return upstream;

  let body: unknown = null;
  try {
    body = await upstream.clone().json();
  } catch {
    return upstream;
  }

  if (!body || typeof body !== 'object') return upstream;
  const payload = body as Record<string, unknown>;
  const thread = payload.thread as { id?: string } | undefined;
  if (!thread?.id || typeof thread.id !== 'string') return upstream;

  const compat = NextResponse.json(
    {
      ...payload,
      thread_id: thread.id,
      created: upstream.status === 201,
    },
    { status: upstream.status },
  );
  return preserveHeaders(upstream, compat);
}

export async function GET(request: Request) {
  const [query, queryErr] = validateQuery(request, LegacyGetThreadSchema);
  if (queryErr) {
    const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
    queryErr.headers.set('x-request-id', requestId);
    queryErr.headers.set('Cache-Control', 'no-store');
    return queryErr;
  }

  const payload = query as z.infer<typeof LegacyGetThreadSchema>;
  return getThreadByIdRoute(request, { params: { threadId: payload.id } });
}
