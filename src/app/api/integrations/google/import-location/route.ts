export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { validateBody } from '@/lib/validations';
import { validateCsrf } from '@/lib/security/csrf';
import { ACTIVE_ORG_COOKIE, parseCookieValue, resolveActiveMembership } from '@/lib/workspace/active-org';
import { normalizeMemberRole } from '@/lib/roles';
import { getGoogleLocalsLimit, normalizeGoogleLocationId, toSlugBase } from '@/lib/integrations/google/multilocal';
import { findGoogleLocationById, listGoogleBusinessLocations } from '@/lib/integrations/google/locations';
import { getAdminClient } from '@/lib/supabase/admin';
import { getOAuthTokens, saveOAuthTokens } from '@/lib/server/tokens';

const ImportLocationSchema = z.object({
  location_id: z.string().min(1),
  biz_id: z.string().uuid().optional(),
});

type MembershipRow = {
  id: string;
  org_id: string;
  role: string;
  is_default: boolean;
  created_at: string | null;
  accepted_at: string | null;
};

type OrgRow = {
  id: string;
  plan?: string | null;
  plan_code?: string | null;
};

type IntegrationSeedRow = {
  id: string;
  biz_id: string;
  is_active: boolean | null;
  refresh_token?: string | null;
  updated_at?: string | null;
};

