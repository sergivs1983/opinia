export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAcceptedOrgMembership } from '@/lib/authz';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import { getDraftUsage, getOrgPlanConfig } from '@/lib/ai/quota';
import { createLogger } from '@/lib/logger';
import { normalizeMemberRole } from '@/lib/roles';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateQuery } from '@/lib/validations';

const QuerySchema = z.object({
  org_id: z.string().uuid(),
});

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/billing/status' });

  try {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return withStandardHeaders(
        NextResponse.json({ error: 'unauthorized', message: 'Auth required', request_id: requestId }, { status: 401 }),
        requestId,
      );
    }

    const [query, queryErr] = validateQuery(request, QuerySchema);
    if (queryErr) return withStandardHeaders(queryErr, requestId);
    const orgId = query.org_id;

    const membership = await getAcceptedOrgMembership({
      supabase,
      userId: user.id,
      orgId,
    });

    const normalizedRole = membership ? normalizeMemberRole(membership.role) : null;
    if (!membership || (normalizedRole !== 'owner' && normalizedRole !== 'manager')) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const [{ data: orgData, error: orgError }, entitlements, usage] = await Promise.all([
      supabase
        .from('organizations')
        .select('id, plan, plan_code, billing_status, stripe_customer_id, stripe_subscription_id, stripe_price_id')
        .eq('id', orgId)
        .maybeSingle(),
      getOrgEntitlements({ supabase, orgId }),
      getDraftUsage(supabase, orgId),
    ]);

    if (orgError || !orgData) {
      return withStandardHeaders(
        NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
        requestId,
      );
    }

    const planConfig = getOrgPlanConfig(entitlements.plan_code);
    const usageLimit = usage?.limit && usage.limit > 0 ? usage.limit : planConfig.drafts_limit;
    const usageUsed = usage?.used && usage.used > 0 ? usage.used : 0;
    const usageMonth = usage?.month || new Date().toISOString().slice(0, 7) + '-01';

    return withStandardHeaders(
      NextResponse.json({
        ok: true,
        org: {
          id: (orgData as { id: string }).id,
          plan: (orgData as { plan?: string | null }).plan || null,
          plan_code: (orgData as { plan_code?: string | null }).plan_code || entitlements.plan_code,
          billing_status: (orgData as { billing_status?: string | null }).billing_status || null,
          stripe_customer_id: (orgData as { stripe_customer_id?: string | null }).stripe_customer_id ? '***' : null,
          stripe_subscription_id: (orgData as { stripe_subscription_id?: string | null }).stripe_subscription_id ? '***' : null,
          stripe_price_id: (orgData as { stripe_price_id?: string | null }).stripe_price_id || null,
        },
        entitlements: {
          locations_limit: entitlements.locations_limit,
          seats_limit: entitlements.seats_limit,
          signals_level: entitlements.signals_level,
          lito_copy_enabled: entitlements.lito_drafts_limit > 0,
        },
        usage: {
          used: usageUsed,
          limit: usageLimit,
          remaining: Math.max(usageLimit - usageUsed, 0),
          month: usageMonth,
        },
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('billing_status_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
