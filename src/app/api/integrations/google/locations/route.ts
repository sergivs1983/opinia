export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { validateQuery } from '@/lib/validations';
import { requireBizAccessPatternB } from '@/lib/api-handler';
import { getAdminClient } from '@/lib/supabase/admin';
import { getOAuthTokens } from '@/lib/server/tokens';
import { listGoogleBusinessLocations } from '@/lib/integrations/google/locations';
import { roleCanManageIntegrations } from '@/lib/roles';

const LocationsQuerySchema = z.object({
  seed_biz_id: z.string().uuid(),
});

type SeedIntegration = {
  id: string;
  biz_id: string;
  org_id: string;
  provider: string;
  is_active: boolean | null;
  updated_at?: string | null;
};

function isAuthFailure(httpStatus: number, errorCode: string | null): boolean {
  return (
    httpStatus === 401
    || httpStatus === 403
    || errorCode === 'UNAUTHENTICATED'
    || errorCode === 'invalid_grant'
  );
}

async function resolveSeedIntegration(args: {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  seedBusinessId: string;
}): Promise<SeedIntegration | null> {
  const { supabase, seedBusinessId } = args;
  const { data } = await supabase
    .from('integrations')
    .select('id, biz_id, org_id, provider, is_active, updated_at')
    .eq('biz_id', seedBusinessId)
    .eq('provider', 'google_business')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = (data || null) as SeedIntegration | null;

  if (!row) return null;
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
    const gate = await requireBizAccessPatternB(request, payload.seed_biz_id, {
      supabase,
      user,
      queryBizId: payload.seed_biz_id,
    });
    if (gate instanceof NextResponse) return withHeaders(gate);
    if (!roleCanManageIntegrations(gate.role)) {
      return withHeaders(
        NextResponse.json(
          { error: 'not_found', message: 'No disponible', request_id: requestId },
          { status: 404 },
        ),
      );
    }

    const seed = await resolveSeedIntegration({
      supabase,
      seedBusinessId: gate.bizId,
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
    if (listed.httpStatus === 403 && listed.errorCode === 'PERMISSION_DENIED') {
      // TODO(flow-c): add explicit scope upgrade UX when product supports progressive scope upgrades.
      return withHeaders(
        NextResponse.json(
          {
            error: 'missing_scope_business_manage',
            message: 'Cal reconnectar amb permisos de Google Business.',
            request_id: requestId,
          },
          { status: 409 },
        ),
      );
    }

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
          account_id: item.account_name,
          location_name: `locations/${item.location_id}`,
          title: item.title,
          address: item.address,
          city: item.city,
          country: item.country,
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
