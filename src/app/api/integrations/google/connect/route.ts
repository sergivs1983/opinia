export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { validateBody } from '@/lib/validations';
import { requireBizAccessPatternB } from '@/lib/api-handler';
import { roleCanManageIntegrations } from '@/lib/roles';

const ConnectGoogleSchema = z.object({
  biz_id: z.string().uuid(),
});

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/business.manage',
] as const;

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

function generatePkceVerifierAndChallenge(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
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
    const gate = await requireBizAccessPatternB(request, payload.biz_id, {
      supabase,
      user,
      bodyBizId: payload.biz_id,
    });
    if (gate instanceof NextResponse) return withRequestId(gate);
    if (!roleCanManageIntegrations(gate.role)) {
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

    const { verifier, challenge } = generatePkceVerifierAndChallenge();

    const { data: stateRow, error: stateError } = await supabase
      .from('oauth_states')
      .insert({
        biz_id: gate.bizId,
        user_id: user.id,
        code_verifier: verifier,
      })
      .select('id')
      .single();

    if (stateError || !stateRow?.id) {
      log.error('Failed creating oauth state', {
        error_code: stateError?.code || null,
        error: stateError?.message || null,
      });
      return withRequestId(
        NextResponse.json(
          {
            error: 'internal_error',
            message: 'Error intern del servidor',
            request_id: requestId,
          },
          { status: 500 },
        ),
      );
    }

    const stateId = stateRow.id as string;

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('include_granted_scopes', 'true');
    authUrl.searchParams.set('state', stateId);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    if (process.env.NODE_ENV === 'development') {
      console.info('[google-oauth-connect] state-created', {
        request_id: requestId,
        biz_id: gate.bizId,
        state: stateId,
        redirect_uri: redirectUri,
      });
    }

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