type BusinessRow = {
  id: string;
  org_id: string;
  name: string;
  slug: string | null;
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

const REAUTH_MESSAGE = 'La connexió principal ha caducat; reconnecta un local per recuperar-los tots.';

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

function isAuthFailure(httpStatus: number, errorCode: string | null): boolean {
  return (
    httpStatus === 401
    || httpStatus === 403
    || errorCode === 'UNAUTHENTICATED'
    || errorCode === 'PERMISSION_DENIED'
    || errorCode === 'invalid_grant'
  );
}

async function pickUniqueSlug(args: {
  supabase: ReturnType<typeof createServerSupabaseClient>;
  orgId: string;
  baseSlug: string;
}): Promise<string> {
  const normalizedBase = args.baseSlug || `local-${Math.random().toString(36).slice(2, 8)}`;
  for (let index = 0; index < 50; index += 1) {
    const candidate = index === 0 ? normalizedBase : `${normalizedBase}-${index + 1}`;
    const { data, error } = await args.supabase
      .from('businesses')
      .select('id')
      .eq('org_id', args.orgId)
      .eq('slug', candidate)
      .maybeSingle();
    if (error) continue;
    if (!data) return candidate;
  }
  return `${normalizedBase}-${Date.now().toString(36)}`;
}

export async function POST(request: Request) {
  const blocked = validateCsrf(request);
  if (blocked) return blocked;

  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/integrations/google/import-location' });

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

    const [body, bodyErr] = await validateBody(request, ImportLocationSchema);
    if (bodyErr) return withHeaders(bodyErr);
    const payload = body as z.infer<typeof ImportLocationSchema>;

    const cookieOrgId = parseCookieValue(request.headers.get('cookie'), ACTIVE_ORG_COOKIE);
    const { data: memberships, error: membershipsError } = await supabase
      .from('memberships')
      .select('id, org_id, role, is_default, created_at, accepted_at')
      .eq('user_id', user.id)
      .not('accepted_at', 'is', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (membershipsError || !memberships || memberships.length === 0) {
      return withHeaders(
        NextResponse.json(
          { error: 'forbidden', message: 'No disponible', request_id: requestId },
          { status: 403 },
        ),
      );
    }

    const activeMembership = resolveActiveMembership(
      memberships as MembershipRow[],
      cookieOrgId,
    );
    if (!activeMembership) {
      return withHeaders(
        NextResponse.json(
          { error: 'forbidden', message: 'No disponible', request_id: requestId },
          { status: 403 },
        ),
      );
    }

    const normalizedRole = normalizeMemberRole((activeMembership as MembershipRow).role);
    if (normalizedRole !== 'owner' && normalizedRole !== 'admin') {
      return withHeaders(
        NextResponse.json(
          { error: 'forbidden', message: 'No tens permisos per importar locals.', request_id: requestId },
          { status: 403 },
        ),
      );
    }

    const orgId = activeMembership.org_id;

    if (payload.biz_id) {
      const { data: selectedBiz, error: selectedBizError } = await supabase
        .from('businesses')
        .select('id, org_id')
        .eq('id', payload.biz_id)
        .eq('org_id', orgId)
        .maybeSingle();
      if (selectedBizError || !selectedBiz) {
        return withHeaders(
          NextResponse.json(
            { error: 'not_found', message: 'No disponible', request_id: requestId },
            { status: 404 },
          ),
        );
      }
    }

    const { data: orgRowRaw, error: orgError } = await supabase
      .from('organizations')
      .select('id, plan, plan_code')
      .eq('id', orgId)
      .maybeSingle();

    if (orgError || !orgRowRaw) {
      return withHeaders(
        NextResponse.json(
          { error: 'internal', message: 'No hem pogut carregar el pla actual.', request_id: requestId },
          { status: 500 },
        ),
      );
    }
    const orgRow = orgRowRaw as OrgRow;
    const localsLimit = getGoogleLocalsLimit({ plan: orgRow.plan, planCode: orgRow.plan_code });

    const { count: businessesCount, error: businessesCountError } = await supabase
      .from('businesses')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_active', true);

    const currentCount = businessesCount || 0;
    if (businessesCountError) {
      log.warn('Could not verify business count for plan limit', {
        org_id: orgId,
        error_code: businessesCountError.code || null,
        error: businessesCountError.message || null,
      });
    } else if (currentCount >= localsLimit) {
      return withHeaders(
        NextResponse.json(
          {
            error: 'plan_limit',
            message: "Has arribat al límit d'establiments del teu pla.",
            limit: localsLimit,
            current: currentCount,
            request_id: requestId,
          },
          { status: 402 },
        ),
      );
    }

    const normalizedLocationId = normalizeGoogleLocationId(payload.location_id);
    if (!normalizedLocationId) {
      return withHeaders(
        NextResponse.json(
          { error: 'validation_error', message: 'location_id invàlid', request_id: requestId },
          { status: 400 },
        ),
      );
    }

    const { data: existingBusiness, error: existingBusinessError } = await supabase
      .from('businesses')
      .select('id, org_id, name, slug')
      .eq('google_location_id', normalizedLocationId)
      .maybeSingle();

    if (existingBusinessError && !isMissingDependencyError(existingBusinessError)) {
      return withHeaders(
        NextResponse.json(
          { error: 'internal', message: 'No hem pogut validar el local existent.', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    const existing = existingBusiness as BusinessRow | null;
    if (existing) {
      return withHeaders(
        NextResponse.json({
          created: false,
          biz_id: existing.id,
          name: existing.name,
          slug: existing.slug,
          request_id: requestId,
        }),
      );
    }

    const { data: integrations, error: integrationsError } = await supabase
      .from('integrations')
      .select('id, biz_id, is_active, refresh_token, updated_at')
      .eq('org_id', orgId)
      .eq('provider', 'google_business')
      .order('updated_at', { ascending: false });

    if (integrationsError && !isMissingDependencyError(integrationsError)) {
      log.warn('google import seed lookup failed', {
        org_id: orgId,
        error_code: integrationsError.code || null,
        error: integrationsError.message || null,
      });
    }

    const seedRows = (integrations || []) as IntegrationSeedRow[];
    const preferredSeed =
      (payload.biz_id
        ? (seedRows.find((row) => row.biz_id === payload.biz_id && row.is_active)
            || seedRows.find((row) => row.biz_id === payload.biz_id))
        : null)
      || seedRows.find((row) => row.is_active)
      || seedRows[0]
      || null;

    if (!preferredSeed) {
      return withHeaders(
        NextResponse.json(
          {
            error: 'needs_reauth',
            message: REAUTH_MESSAGE,
            request_id: requestId,
          },
          { status: 409 },
        ),
      );
    }

    let hasSecret = false;
    const { data: secretRow, error: secretError } = await supabase
      .from('integrations_secrets')
      .select('integration_id')
      .eq('integration_id', preferredSeed.id)
      .limit(1)
      .maybeSingle();

    if (secretError) {
      if (!isMissingDependencyError(secretError)) {
        log.warn('google import secret check failed', {
          integration_id: preferredSeed.id,
          error_code: secretError.code || null,
          error: secretError.message || null,
        });
      }
    } else {
      hasSecret = !!(secretRow as { integration_id?: string } | null)?.integration_id;
    }

    if (!preferredSeed.is_active || (!hasToken(preferredSeed.refresh_token) && !hasSecret)) {
      return withHeaders(
        NextResponse.json(
          {
            error: 'needs_reauth',
            message: REAUTH_MESSAGE,
            request_id: requestId,
          },
          { status: 409 },
        ),
      );
    }

    const admin = getAdminClient();
    let accessToken: string | null = null;
    let refreshToken: string | null = null;

    try {
      const tokens = await getOAuthTokens(admin, preferredSeed.id);
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
    } catch (tokenError: unknown) {
      log.warn('google import failed retrieving seed tokens', {
        integration_id: preferredSeed.id,
        error: tokenError instanceof Error ? tokenError.message : String(tokenError),
      });
      return withHeaders(
        NextResponse.json(
          {
            error: 'needs_reauth',
            message: REAUTH_MESSAGE,
            request_id: requestId,
          },
          { status: 409 },
        ),
      );
    }

    const googleLocations = await listGoogleBusinessLocations(accessToken);
    if (isAuthFailure(googleLocations.httpStatus, googleLocations.errorCode)) {
      return withHeaders(
        NextResponse.json(
          {
            error: 'needs_reauth',
            message: REAUTH_MESSAGE,
            request_id: requestId,
          },
          { status: 409 },
        ),
      );
    }

    if (googleLocations.httpStatus >= 400) {
      log.warn('google import locations upstream failure', {
        integration_id: preferredSeed.id,
        http_status: googleLocations.httpStatus,
        error_code: googleLocations.errorCode,
      });
      return withHeaders(
        NextResponse.json(
          {
            error: 'upstream_error',
            message: 'No hem pogut carregar els locals de Google Business.',
            request_id: requestId,
          },
          { status: 502 },
        ),
      );
    }

    const selectedLocation = findGoogleLocationById(googleLocations.locations, normalizedLocationId);
    if (!selectedLocation) {
      return withHeaders(
        NextResponse.json(
          {
            error: 'not_found',
            message: "No s'ha trobat aquest local a Google Business.",
            request_id: requestId,
          },
          { status: 404 },
        ),
      );
    }

    const slugBase = toSlugBase(selectedLocation.title, selectedLocation.city) || `local-${normalizedLocationId}`;
    const slug = await pickUniqueSlug({ supabase, orgId, baseSlug: slugBase });

    const { data: maxSortData } = await supabase
      .from('businesses')
      .select('sort_order')
      .eq('org_id', orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSortOrder = ((maxSortData as { sort_order?: number } | null)?.sort_order ?? -1) + 1;

    let createdBusiness: BusinessRow | null = null;
    const insertPayload: Record<string, unknown> = {
      org_id: orgId,
      name: selectedLocation.title,
      slug,
      type: 'other',
      url: selectedLocation.website_uri,
      address: selectedLocation.address,
      city: selectedLocation.city,
      country: selectedLocation.country || 'ES',
      default_language: 'ca',
      formality: 'tu',
      is_active: true,
      sort_order: nextSortOrder,
      google_location_id: selectedLocation.location_id,
      google_account_id: selectedLocation.account_name,
    };

    const insertResult = await supabase
      .from('businesses')
      .insert(insertPayload)
      .select('id, org_id, name, slug')
      .single();

    if (insertResult.error) {
      if (insertResult.error.code === '23505') {
        const { data: raceBusiness } = await supabase
          .from('businesses')
          .select('id, org_id, name, slug')
          .eq('google_location_id', selectedLocation.location_id)
          .maybeSingle();

        const winner = raceBusiness as BusinessRow | null;
        if (winner) {
          return withHeaders(
            NextResponse.json({
              created: false,
              biz_id: winner.id,
              name: winner.name,
              slug: winner.slug,
              request_id: requestId,
            }),
          );
        }
      }

      if (isMissingDependencyError(insertResult.error)) {
        return withHeaders(
          NextResponse.json(
            {
              error: 'missing_dependency',
              message: "Falten migracions per importar locals (google_location_id).",
              request_id: requestId,
            },
            { status: 500 },
          ),
        );
      }

      return withHeaders(
        NextResponse.json(
          { error: 'internal', message: 'No hem pogut crear el local.', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    createdBusiness = insertResult.data as BusinessRow;
    if (!createdBusiness?.id) {
      return withHeaders(
        NextResponse.json(
          { error: 'internal', message: 'No hem pogut crear el local.', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    let clonedIntegrationId: string | null = null;
    const existingIntegrationResult = await admin
      .from('integrations')
      .select('id')
      .eq('biz_id', createdBusiness.id)
      .eq('provider', 'google_business')
      .maybeSingle();

    if (existingIntegrationResult.error) {
      log.error('google import integration lookup failed', {
        biz_id: createdBusiness.id,
        error_code: existingIntegrationResult.error.code || null,
        error: existingIntegrationResult.error.message || null,
      });
      return withHeaders(
        NextResponse.json(
          { error: 'internal', message: 'No hem pogut preparar la integració.', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    if (existingIntegrationResult.data?.id) {
      clonedIntegrationId = existingIntegrationResult.data.id as string;
      const { error: updateCloneError } = await admin
        .from('integrations')
        .update({
          is_active: true,
          account_id: selectedLocation.account_name,
        })
        .eq('id', clonedIntegrationId);
      if (updateCloneError) {
        log.error('google import integration clone update failed', {
          integration_id: clonedIntegrationId,
          error_code: updateCloneError.code || null,
          error: updateCloneError.message || null,
        });
        return withHeaders(
          NextResponse.json(
            { error: 'internal', message: 'No hem pogut preparar la integració.', request_id: requestId },
            { status: 500 },
          ),
        );
      }
    } else {
      const createCloneResult = await admin
        .from('integrations')
        .insert({
          biz_id: createdBusiness.id,
          org_id: orgId,
          provider: 'google_business',
          account_id: selectedLocation.account_name,
          is_active: true,
        })
        .select('id')
        .single();

      if (createCloneResult.error || !createCloneResult.data?.id) {
        log.error('google import integration clone create failed', {
          biz_id: createdBusiness.id,
          error_code: createCloneResult.error?.code || null,
          error: createCloneResult.error?.message || null,
        });
        return withHeaders(
          NextResponse.json(
            { error: 'internal', message: 'No hem pogut preparar la integració.', request_id: requestId },
            { status: 500 },
          ),
        );
      }
      clonedIntegrationId = createCloneResult.data.id as string;
    }

    if (!clonedIntegrationId) {
      return withHeaders(
        NextResponse.json(
          { error: 'internal', message: 'No hem pogut preparar la integració.', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    try {
      await saveOAuthTokens(admin, clonedIntegrationId, accessToken, refreshToken);
    } catch (saveError: unknown) {
      log.error('google import token clone failed', {
        integration_id: clonedIntegrationId,
        error: saveError instanceof Error ? saveError.message : String(saveError),
      });
      return withHeaders(
        NextResponse.json(
          { error: 'internal', message: 'No hem pogut guardar els tokens del local.', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    const assignmentResult = await admin
      .from('business_memberships')
      .upsert(
        {
          user_id: user.id,
          org_id: orgId,
          business_id: createdBusiness.id,
          role_override: null,
          is_active: true,
        },
        { onConflict: 'user_id,business_id' },
      );

    if (assignmentResult.error && !isMissingDependencyError(assignmentResult.error)) {
      log.warn('google import business assignment upsert failed', {
        user_id: user.id,
        biz_id: createdBusiness.id,
        error_code: assignmentResult.error.code || null,
        error: assignmentResult.error.message || null,
      });
    }

    return withHeaders(
      NextResponse.json(
        {
          created: true,
          biz_id: createdBusiness.id,
          name: createdBusiness.name,
          slug: createdBusiness.slug,
          request_id: requestId,
        },
        { status: 201 },
      ),
    );
  } catch (error) {
    log.error('Unhandled google import-location error', {
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
