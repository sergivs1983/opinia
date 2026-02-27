import { NextRequest, NextResponse } from 'next/server';

import { validateHmacHeader } from '@/lib/security/hmac';

type JsonBody = Record<string, unknown>;

export function jsonNoStore(body: JsonBody, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function handleInternalWorkerStub(
  request: NextRequest,
  canonicalPath: string,
  successBody: JsonBody,
): Promise<NextResponse> {
  const rawBody = await request.text();
  const hmac = validateHmacHeader({
    timestampHeader: request.headers.get('x-opin-timestamp'),
    signatureHeader: request.headers.get('x-opin-signature'),
    method: 'POST',
    pathname: canonicalPath,
    rawBody,
  });

  if (!hmac.valid) {
    return jsonNoStore({ error: 'Unauthorized' }, 401);
  }

  return jsonNoStore(successBody, 200);
}
