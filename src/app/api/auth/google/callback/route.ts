export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { createLogger, createRequestId } from '@/lib/logger';
import { saveOAuthTokens } from '@/lib/server/tokens';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

type OAuthState = {
  biz_id?: string;
  uid?: string;
  request_id?: string;
  ts?: number;
};

function getAppOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function buildRedirectUri(): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return `${getAppOrigin()}/api/auth/google/callback`;
}

function decodeState(rawState: string | null): OAuthState | null {
  if (!rawState) return null;
  try {
    const parsed = JSON.parse(Buffer.from(rawState, 'base64url').toString('utf8')) as OAuthState;
    return parsed;
  } catch {
    return null;
  }
}

function redirectWithError(message: string, requestId: string) {
  const target = new URL('/dashboard/settings', getAppOrigin());
  target.searchParams.set('tab', 'integrations');
  target.searchParams.set('google_oauth', 'error');
  target.searchParams.set('message', message);
  target.searchParams.set('request_id', requestId);

  const response = NextResponse.redirect(target);
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function redirectWithSuccess(requestId: string) {
  const target = new URL('/dashboard/settings', getAppOrigin());
  target.searchParams.set('tab', 'integrations');
  target.searchParams.set('google_oauth', 'connected');
  target.searchParams.set('request_id', requestId);

  const response = NextResponse.redirect(target);
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/auth/google/callback' });

  try {
    const url = new URL(request.url);
    const oauthError = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const rawState = url.searchParams.get('state');

    if (oauthError) {
      return redirectWithError(`oauth_error:${oauthError}`, requestId);
    }

    if (!code) {
      return redirectWithError('missing_code', requestId);
    }

    const state = decodeState(rawState);
    const businessId = state?.biz_id;
    const stateUserId = state?.uid;
    if (!businessId || !stateUserId) {
      return redirectWithError('invalid_state', requestId);
    }

    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return redirectWithError('unauthenticated', requestId);
    }

    if (stateUserId !== user.id) {
      return redirectWithError('state_user_mismatch', requestId);
    }

    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId,
      allowedRoles: ['owner', 'admin'],
    });
    if (!access.allowed) {
      return redirectWithError('forbidden', requestId);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    const redirectUri = buildRedirectUri();
    if (!clientId || !clientSecret) {
      return redirectWithError('missing_google_env', requestId);
    }

    if (process.env.NODE_ENV === 'development') {
      console.info('[google-oauth-callback] exchange-start', {
        request_id: requestId,
        biz_id: businessId,
        redirect_uri: redirectUri,
      });
    }

    const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      cache: 'no-store',
    });

    const tokenJson = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!tokenResponse.ok || !tokenJson.access_token) {
      log.warn('Google token exchange failed', {
        status: tokenResponse.status,
        error: tokenJson.error || 'unknown',
      });
      return redirectWithError('token_exchange_failed', requestId);
    }

    const admin = getAdminClient();

    const { data: bizRow, error: bizError } = await admin
      .from('businesses')
      .select('id, org_id')
      .eq('id', businessId)
      .single();

    if (bizError || !bizRow) {
      log.warn('Business not found during oauth callback', { business_id: businessId });
      return redirectWithError('business_not_found', requestId);
    }

    const provider = 'google_business';
    const nowIso = new Date().toISOString();

    const { data: existing, error: existingError } = await admin
      .from('integrations')
      .select('id')
      .eq('biz_id', businessId)
      .eq('provider', provider)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      log.warn('Failed loading existing integration', { error: existingError.message });
      return redirectWithError('integration_lookup_failed', requestId);
    }

    let integrationId: string | null = existing?.id ?? null;

    if (integrationId) {
      const { error: updateError } = await admin
        .from('integrations')
        .update({
          is_active: true,
          status: 'active',
          updated_at: nowIso,
        })
        .eq('id', integrationId);

      if (updateError) {
        log.warn('Failed updating integration', { error: updateError.message });
        return redirectWithError('integration_update_failed', requestId);
      }
    } else {
      const { data: inserted, error: insertError } = await admin
        .from('integrations')
        .insert({
          biz_id: businessId,
          org_id: bizRow.org_id,
          provider,
          is_active: true,
          status: 'active',
          updated_at: nowIso,
        })
        .select('id')
        .single();

      if (insertError || !inserted?.id) {
        log.warn('Failed creating integration', { error: insertError?.message || 'unknown' });
        return redirectWithError('integration_create_failed', requestId);
      }

      integrationId = inserted.id;
    }

    if (!integrationId) {
      return redirectWithError('integration_missing', requestId);
    }

    await saveOAuthTokens(
      admin,
      integrationId,
      tokenJson.access_token,
      tokenJson.refresh_token ?? null,
    );

    return redirectWithSuccess(requestId);
  } catch (error) {
    log.error('Unhandled google oauth callback error', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return redirectWithError('internal_error', requestId);
  }
}
