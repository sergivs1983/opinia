export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { validateBody } from '@/lib/validations';
import { validateCsrf } from '@/lib/security/csrf';
import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { getGoogleLocalsLimit, normalizeGoogleLocationId, toSlugBase } from '@/lib/integrations/google/multilocal';
import { getAdminClient } from '@/lib/supabase/admin';
import { getOAuthTokens, saveOAuthTokens } from '@/lib/server/tokens';

const ImportLocationsSchema = z.object({
  seed_biz_id: z.string().uuid(),
  locations: z.array(
    z.object({
      account_id: z.string().min(1).optional().nullable(),
      location_name: z.string().min(1),
      title: z.string().min(1),
      address: z.string().optional().nullable(),
      city: z.string().optional().nullable(),
      country: z.string().optional().nullable(),
      profile_photo_url: z.string().url().optional().nullable(),
    }),
  ).min(1).max(100),
  mode: z.enum(['auto', 'select']).optional(),
});

type SeedIntegrationRow = {
  id: string;
  biz_id: string;
  org_id: string;
  account_id?: string | null;
  scopes?: unknown;
  token_expires_at?: string | null;
};

type OrgRow = {
  id: string;
  plan?: string | null;
  plan_code?: string | null;
};

type SeedBusinessRow = {
  id: string;
  org_id: string;
  default_language: string | null;
};

