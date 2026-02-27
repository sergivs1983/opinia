export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { validateBody } from '@/lib/validations';
import { hasAcceptedBusinessMembership } from '@/lib/authz';

const ConnectGoogleSchema = z.object({
  biz_id: z.string().uuid(),
});

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/business.manage',
] as const;

function base64UrlEncode(raw: string): string {
  return Buffer.from(raw).toString('base64url');
}

function getAppOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function buildRedirectUri(): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return `${getAppOrigin()}/api/auth/google/callback`;
}

function clientIdTail(clientId: string | null): string {
  if (!clientId) return 'missing';
  return clientId.slice(-6);
}

function isSameOrigin(value: string, appOrigin: string): boolean {
  try {
    return new URL(value).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

function validateStrictCsrf(request: Request): NextResponse | null {
  const appOrigin = getAppOrigin();
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  if (origin) {
    if (!isSameOrigin(origin, appOrigin)) {
      return NextResponse.json(
        { error: 'csrf_failed', message: 'Cross-origin request rejected' },
        { status: 403 },
      );
    }
    return null;
  }

  if (referer) {
    if (!isSameOrigin(referer, appOrigin)) {
      return NextResponse.json(
        { error: 'csrf_failed', message: 'Cross-origin request rejected' },
        { status: 403 },
      );
    }
    return null;
  }

  return NextResponse.json(
    { error: 'csrf_failed', message: 'Origin header required' },
    { status: 403 },
  );
}

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();

  const withRequestId = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };

  const blocked = validateStrictCsrf(request);
  if (blocked) return withRequestId(blocked);

  const log = createLogger({ request_id: requestId, route: '/api/integrations/google/connect' });

  const redirectUri = buildRedirectUri();
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;

  if (process.env.NODE_ENV === 'development') {
    console.info('[google-oauth-connect] config', {
      redirect_uri: redirectUri,
      client_id_tail: clientIdTail(clientId),
      scopes_count: GOOGLE_SCOPES.length,
    });
  }

  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withRequestId(
        NextResponse.json(
          { error: 'unauthorized', message: 'Auth required', request_id: requestId },
          { status: 401 },
        ),
      );
    }

    const [body, bodyErr] = await validateBody(request, ConnectGoogleSchema);
    if (bodyErr) return withRequestId(bodyErr);
    const payload = body as z.infer<typeof ConnectGoogleSchema>;

    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: payload.biz_id,
      allowedRoles: ['owner', 'admin'],
    });

    if (!access.allowed) {
      return withRequestId(
        NextResponse.json(
          {
            error: 'not_found',
            message: 'No disponible',
            request_id: requestId,
          },
          { status: 404 },
        ),
      );
    }

    if (!clientId) {
      return withRequestId(
        NextResponse.json(
          {
            error: 'config_error',
            message: 'Falta GOOGLE_CLIENT_ID a l’entorn',
            request_id: requestId,
          },
          { status: 500 },
        ),
      );
    }

    const state = base64UrlEncode(
      JSON.stringify({
        biz_id: payload.biz_id,
        uid: user.id,
        request_id: requestId,
        ts: Date.now(),
      }),
    );

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('include_granted_scopes', 'true');
    authUrl.searchParams.set('state', state);

    return withRequestId(
      NextResponse.json({
        url: authUrl.toString(),
        request_id: requestId,
      }),
    );
  } catch (error) {
    log.error('Unhandled google connect error', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return withRequestId(
      NextResponse.json(
        { error: 'internal_error', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
