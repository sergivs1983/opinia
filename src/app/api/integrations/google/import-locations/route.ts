export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { validateBody } from '@/lib/validations';
import { validateCsrf } from '@/lib/security/csrf';
import { normalizeMemberRole } from '@/lib/roles';
import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { getGoogleLocalsLimit, normalizeGoogleLocationId, toSlugBase } from '@/lib/integrations/google/multilocal';
import { findGoogleLocationById, listGoogleBusinessLocations } from '@/lib/integrations/google/locations';
import { getAdminClient } from '@/lib/supabase/admin';
import { getOAuthTokens, saveOAuthTokens } from '@/lib/server/tokens';

const ImportLocationsSchema = z.object({
  seed_integration_id: z.string().uuid(),
  location_ids: z.array(z.string().min(1)).min(1).max(50),
});

type SeedIntegrationRow = {
  id: string;
  biz_id: string;
  org_id: string;
  provider: string;
  is_active: boolean | null;
  refresh_token?: string | null;
  account_id?: string | null;
  scopes?: unknown;
  token_expires_at?: string | null;
};

type OrgRow = {
  id: string;
  plan?: string | null;
  plan_code?: string | null;
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

type ImportItem = {
  biz_id?: string;
  integration_id?: string;
  status: 'imported' | 'skipped';
  reason?: string;
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

async function ensureIntegrationClone(args: {
  admin: ReturnType<typeof getAdminClient>;
  log: ReturnType<typeof createLogger>;
  orgId: string;
  bizId: string;
  accountId: string | null;
  scopes: unknown;
  tokenExpiresAt: string | null;
  accessToken: string;
  refreshToken: string | null;
}): Promise<{ integrationId: string | null; error: string | null }> {
  const {
    admin,
    log,
    orgId,
    bizId,
    accountId,
    scopes,
    tokenExpiresAt,
    accessToken,
    refreshToken,
  } = args;

  const existing = await admin
    .from('integrations')
    .select('id')
    .eq('biz_id', bizId)
    .eq('provider', 'google_business')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    log.error('google import integration lookup failed', {
      biz_id: bizId,
      error_code: existing.error.code || null,
      error: existing.error.message || null,
    });
    return { integrationId: null, error: 'integration_lookup_failed' };
  }

  let integrationId = (existing.data?.id as string | undefined) || null;
  const basePayload: Record<string, unknown> = {
    org_id: orgId,
    biz_id: bizId,
    provider: 'google_business',
    is_active: true,
    account_id: accountId,
    scopes: scopes ?? null,
    token_expires_at: tokenExpiresAt,
  };

  if (integrationId) {
    const updateResult = await admin
      .from('integrations')
      .update(basePayload)
      .eq('id', integrationId)
      .select('id')
      .single();
    if (updateResult.error) {
      log.error('google import integration update failed', {
        integration_id: integrationId,
        error_code: updateResult.error.code || null,
        error: updateResult.error.message || null,
      });
      return { integrationId: null, error: 'integration_update_failed' };
    }
    integrationId = updateResult.data?.id as string;
  } else {
    const insertResult = await admin
      .from('integrations')
      .insert(basePayload)
      .select('id')
      .single();
    if (insertResult.error || !insertResult.data?.id) {
      log.error('google import integration create failed', {
        biz_id: bizId,
        error_code: insertResult.error?.code || null,
        error: insertResult.error?.message || null,
      });
      return { integrationId: null, error: 'integration_create_failed' };
    }
    integrationId = insertResult.data.id as string;
  }

  try {
    await saveOAuthTokens(admin, integrationId, accessToken, refreshToken);
  } catch (saveError: unknown) {
    log.error('google import integration token clone failed', {
      integration_id: integrationId,
      error: saveError instanceof Error ? saveError.message : String(saveError),
    });
    return { integrationId: null, error: 'token_clone_failed' };
  }

  return { integrationId, error: null };
}

export async function POST(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/integrations/google/import-locations' });

  const withHeaders = (response: NextResponse) => {
    response.headers.set('x-request-id', requestId);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };

  const blocked = validateCsrf(request);
  if (blocked) return withHeaders(blocked);

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

    const [body, bodyErr] = await validateBody(request, ImportLocationsSchema);
    if (bodyErr) return withHeaders(bodyErr);
    const payload = body as z.infer<typeof ImportLocationsSchema>;

    const { data: seedData, error: seedError } = await supabase
      .from('integrations')
      .select('id, biz_id, org_id, provider, is_active, refresh_token, account_id, scopes, token_expires_at')
      .eq('id', payload.seed_integration_id)
      .eq('provider', 'google_business')
      .maybeSingle();

    const seed = (seedData || null) as SeedIntegrationRow | null;
    if (seedError || !seed) {
      return withHeaders(
        NextResponse.json(
          { error: 'not_found', message: 'No disponible', request_id: requestId },
          { status: 404 },
        ),
      );
    }

    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: seed.biz_id,
      allowedRoles: ['owner', 'admin'],
    });

    if (!access.allowed) {
      return withHeaders(
        NextResponse.json(
          { error: 'not_found', message: 'No disponible', request_id: requestId },
          { status: 404 },
        ),
      );
    }

    const { data: orgRaw, error: orgError } = await supabase
      .from('organizations')
      .select('id, plan, plan_code')
      .eq('id', seed.org_id)
      .maybeSingle();

    if (orgError || !orgRaw) {
      return withHeaders(
        NextResponse.json(
          { error: 'internal', message: 'No hem pogut carregar el pla actual.', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    const roleCheck = await supabase
      .from('memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('org_id', seed.org_id)
      .not('accepted_at', 'is', null)
      .limit(1)
      .maybeSingle();
    const role = normalizeMemberRole((roleCheck.data as { role?: string } | null)?.role);
    if (role !== 'owner' && role !== 'admin') {
      return withHeaders(
        NextResponse.json(
          { error: 'not_found', message: 'No disponible', request_id: requestId },
          { status: 404 },
        ),
      );
    }

    const org = orgRaw as OrgRow;
    const localsLimit = getGoogleLocalsLimit({ plan: org.plan, planCode: org.plan_code });
    const { count: businessesCount } = await supabase
      .from('businesses')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', seed.org_id)
      .eq('is_active', true);
    let businessesUsed = businessesCount || 0;

    const admin = getAdminClient();
    let seedAccessToken = '';
    let seedRefreshToken: string | null = null;
    try {
      const tokens = await getOAuthTokens(admin, seed.id);
      seedAccessToken = tokens.accessToken;
      seedRefreshToken = tokens.refreshToken;
    } catch (tokenError: unknown) {
      log.warn('google import-locations seed token unavailable', {
        integration_id: seed.id,
        error: tokenError instanceof Error ? tokenError.message : String(tokenError),
      });
      return withHeaders(
        NextResponse.json(
          { error: 'needs_reauth', message: REAUTH_MESSAGE, request_id: requestId },
          { status: 409 },
        ),
      );
    }

    const listed = await listGoogleBusinessLocations(seedAccessToken);
    if (isAuthFailure(listed.httpStatus, listed.errorCode)) {
      return withHeaders(
        NextResponse.json(
          { error: 'needs_reauth', message: REAUTH_MESSAGE, request_id: requestId },
          { status: 409 },
        ),
      );
    }

    if (listed.httpStatus >= 400) {
      log.warn('google import-locations upstream failure', {
        integration_id: seed.id,
        http_status: listed.httpStatus,
        error_code: listed.errorCode,
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

    const normalizedIds = Array.from(
      new Set(payload.location_ids.map((entry) => normalizeGoogleLocationId(entry)).filter(Boolean)),
    );

    const items: ImportItem[] = [];
    let imported = 0;

    if (normalizedIds.length === 0) {
      return withHeaders(
        NextResponse.json(
          { error: 'validation_error', message: 'location_ids invàlids', request_id: requestId },
          { status: 400 },
        ),
      );
    }

    if (businessesUsed >= localsLimit) {
      return withHeaders(
        NextResponse.json(
          {
            error: 'plan_limit',
            message: "Has arribat al límit d'establiments del teu pla.",
            limit: localsLimit,
            current: businessesUsed,
            request_id: requestId,
          },
          { status: 402 },
        ),
      );
    }

    for (const locationId of normalizedIds) {
      const googleLocation = findGoogleLocationById(listed.locations, locationId);
      if (!googleLocation) {
        items.push({ status: 'skipped', reason: 'location_not_found' });
        continue;
      }

      const existingQuery = await supabase
        .from('businesses')
        .select('id, org_id, name, slug')
        .eq('org_id', seed.org_id)
        .eq('google_location_id', googleLocation.location_id)
        .maybeSingle();

      if (existingQuery.error && !isMissingDependencyError(existingQuery.error)) {
        log.error('google import-locations existing business lookup failed', {
          org_id: seed.org_id,
          location_id: googleLocation.location_id,
          error_code: existingQuery.error.code || null,
          error: existingQuery.error.message || null,
        });
        items.push({ status: 'skipped', reason: 'business_lookup_failed' });
        continue;
      }

      if (existingQuery.error && isMissingDependencyError(existingQuery.error)) {
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

      let business = (existingQuery.data || null) as BusinessRow | null;
      const alreadyExists = Boolean(business);

      if (!business) {
        if (businessesUsed >= localsLimit) {
          items.push({ status: 'skipped', reason: 'plan_limit' });
          continue;
        }

        const slugBase = toSlugBase(googleLocation.title, googleLocation.city) || `local-${googleLocation.location_id}`;
        const slug = await pickUniqueSlug({ supabase, orgId: seed.org_id, baseSlug: slugBase });

        const { data: maxSortData } = await supabase
          .from('businesses')
          .select('sort_order')
          .eq('org_id', seed.org_id)
          .order('sort_order', { ascending: false })
          .limit(1)
          .maybeSingle();
        const nextSortOrder = ((maxSortData as { sort_order?: number } | null)?.sort_order ?? -1) + 1;

        const insertPayload: Record<string, unknown> = {
          org_id: seed.org_id,
          name: googleLocation.title,
          slug,
          type: 'other',
          url: googleLocation.website_uri,
          address: googleLocation.address,
          city: googleLocation.city,
          country: googleLocation.country || 'ES',
          default_language: 'ca',
          formality: 'tu',
          is_active: true,
          sort_order: nextSortOrder,
          google_location_id: googleLocation.location_id,
          google_account_id: googleLocation.account_name,
        };

        const insertResult = await supabase
          .from('businesses')
          .insert(insertPayload)
          .select('id, org_id, name, slug')
          .single();

        if (insertResult.error) {
          if (insertResult.error.code === '23505') {
            const race = await supabase
              .from('businesses')
              .select('id, org_id, name, slug')
              .eq('org_id', seed.org_id)
              .eq('google_location_id', googleLocation.location_id)
              .maybeSingle();
            business = (race.data || null) as BusinessRow | null;
          } else {
            log.error('google import-locations business create failed', {
              org_id: seed.org_id,
              location_id: googleLocation.location_id,
              error_code: insertResult.error.code || null,
              error: insertResult.error.message || null,
            });
          }
        } else {
          business = insertResult.data as BusinessRow;
          businessesUsed += 1;
        }
      }

      if (!business?.id) {
        items.push({ status: 'skipped', reason: 'business_create_failed' });
        continue;
      }

      const cloned = await ensureIntegrationClone({
        admin,
        log,
        orgId: seed.org_id,
        bizId: business.id,
        accountId: googleLocation.account_name || seed.account_id || null,
        scopes: seed.scopes ?? null,
        tokenExpiresAt: seed.token_expires_at ?? null,
        accessToken: seedAccessToken,
        refreshToken: seedRefreshToken,
      });

      if (!cloned.integrationId) {
        items.push({ biz_id: business.id, status: 'skipped', reason: cloned.error || 'integration_error' });
        continue;
      }

      const assignment = await admin
        .from('business_memberships')
        .upsert(
          {
            user_id: user.id,
            org_id: seed.org_id,
            business_id: business.id,
            role_override: null,
            is_active: true,
          },
          { onConflict: 'user_id,business_id' },
        );

      if (assignment.error && !isMissingDependencyError(assignment.error)) {
        log.warn('google import-locations assignment upsert failed', {
          user_id: user.id,
          biz_id: business.id,
          error_code: assignment.error.code || null,
          error: assignment.error.message || null,
        });
      }

      if (alreadyExists) {
        items.push({
          biz_id: business.id,
          integration_id: cloned.integrationId,
          status: 'skipped',
          reason: 'already_exists',
        });
      } else {
        imported += 1;
        items.push({
          biz_id: business.id,
          integration_id: cloned.integrationId,
          status: 'imported',
        });
      }
    }
    const skipped = items.filter((item) => item.status === 'skipped').length;

    return withHeaders(
      NextResponse.json({
        imported,
        skipped,
        items,
        request_id: requestId,
      }),
    );
  } catch (error) {
    log.error('Unhandled google import-locations error', {
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
