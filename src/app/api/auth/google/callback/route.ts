export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireBizAccessPatternB } from '@/lib/api-handler';
import { createLogger, createRequestId } from '@/lib/logger';
import { roleCanManageIntegrations } from '@/lib/roles';
import { saveOAuthTokens } from '@/lib/server/tokens';
import { createAdminClient } from '@/lib/supabase/admin';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

type ConsumedOAuthStateRow = {
  biz_id: string;
  code_verifier: string;
};

function getAppOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function buildRedirectUri(): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return `${getAppOrigin()}/api/auth/google/callback`;
}

const UUID_V4_LIKE_REGEX
  = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | null): value is string {
  return typeof value === 'string' && UUID_V4_LIKE_REGEX.test(value);
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as SupabaseErrorLike;
  const message = (e.message || '').toLowerCase();
  return e.code === '42703'
    || (message.includes('column') && message.includes('does not exist'));
}

function parseScopes(scopeValue?: string): string[] | null {
  if (!scopeValue) return null;
  const scopes = scopeValue
    .split(' ')
    .map((scope) => scope.trim())
    .filter(Boolean);
  return scopes.length > 0 ? scopes : null;
}

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

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
    const receivedState = url.searchParams.get('state');
    const stateIsUuid = isUuid(receivedState);

    if (oauthError) {
      log.warn('OAuth provider returned error', {
        error: oauthError,
      });
      return redirectWithError('oauth_error', requestId);
    }

    if (!code) {
      return redirectWithError('missing_code', requestId);
    }

    if (!stateIsUuid || !receivedState) {
      return redirectWithError('bad_state_format', requestId);
    }

    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return redirectWithError('unauthenticated', requestId);
    }

    const { data: consumedStateRows, error: consumeStateError } = await supabase
      .rpc('consume_oauth_state', { p_state: receivedState });

    const consumedState = Array.isArray(consumedStateRows) && consumedStateRows.length > 0
      ? consumedStateRows[0] as ConsumedOAuthStateRow
      : null;

    if (consumeStateError || !consumedState?.biz_id || !consumedState?.code_verifier) {
      log.warn('Failed consuming oauth state', {
        state: receivedState,
        error_code: consumeStateError?.code || null,
        error: consumeStateError?.message || null,
      });
      return redirectWithError('invalid_state', requestId);
    }

    const businessId = consumedState.biz_id;
    const codeVerifier = consumedState.code_verifier;
    const access = await requireBizAccessPatternB(request, businessId, {
      supabase,
      user,
    });
    if (access instanceof NextResponse) {
      log.warn('OAuth callback denied by membership', {
        business_id: businessId,
        user_id: user.id,
      });
      return redirectWithError('not_allowed', requestId);
    }
    if (!access.membership.orgId || !roleCanManageIntegrations(access.role)) {
      log.warn('OAuth callback denied by role', {
        business_id: businessId,
        user_id: user.id,
        role: access.role,
      });
      return redirectWithError('not_allowed', requestId);
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
        code_verifier: codeVerifier,
      }),
      cache: 'no-store',
    });

    let tokenJson: GoogleTokenResponse = {};
    try {
      tokenJson = await tokenResponse.json() as GoogleTokenResponse;
    } catch {
      tokenJson = {};
    }

    if (!tokenResponse.ok || !tokenJson.access_token) {
      log.warn('Google token exchange failed', {
        status: tokenResponse.status,
        error: tokenJson.error || 'unknown',
      });
      return redirectWithError('token_exchange_failed', requestId);
    }

    const admin = createAdminClient();
    const provider = 'google_business';
    const tokenExpiresAt = typeof tokenJson.expires_in === 'number'
      ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
      : null;
    const scopes = parseScopes(tokenJson.scope);

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
      const fullUpdatePayload: Record<string, unknown> = {
        is_active: true,
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token ?? null,
        token_expires_at: tokenExpiresAt,
        scopes,
      };

      let { error: updateError } = await admin
        .from('integrations')
        .update(fullUpdatePayload)
        .eq('id', integrationId);

      if (updateError && isMissingColumnError(updateError)) {
        log.warn('Missing integration columns during update, retrying with essential fields only', {
          business_id: businessId,
          integration_id: integrationId,
          error_code: updateError.code || null,
          error: updateError.message || null,
        });
        const retry = await admin
          .from('integrations')
          .update({ is_active: true })
          .eq('id', integrationId);
        updateError = retry.error;
      }

      if (updateError) {
        log.warn('Failed updating integration', { error: updateError.message });
        return redirectWithError('integration_update_failed', requestId);
      }
    } else {
      const fullInsertPayload: Record<string, unknown> = {
        biz_id: businessId,
        org_id: access.membership.orgId,
        provider,
        is_active: true,
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token ?? null,
        token_expires_at: tokenExpiresAt,
        scopes,
      };

      let { data: inserted, error: insertError } = await admin
        .from('integrations')
        .insert(fullInsertPayload)
        .select('id')
        .single();

      if (insertError && isMissingColumnError(insertError)) {
        log.warn('Missing integration columns during insert, retrying with essential fields only', {
          business_id: businessId,
          error_code: insertError.code || null,
          error: insertError.message || null,
        });
        const retry = await admin
          .from('integrations')
          .insert({
            biz_id: businessId,
            org_id: access.membership.orgId,
            provider,
            is_active: true,
          })
          .select('id')
          .single();
        inserted = retry.data;
        insertError = retry.error;
      }

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
