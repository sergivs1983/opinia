export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { POST as postThreadMessageRoute } from '@/app/api/lito/threads/[threadId]/messages/route';
import { createRequestId } from '@/lib/logger';
import { validateBody } from '@/lib/validations';

const LegacyMessageBodySchema = z.object({
  thread_id: z.string().uuid(),
  content: z.string().trim().min(1).max(4000),
});

export async function POST(request: Request) {
  const [body, bodyErr] = await validateBody(request, LegacyMessageBodySchema);
  if (bodyErr) {
    const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
    bodyErr.headers.set('x-request-id', requestId);
    bodyErr.headers.set('Cache-Control', 'no-store');
    return bodyErr;
  }

  const payload = body as z.infer<typeof LegacyMessageBodySchema>;
  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  const inboundRequestId = request.headers.get('x-request-id');
  if (cookie) headers.set('cookie', cookie);
  if (inboundRequestId) headers.set('x-request-id', inboundRequestId);
  headers.set('content-type', 'application/json');

  const proxyRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content: payload.content }),
  });

  const upstream = await postThreadMessageRoute(proxyRequest, {
    params: { threadId: payload.thread_id },
  });

  const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) return upstream;

  let parsed: unknown = null;
  try {
    parsed = await upstream.clone().json();
  } catch {
    return upstream;
  }

  if (!parsed || typeof parsed !== 'object') return upstream;
  const record = parsed as Record<string, unknown>;
  const messages = Array.isArray(record.messages) ? record.messages : [];

  const compat = NextResponse.json(
    {
      ...record,
      message: messages[0] ?? null,
    },
    { status: upstream.status },
  );

  const upstreamRequestId = upstream.headers.get('x-request-id');
  const cacheControl = upstream.headers.get('cache-control') || upstream.headers.get('Cache-Control');
  if (upstreamRequestId) compat.headers.set('x-request-id', upstreamRequestId);
  if (cacheControl) compat.headers.set('Cache-Control', cacheControl);
  return compat;
}
