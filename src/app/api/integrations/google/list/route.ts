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
};

type IntegrationRow = {
  id: string;
  biz_id: string;
  is_active: boolean | null;
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

function integrationState(row: IntegrationRow | null): 'connected' | 'needs_reauth' | 'not_connected' {
  if (!row) return 'not_connected';
  if (row.last_error_code === 'invalid_grant') return 'needs_reauth';
  if (row.status === 'needs_reauth') return 'needs_reauth';
  if (row.is_active) return 'connected';
  return 'needs_reauth';
}

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/integrations/google/list' });

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
    const { data: memberships, error: membershipError } = await supabase
      .from('memberships')
      .select('id, org_id, role, is_default, created_at, accepted_at')
      .eq('user_id', user.id)
      .not('accepted_at', 'is', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (membershipError || !memberships || memberships.length === 0) {
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

    const normalizedRole = normalizeMemberRole(activeMembership.role);
    let businesses = [] as BusinessRow[];

    const allBizQuery = await supabase
      .from('businesses')
      .select('id, org_id, name, slug, city')
      .eq('org_id', activeMembership.org_id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (allBizQuery.error) {
      log.warn('google list businesses query failed', {
        user_id: user.id,
        org_id: activeMembership.org_id,
        error_code: allBizQuery.error.code || null,
        error: allBizQuery.error.message || null,
      });
    } else {
      businesses = (allBizQuery.data || []) as BusinessRow[];
    }

    if (normalizedRole !== 'owner' && normalizedRole !== 'admin') {
      const assignments = await supabase
        .from('business_memberships')
        .select('business_id')
        .eq('org_id', activeMembership.org_id)
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (assignments.error) {
        if (!isMissingDependencyError(assignments.error)) {
          log.warn('google list business assignments failed', {
            user_id: user.id,
            org_id: activeMembership.org_id,
            error_code: assignments.error.code || null,
            error: assignments.error.message || null,
          });
          businesses = [];
        }
      } else {
        const allowedIds = new Set(
          (assignments.data || [])
            .map((row) => (row as { business_id?: string }).business_id)
            .filter((id): id is string => typeof id === 'string'),
        );
        businesses = businesses.filter((row) => allowedIds.has(row.id));
      }
    }

    const bizIds = businesses.map((row) => row.id);
    let integrations = [] as IntegrationRow[];
    if (bizIds.length > 0) {
      const withStatus = await supabase
        .from('integrations')
        .select('id, biz_id, is_active, status, last_error_code, updated_at')
        .in('biz_id', bizIds)
        .eq('provider', 'google_business')
        .order('updated_at', { ascending: false });

      if (withStatus.error && isMissingDependencyError(withStatus.error)) {
        const fallback = await supabase
          .from('integrations')
          .select('id, biz_id, is_active, updated_at')
          .in('biz_id', bizIds)
          .eq('provider', 'google_business')
          .order('updated_at', { ascending: false });
        if (!fallback.error) {
          integrations = (fallback.data || []) as IntegrationRow[];
        }
      } else if (!withStatus.error) {
        integrations = (withStatus.data || []) as IntegrationRow[];
      }
    }

    const latestByBiz = new Map<string, IntegrationRow>();
    for (const row of integrations) {
      if (!latestByBiz.has(row.biz_id)) latestByBiz.set(row.biz_id, row);
    }

    const locals = businesses.map((row) => {
      const integration = latestByBiz.get(row.id) || null;
      return {
        biz_id: row.id,
        biz_name: row.name,
        slug: row.slug,
        city: row.city,
        integration_id: integration?.id || null,
        is_active: integration?.is_active ?? false,
        updated_at: integration?.updated_at || null,
        state: integrationState(integration),
      };
    });

    return withHeaders(
      NextResponse.json({
        locals,
        request_id: requestId,
      }),
    );
  } catch (error) {
    log.error('Unhandled google list error', {
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
