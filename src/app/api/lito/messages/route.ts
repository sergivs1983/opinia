export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  GET as getThreadMessagesRoute,
  POST as postThreadMessagesRoute,
} from '@/app/api/lito/threads/[threadId]/messages/route';
import { createRequestId } from '@/lib/logger';
import { validateBody, validateQuery } from '@/lib/validations';

const MessagesQuerySchema = z.object({
  thread_id: z.string().uuid(),
  limit: z
    .preprocess((value) => {
      if (typeof value !== 'string') return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }, z.number().int().min(1).max(500).optional())
    .optional(),
});

const MessagesBodySchema = z.object({
  thread_id: z.string().uuid(),
  content: z.string().trim().min(1).max(4000),
});

function withValidationHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function buildForwardHeaders(request: Request): Headers {
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  const requestId = request.headers.get('x-request-id');
  if (cookie) headers.set('cookie', cookie);
  if (requestId) headers.set('x-request-id', requestId);
  headers.set('content-type', 'application/json');
  return headers;
}

export async function GET(request: Request) {
  const [query, queryErr] = validateQuery(request, MessagesQuerySchema);
  if (queryErr) {
    const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
    return withValidationHeaders(queryErr, requestId);
  }

  const payload = query as z.infer<typeof MessagesQuerySchema>;
  const upstreamUrl = new URL(request.url);
  upstreamUrl.searchParams.delete('thread_id');
  if (typeof payload.limit === 'number') {
    upstreamUrl.searchParams.set('limit', String(payload.limit));
  } else {
    upstreamUrl.searchParams.delete('limit');
  }

  const proxyRequest = new Request(upstreamUrl.toString(), {
    method: 'GET',
    headers: buildForwardHeaders(request),
  });

  return getThreadMessagesRoute(proxyRequest, {
    params: { threadId: payload.thread_id },
  });
}

export async function POST(request: Request) {
  const [body, bodyErr] = await validateBody(request, MessagesBodySchema);
  if (bodyErr) {
    const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
    return withValidationHeaders(bodyErr, requestId);
  }

  const payload = body as z.infer<typeof MessagesBodySchema>;
  const proxyRequest = new Request(request.url, {
    method: 'POST',
    headers: buildForwardHeaders(request),
    body: JSON.stringify({ content: payload.content }),
  });

  return postThreadMessagesRoute(proxyRequest, {
    params: { threadId: payload.thread_id },
  });
}

