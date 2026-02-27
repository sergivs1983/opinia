export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { createLogger, createRequestId } from '@/lib/logger';
import { saveOAuthTokens } from '@/lib/server/tokens';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

type ConsumedOAuthStateRow = {
  biz_id: string;
  code_verifier: string;
};

type BusinessLookupRow = {
  id: string;
  org_id: string;
  is_active?: boolean | null;
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

function classifyBusinessLookup(error: unknown, found: boolean): 'ok' | 'rls_denied' | 'not_found' | 'query_error' {
  if (found) return 'ok';
  if (!error || typeof error !== 'object') return 'not_found';
  const code = (error as SupabaseErrorLike).code;
  if (code === '42501') return 'rls_denied';
  if (code === 'PGRST116') return 'not_found';
  return 'query_error';
}

function isMissingMembershipBizColumns(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as SupabaseErrorLike;
  const message = (e.message || '').toLowerCase();
  return e.code === '42703'
    || message.includes('column')
    || message.includes('does not exist');
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

    if (process.env.NODE_ENV === 'development') {
      console.info('[google-oauth-callback] state-received', {
        request_id: requestId,
        state: receivedState,
        is_uuid: stateIsUuid,
      });
    }

    if (oauthError) {
      return redirectWithError(`oauth_error:${oauthError}`, requestId);
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

    const admin = getAdminClient();

    const { data: bizRowRaw, error: bizError } = await admin
      .from('businesses')
      .select('id, org_id, is_active')
      .eq('id', businessId)
      .maybeSingle();
    const bizLookup = classifyBusinessLookup(bizError, !!bizRowRaw);
    if (bizLookup !== 'ok' || !bizRowRaw) {
      log.warn('OAuth callback business lookup failed', {
        business_id: businessId,
        user_id: user.id,
        lookup_result: bizLookup,
        error_code: (bizError as SupabaseErrorLike | null)?.code || null,
        error: (bizError as SupabaseErrorLike | null)?.message || null,
      });
      return redirectWithError('business_not_found', requestId);
    }
    const bizRow = bizRowRaw as BusinessLookupRow;

    let membershipOk = false;

    const { data: membershipData, error: membershipError } = await admin
      .from('memberships')
      .select('id')
      .eq('user_id', user.id)
      .eq('biz_id', businessId)
      .eq('is_active', true)
      .not('accepted_at', 'is', null)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      if (isMissingMembershipBizColumns(membershipError)) {
        const { data: fallbackMembershipData, error: fallbackMembershipError } = await admin
          .from('memberships')
          .select('id')
          .eq('user_id', user.id)
          .eq('org_id', bizRow.org_id)
          .not('accepted_at', 'is', null)
          .limit(1)
          .maybeSingle();
        if (fallbackMembershipError) {
          log.warn('OAuth callback membership fallback check failed', {
            business_id: businessId,
            user_id: user.id,
            org_id: bizRow.org_id,
            error_code: fallbackMembershipError.code || null,
            error: fallbackMembershipError.message || null,
          });
        } else {
          membershipOk = !!fallbackMembershipData;
        }
      } else {
        log.warn('OAuth callback membership check failed', {
          business_id: businessId,
          user_id: user.id,
          error_code: membershipError.code || null,
          error: membershipError.message || null,
        });
      }
    } else {
      membershipOk = !!membershipData;
    }

    if (process.env.NODE_ENV === 'development') {
      console.info('[google-oauth-callback] access-check', {
        request_id: requestId,
        business_found: true,
        membership_ok: membershipOk,
      });
    }

    if (!membershipOk) {
      log.warn('OAuth callback denied by membership', {
        business_id: businessId,
        user_id: user.id,
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

    const tokenJson = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
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
        org_id: bizRow.org_id,
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
            org_id: bizRow.org_id,
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
