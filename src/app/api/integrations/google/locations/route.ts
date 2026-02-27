export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { validateQuery } from '@/lib/validations';
import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { getAdminClient } from '@/lib/supabase/admin';
import { getOAuthTokens } from '@/lib/server/tokens';
import { listGoogleBusinessLocations } from '@/lib/integrations/google/locations';

const GoogleLocationsQuerySchema = z.object({
  biz_id: z.string().uuid(),
});

type IntegrationSeedRow = {
  id: string;
  biz_id: string;
  is_active: boolean | null;
  refresh_token?: string | null;
  updated_at?: string | null;
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

const missingDependencyCodes = new Set(['PGRST204', 'PGRST205', '42P01', '42703', '42883']);

function hasMissingDependencyPattern(value: string): boolean {
  return (
    /schema cache/i.test(value)
    || /column .* does not exist/i.test(value)
    || /relation .* does not exist/i.test(value)
    || /table .* does not exist/i.test(value)
    || /function .* does not exist/i.test(value)
  );
}

function isMissingDependencyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as SupabaseErrorLike;
  if (err.code && missingDependencyCodes.has(err.code)) return true;
  const message = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`.trim();
  return message.length > 0 && hasMissingDependencyPattern(message);
}

function hasToken(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/integrations/google/locations' });

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
        NextResponse.json(
          { error: 'unauthorized', message: 'Auth required', request_id: requestId },
          { status: 401 },
        ),
      );
    }

    const [query, queryErr] = validateQuery(request, GoogleLocationsQuerySchema);
    if (queryErr) return withHeaders(queryErr);
    const payload = query as z.infer<typeof GoogleLocationsQuerySchema>;

    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: payload.biz_id,
      allowedRoles: ['owner', 'admin'],
    });

    if (!access.allowed || !access.orgId) {
      return withHeaders(
        NextResponse.json(
          { error: 'not_found', message: 'No disponible', request_id: requestId },
          { status: 404 },
        ),
      );
    }

    const { data: integrations, error: integrationsError } = await supabase
      .from('integrations')
      .select('id, biz_id, is_active, refresh_token, updated_at')
      .eq('org_id', access.orgId)
      .eq('provider', 'google_business')
      .order('updated_at', { ascending: false });

    if (integrationsError && !isMissingDependencyError(integrationsError)) {
      log.warn('google locations integration lookup failed', {
        user_id: user.id,
        org_id: access.orgId,
        error_code: integrationsError.code || null,
        error: integrationsError.message || null,
      });
    }

    const rows = (integrations || []) as IntegrationSeedRow[];
    const preferredSeed =
      rows.find((row) => row.biz_id === payload.biz_id && row.is_active)
      || rows.find((row) => row.biz_id === payload.biz_id)
      || rows.find((row) => row.is_active)
      || rows[0]
      || null;

    if (!preferredSeed) {
      return withHeaders(
        NextResponse.json({
          provider: 'google_business',
          state: 'not_connected',
          locations: [],
          request_id: requestId,
        }),
      );
    }

    let hasSecret = false;
    const { data: secretRow, error: secretsError } = await supabase
      .from('integrations_secrets')
      .select('integration_id')
      .eq('integration_id', preferredSeed.id)
      .limit(1)
      .maybeSingle();

    if (secretsError) {
      if (!isMissingDependencyError(secretsError)) {
        log.warn('google locations secrets lookup failed', {
          integration_id: preferredSeed.id,
          error_code: secretsError.code || null,
          error: secretsError.message || null,
        });
      }
    } else {
      hasSecret = !!(secretRow as { integration_id?: string } | null)?.integration_id;
    }

    if (!preferredSeed.is_active || (!hasToken(preferredSeed.refresh_token) && !hasSecret)) {
      return withHeaders(
        NextResponse.json({
          provider: 'google_business',
          state: 'needs_reauth',
          locations: [],
          request_id: requestId,
        }),
      );
    }

    let accessToken: string | null = null;
    try {
      const admin = getAdminClient();
      const tokens = await getOAuthTokens(admin, preferredSeed.id);
      accessToken = tokens.accessToken;
    } catch (tokenError: unknown) {
      log.warn('google locations seed token unavailable', {
        integration_id: preferredSeed.id,
        error: tokenError instanceof Error ? tokenError.message : String(tokenError),
      });
      return withHeaders(
        NextResponse.json({
          provider: 'google_business',
          state: 'needs_reauth',
          locations: [],
          request_id: requestId,
        }),
      );
    }

    const locationsResult = await listGoogleBusinessLocations(accessToken);
    const authFailure =
      locationsResult.httpStatus === 401
      || locationsResult.httpStatus === 403
      || locationsResult.errorCode === 'UNAUTHENTICATED'
      || locationsResult.errorCode === 'PERMISSION_DENIED'
      || locationsResult.errorCode === 'invalid_grant';

    if (authFailure) {
      log.warn('google locations auth failure', {
        integration_id: preferredSeed.id,
        http_status: locationsResult.httpStatus,
        error_code: locationsResult.errorCode,
      });
      return withHeaders(
        NextResponse.json({
          provider: 'google_business',
          state: 'needs_reauth',
          locations: [],
          request_id: requestId,
        }),
      );
    }

    if (locationsResult.httpStatus >= 400) {
      log.warn('google locations upstream error', {
        integration_id: preferredSeed.id,
        http_status: locationsResult.httpStatus,
        error_code: locationsResult.errorCode,
      });
      return withHeaders(
        NextResponse.json({
          provider: 'google_business',
          state: 'not_connected',
          locations: [],
          request_id: requestId,
        }),
      );
    }

    return withHeaders(
      NextResponse.json({
        provider: 'google_business',
        state: 'connected',
        locations: locationsResult.locations.map((item) => ({
          location_id: item.location_id,
          title: item.title,
          address: item.address,
          city: item.city,
          country: item.country,
          primary_phone: item.primary_phone,
          website_uri: item.website_uri,
          profile_photo_url: item.profile_photo_url,
        })),
        request_id: requestId,
      }),
    );
  } catch (error) {
    log.error('Unhandled google locations error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withHeaders(
      NextResponse.json(
        { error: 'internal', message: 'Error intern del servidor', request_id: requestId },
        { status: 500 },
      ),
    );
  }
}
