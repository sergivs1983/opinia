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

const LocationsQuerySchema = z.object({
  seed_integration_id: z.string().uuid().optional(),
  biz_id: z.string().uuid().optional(),
}).refine((value) => !!value.seed_integration_id || !!value.biz_id, {
  message: 'Missing seed_integration_id or biz_id',
});

type SeedIntegration = {
  id: string;
  biz_id: string;
  org_id: string;
  provider: string;
  is_active: boolean | null;
  refresh_token?: string | null;
  updated_at?: string | null;
};

function isAuthFailure(httpStatus: number, errorCode: string | null): boolean {
  return (
    httpStatus === 401
    || httpStatus === 403
    || errorCode === 'UNAUTHENTICATED'
    || errorCode === 'PERMISSION_DENIED'
    || errorCode === 'invalid_grant'
  );
}

async function resolveSeedIntegration(args: {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  userId: string;
  seedIntegrationId?: string;
  businessId?: string;
}): Promise<SeedIntegration | null> {
  const { supabase, userId, seedIntegrationId, businessId } = args;

  let row: SeedIntegration | null = null;
  if (seedIntegrationId) {
    const { data } = await supabase
      .from('integrations')
      .select('id, biz_id, org_id, provider, is_active, refresh_token, updated_at')
      .eq('id', seedIntegrationId)
      .eq('provider', 'google_business')
      .maybeSingle();
    row = (data || null) as SeedIntegration | null;
  } else if (businessId) {
    const { data } = await supabase
      .from('integrations')
      .select('id, biz_id, org_id, provider, is_active, refresh_token, updated_at')
      .eq('biz_id', businessId)
      .eq('provider', 'google_business')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    row = (data || null) as SeedIntegration | null;
  }

  if (!row) return null;

  const access = await hasAcceptedBusinessMembership({
    supabase,
    userId,
    businessId: row.biz_id,
    allowedRoles: ['owner', 'admin'],
  });
  if (!access.allowed) return null;
  return row;
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

    const [query, queryErr] = validateQuery(request, LocationsQuerySchema);
    if (queryErr) return withHeaders(queryErr);
    const payload = query as z.infer<typeof LocationsQuerySchema>;

    const seed = await resolveSeedIntegration({
      supabase,
      userId: user.id,
      seedIntegrationId: payload.seed_integration_id,
      businessId: payload.biz_id,
    });

    if (!seed) {
      return withHeaders(
        NextResponse.json(
          { error: 'not_found', message: 'No disponible', request_id: requestId },
          { status: 404 },
        ),
      );
    }

    let accessToken = '';
    try {
      const admin = getAdminClient();
      const tokens = await getOAuthTokens(admin, seed.id);
      accessToken = tokens.accessToken;
    } catch (tokenError: unknown) {
      log.warn('seed token unavailable for locations listing', {
        integration_id: seed.id,
        error: tokenError instanceof Error ? tokenError.message : String(tokenError),
      });
      return withHeaders(
        NextResponse.json({
          state: 'needs_reauth',
          provider: 'google_business',
          locations: [],
          request_id: requestId,
        }),
      );
    }

    const listed = await listGoogleBusinessLocations(accessToken);
    if (isAuthFailure(listed.httpStatus, listed.errorCode)) {
      return withHeaders(
        NextResponse.json({
          state: 'needs_reauth',
          provider: 'google_business',
          locations: [],
          request_id: requestId,
        }),
      );
    }

    if (listed.httpStatus >= 400) {
      log.warn('google locations upstream error', {
        integration_id: seed.id,
        http_status: listed.httpStatus,
        error_code: listed.errorCode,
      });
      return withHeaders(
        NextResponse.json({
          state: 'not_connected',
          provider: 'google_business',
          locations: [],
          request_id: requestId,
        }),
      );
    }

    return withHeaders(
      NextResponse.json({
        state: 'connected',
        provider: 'google_business',
        locations: listed.locations.map((item) => ({
          location_id: item.location_id,
          name: item.title,
          storeCode: null,
          address: item.address,
          city: item.city,
          country: item.country,
          primaryCategory: null,
          primary_phone: item.primary_phone,
          website_uri: item.website_uri,
          profilePhotoUrl: item.profile_photo_url,
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