type ExistingBusinessRow = {
  id: string;
  google_location_name: string | null;
  name: string;
  slug: string | null;
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type ImportErrorItem = {
  location_name: string;
  reason: string;
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

function normalizeGoogleLocationName(value: string): string {
  const normalizedId = normalizeGoogleLocationId(value);
  if (!normalizedId) return '';
  return `locations/${normalizedId}`;
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

async function ensureIntegration(args: {
  admin: ReturnType<typeof getAdminClient>;
  log: ReturnType<typeof createLogger>;
  orgId: string;
  bizId: string;
  accountId: string | null;
  scopes: unknown;
  tokenExpiresAt: string | null;
  accessToken: string;
  refreshToken: string | null;
}): Promise<{ ok: boolean; integrationId?: string; reason?: string }> {
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
    return { ok: false, reason: 'integration_lookup_failed' };
  }

  const payload: Record<string, unknown> = {
    org_id: orgId,
    biz_id: bizId,
    provider: 'google_business',
    is_active: true,
    account_id: accountId,
    scopes: scopes ?? null,
    token_expires_at: tokenExpiresAt,
  };

  let integrationId = (existing.data?.id as string | undefined) || null;
  if (integrationId) {
    const updated = await admin
      .from('integrations')
      .update(payload)
      .eq('id', integrationId)
      .select('id')
      .single();
    if (updated.error || !updated.data?.id) {
      log.error('google import integration update failed', {
        integration_id: integrationId,
        error_code: updated.error?.code || null,
        error: updated.error?.message || null,
      });
      return { ok: false, reason: 'integration_update_failed' };
    }
    integrationId = updated.data.id as string;
  } else {
    const inserted = await admin
      .from('integrations')
      .insert(payload)
      .select('id')
      .single();
    if (inserted.error || !inserted.data?.id) {
      log.error('google import integration create failed', {
        biz_id: bizId,
        error_code: inserted.error?.code || null,
        error: inserted.error?.message || null,
      });
      return { ok: false, reason: 'integration_create_failed' };
    }
    integrationId = inserted.data.id as string;
  }

  try {
    await saveOAuthTokens(admin, integrationId, accessToken, refreshToken);
  } catch (error) {
    log.error('google import integration token save failed', {
      integration_id: integrationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'token_copy_failed' };
  }

  return { ok: true, integrationId };
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

    const access = await hasAcceptedBusinessMembership({
      supabase,
      userId: user.id,
      businessId: payload.seed_biz_id,
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

    const [seedIntegrationResult, seedBusinessResult] = await Promise.all([
      supabase
        .from('integrations')
        .select('id, biz_id, org_id, account_id, scopes, token_expires_at')
        .eq('biz_id', payload.seed_biz_id)
        .eq('provider', 'google_business')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('businesses')
        .select('id, org_id, default_language')
        .eq('id', payload.seed_biz_id)
        .single(),
    ]);

    if (seedBusinessResult.error || !seedBusinessResult.data) {
      return withHeaders(
        NextResponse.json(
          { error: 'not_found', message: 'No disponible', request_id: requestId },
          { status: 404 },
        ),
      );
    }

    if (seedIntegrationResult.error || !seedIntegrationResult.data) {
      return withHeaders(
        NextResponse.json(
          { error: 'needs_seed_connection', message: 'Connecta primer el local llavor amb Google Business.', request_id: requestId },
          { status: 409 },
        ),
      );
    }

    const seedIntegration = seedIntegrationResult.data as SeedIntegrationRow;
    const seedBusiness = seedBusinessResult.data as SeedBusinessRow;

    if (seedIntegration.org_id !== seedBusiness.org_id) {
      return withHeaders(
        NextResponse.json(
          { error: 'not_found', message: 'No disponible', request_id: requestId },
          { status: 404 },
        ),
      );
    }

    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .select('id, plan, plan_code')
      .eq('id', seedIntegration.org_id)
      .maybeSingle();

    if (orgError || !orgData) {
      return withHeaders(
        NextResponse.json(
          { error: 'internal', message: 'No hem pogut carregar el pla actual.', request_id: requestId },
          { status: 500 },
        ),
      );
    }
    const org = orgData as OrgRow;

    const normalizedInput = payload.locations
      .map((entry) => ({
        ...entry,
        location_name: normalizeGoogleLocationName(entry.location_name),
        location_id: normalizeGoogleLocationId(entry.location_name),
      }))
      .filter((entry) => entry.location_name && entry.location_id);

    const dedupedByLocation = new Map<string, (typeof normalizedInput)[number]>();
    for (const entry of normalizedInput) {
      if (!dedupedByLocation.has(entry.location_name)) {
        dedupedByLocation.set(entry.location_name, entry);
      }
    }
    const deduped = Array.from(dedupedByLocation.values());
    if (deduped.length === 0) {
      return withHeaders(
        NextResponse.json(
          { error: 'validation_error', message: 'No hi ha cap location vàlida per importar.', request_id: requestId },
          { status: 400 },
        ),
      );
    }

    const [countResult, existingResult] = await Promise.all([
      supabase
        .from('businesses')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', seedIntegration.org_id)
        .eq('is_active', true),
      supabase
        .from('businesses')
        .select('id, google_location_name, name, slug')
        .eq('org_id', seedIntegration.org_id)
        .in('google_location_name', deduped.map((entry) => entry.location_name)),
    ]);

    if (existingResult.error && isMissingDependencyError(existingResult.error)) {
      return withHeaders(
        NextResponse.json(
          {
            error: 'missing_dependency',
            message: "Falta la migració de google_location_name. Aplica-la i executa NOTIFY pgrst, 'reload schema'.",
            request_id: requestId,
          },
          { status: 500 },
        ),
      );
    }

    if (countResult.error || existingResult.error) {
      log.error('google import preflight failed', {
        count_error: countResult.error?.message || null,
        existing_error: existingResult.error?.message || null,
      });
      return withHeaders(
        NextResponse.json(
          { error: 'internal', message: 'No hem pogut validar els locals existents.', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    const businessesUsed = countResult.count || 0;
    const maxLocals = getGoogleLocalsLimit({ plan: org.plan, planCode: org.plan_code });
    const existingByName = new Map<string, ExistingBusinessRow>();
    for (const row of (existingResult.data || []) as ExistingBusinessRow[]) {
      if (row.google_location_name) existingByName.set(row.google_location_name, row);
    }

    const wouldCreate = deduped.filter((entry) => !existingByName.has(entry.location_name)).length;
    if (businessesUsed + wouldCreate > maxLocals) {
      return withHeaders(
        NextResponse.json(
          {
            error: 'plan_limit',
            message: "Has arribat al límit de locals del teu pla. Actualitza el pla per afegir-ne més.",
            limit: maxLocals,
            current: businessesUsed,
            request_id: requestId,
          },
          { status: 403 },
        ),
      );
    }

    const admin = getAdminClient();
    let seedAccessToken = '';
    let seedRefreshToken: string | null = null;
    try {
      const seedTokens = await getOAuthTokens(admin, seedIntegration.id);
      seedAccessToken = seedTokens.accessToken;
      seedRefreshToken = seedTokens.refreshToken;
    } catch (error) {
      log.warn('google import seed tokens unavailable', {
        integration_id: seedIntegration.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return withHeaders(
        NextResponse.json(
          { error: 'needs_reauth', message: REAUTH_MESSAGE, request_id: requestId },
          { status: 409 },
        ),
      );
    }

    let created = 0;
    let skippedExisting = 0;
    const errors: ImportErrorItem[] = [];

    for (const entry of deduped) {
      let business = existingByName.get(entry.location_name) || null;

      if (!business) {
        const slugBase = toSlugBase(entry.title, entry.city) || `local-${entry.location_id}`;
        const slug = await pickUniqueSlug({
          supabase,
          orgId: seedIntegration.org_id,
          baseSlug: slugBase,
        });

        const inserted = await supabase
          .from('businesses')
          .insert({
            org_id: seedIntegration.org_id,
            name: entry.title,
            slug,
            type: 'restaurant',
            address: entry.address || null,
            url: null,
            city: entry.city || null,
            country: entry.country || 'ES',
            default_language: seedBusiness.default_language || 'ca',
            formality: 'tu',
            is_active: true,
            google_location_name: entry.location_name,
            google_location_id: entry.location_id,
            google_account_id: entry.account_id || seedIntegration.account_id || null,
          })
          .select('id, google_location_name, name, slug')
          .single();

        if (inserted.error) {
          if (inserted.error.code === '23505') {
            const race = await supabase
              .from('businesses')
              .select('id, google_location_name, name, slug')
              .eq('org_id', seedIntegration.org_id)
              .eq('google_location_name', entry.location_name)
              .maybeSingle();
            business = (race.data as ExistingBusinessRow | null) || null;
          } else {
            errors.push({ location_name: entry.location_name, reason: 'business_create_failed' });
            continue;
          }
        } else {
          business = inserted.data as ExistingBusinessRow;
          created += 1;
          existingByName.set(entry.location_name, business);
        }
      } else {
        skippedExisting += 1;
      }

      if (!business?.id) {
        errors.push({ location_name: entry.location_name, reason: 'business_create_failed' });
        continue;
      }

      const ensured = await ensureIntegration({
        admin,
        log,
        orgId: seedIntegration.org_id,
        bizId: business.id,
        accountId: entry.account_id || seedIntegration.account_id || null,
        scopes: seedIntegration.scopes,
        tokenExpiresAt: seedIntegration.token_expires_at || null,
        accessToken: seedAccessToken,
        refreshToken: seedRefreshToken,
      });

      if (!ensured.ok) {
        errors.push({ location_name: entry.location_name, reason: ensured.reason || 'integration_failed' });
        continue;
      }

      const assignment = await admin
        .from('business_memberships')
        .upsert(
          {
            user_id: user.id,
            org_id: seedIntegration.org_id,
            business_id: business.id,
            role_override: null,
            is_active: true,
          },
          { onConflict: 'user_id,business_id' },
        );

      if (assignment.error && !isMissingDependencyError(assignment.error)) {
        log.warn('google import assignment upsert failed', {
          user_id: user.id,
          biz_id: business.id,
          error_code: assignment.error.code || null,
          error: assignment.error.message || null,
        });
      }
    }

    return withHeaders(
      NextResponse.json({
        created,
        skipped_existing: skippedExisting,
        errors,
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
