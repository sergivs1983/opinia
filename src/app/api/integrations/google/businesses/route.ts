export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { ACTIVE_ORG_COOKIE, parseCookieValue, resolveActiveMembership } from '@/lib/workspace/active-org';
import { normalizeMemberRole } from '@/lib/roles';

type MembershipRow = {
  id: string;
  org_id: string;
  role: string;
  is_default: boolean;
  created_at: string | null;
  accepted_at: string | null;
};

type BusinessRow = {
  id: string;
  org_id: string;
  name: string;
  slug: string | null;
  city: string | null;
  google_location_id?: string | null;
};

type IntegrationRow = {
  id: string;
  biz_id: string;
  is_active: boolean | null;
  refresh_token?: string | null;
  status?: string | null;
  last_error_code?: string | null;
  updated_at?: string | null;
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type GoogleState = 'connected' | 'needs_reauth' | 'not_connected';

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

function resolveState(args: {
  integration: IntegrationRow | null;
  hasSecret: boolean;
}): GoogleState {
  if (!args.integration) return 'not_connected';
  if (args.integration.last_error_code === 'invalid_grant') return 'needs_reauth';
  if (args.integration.status === 'needs_reauth') return 'needs_reauth';
  if (args.integration.is_active && (hasToken(args.integration.refresh_token) || args.hasSecret)) {
    return 'connected';
  }
  return 'needs_reauth';
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/integrations/google/businesses' });

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
          { error: 'not_found', message: 'No disponible', request_id: requestId },
          { status: 404 },
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
          { error: 'not_found', message: 'No disponible', request_id: requestId },
          { status: 404 },
        ),
      );
    }

    let businessRows: BusinessRow[] = [];
    let businessSelectError: SupabaseErrorLike | null = null;

    const withGoogleFields = await supabase
      .from('businesses')
      .select('id, org_id, name, slug, city, google_location_id')
      .eq('org_id', activeMembership.org_id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (withGoogleFields.error && isMissingDependencyError(withGoogleFields.error)) {
      const fallbackBusinesses = await supabase
        .from('businesses')
        .select('id, org_id, name, slug, city')
        .eq('org_id', activeMembership.org_id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (fallbackBusinesses.error) {
        businessSelectError = fallbackBusinesses.error;
      } else {
        businessRows = ((fallbackBusinesses.data || []) as BusinessRow[]).map((row) => ({
          ...row,
          google_location_id: null,
        }));
      }
    } else if (withGoogleFields.error) {
      businessSelectError = withGoogleFields.error;
    } else {
      businessRows = (withGoogleFields.data || []) as BusinessRow[];
    }

    if (businessSelectError) {
      log.error('google businesses query failed', {
        user_id: user.id,
        error_code: businessSelectError.code || null,
        error: businessSelectError.message || null,
      });
      return withHeaders(
        NextResponse.json(
          { error: 'internal', message: 'Error intern del servidor', request_id: requestId },
          { status: 500 },
        ),
      );
    }

    const normalizedRole = normalizeMemberRole(activeMembership.role);
    let accessibleBusinesses = businessRows;

    if (normalizedRole !== 'owner' && normalizedRole !== 'admin') {
      const assignments = await supabase
        .from('business_memberships')
        .select('business_id')
        .eq('org_id', activeMembership.org_id)
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (assignments.error) {
        if (isMissingDependencyError(assignments.error)) {
          log.warn('business_memberships table missing, falling back to org business visibility', {
            user_id: user.id,
            org_id: activeMembership.org_id,
          });
        } else {
          log.warn('business_memberships query failed, returning empty list', {
            user_id: user.id,
            org_id: activeMembership.org_id,
            error_code: assignments.error.code || null,
            error: assignments.error.message || null,
          });
          accessibleBusinesses = [];
        }
      } else {
        const allowedIds = new Set(
          (assignments.data || [])
            .map((row) => (row as { business_id?: string }).business_id)
            .filter((id): id is string => typeof id === 'string'),
        );
        accessibleBusinesses = businessRows.filter((row) => allowedIds.has(row.id));
      }
    }

    if (accessibleBusinesses.length === 0) {
      return withHeaders(
        NextResponse.json({
          businesses: [],
          request_id: requestId,
        }),
      );
    }

    const bizIds = accessibleBusinesses.map((row) => row.id);

    let integrationRows: IntegrationRow[] = [];
    const withStatus = await supabase
      .from('integrations')
      .select('id, biz_id, is_active, refresh_token, status, last_error_code, updated_at')
      .in('biz_id', bizIds)
      .eq('provider', 'google_business')
      .order('updated_at', { ascending: false });

    if (withStatus.error && isMissingDependencyError(withStatus.error)) {
      const fallbackIntegrations = await supabase
        .from('integrations')
        .select('id, biz_id, is_active, refresh_token, updated_at')
        .in('biz_id', bizIds)
        .eq('provider', 'google_business')
        .order('updated_at', { ascending: false });
      if (fallbackIntegrations.error) {
        if (!isMissingDependencyError(fallbackIntegrations.error)) {
          log.warn('google integrations fallback query failed', {
            error_code: fallbackIntegrations.error.code || null,
            error: fallbackIntegrations.error.message || null,
            org_id: activeMembership.org_id,
          });
        }
      } else {
        integrationRows = (fallbackIntegrations.data || []) as IntegrationRow[];
      }
    } else if (withStatus.error) {
      if (!isMissingDependencyError(withStatus.error)) {
        log.warn('google integrations query failed', {
          error_code: withStatus.error.code || null,
          error: withStatus.error.message || null,
          org_id: activeMembership.org_id,
        });
      }
    } else {
      integrationRows = (withStatus.data || []) as IntegrationRow[];
    }

    const latestByBusiness = new Map<string, IntegrationRow>();
    for (const row of integrationRows) {
      if (!latestByBusiness.has(row.biz_id)) {
        latestByBusiness.set(row.biz_id, row);
      }
    }

    const integrationIds = Array.from(latestByBusiness.values()).map((row) => row.id);
    const integrationsWithSecrets = new Set<string>();

    if (integrationIds.length > 0) {
      const { data: secrets, error: secretsError } = await supabase
        .from('integrations_secrets')
        .select('integration_id')
        .in('integration_id', integrationIds);

      if (secretsError) {
        if (!isMissingDependencyError(secretsError)) {
          log.warn('google integrations secrets query failed', {
            error_code: secretsError.code || null,
            error: secretsError.message || null,
          });
        }
      } else {
        for (const row of secrets || []) {
          const integrationId = (row as { integration_id?: string }).integration_id;
          if (integrationId) integrationsWithSecrets.add(integrationId);
        }
      }
    }

    const responseRows = accessibleBusinesses.map((row) => {
      const integration = latestByBusiness.get(row.id) || null;
      const gbpState = resolveState({
        integration,
        hasSecret: integration ? integrationsWithSecrets.has(integration.id) : false,
      });
      return {
        biz_id: row.id,
        name: row.name,
        slug: row.slug,
        city: row.city,
        google_location_id: row.google_location_id || null,
        gbp_state: gbpState,
      };
    });

    return withHeaders(
      NextResponse.json({
        businesses: responseRows,
        request_id: requestId,
      }),
    );
  } catch (error) {
    log.error('Unhandled google businesses error', {
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
