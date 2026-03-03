export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getUsageSummary, PLANS } from '@/lib/billing/plans';
import { createAdminClient } from '@/lib/supabase/admin';
import { trackEvent } from '@/lib/telemetry';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { validateBody, BillingUpdateSchema } from '@/lib/validations';
import { hasAcceptedOrgMembership } from '@/lib/authz';
import { requireBizAccessPatternB } from '@/lib/api-handler';
import {
  normalizeOrgRolesForPlan,
} from '@/lib/seats';
import {
  canonicalPlanFromAny,
  getEntitlementsForPlan,
  getStripePriceForPlan,
  toLegacySeatPlanCode,
} from '@/lib/billing/stripe-plans';

const KNOWN_PLAN_IDS = new Set([
  'starter',
  'business',
  'scale',
  'starter_29',
  'starter_49',
  'free',
  'pro',
  'pro_49',
  'pro_149',
  'scale_149',
  'agency',
  'enterprise',
]);

function withStandardHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/**
 * GET /api/billing — Returns current usage, plan info
 * POST /api/billing — Upgrade/downgrade plan
 */
export async function GET(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return withStandardHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), requestId);
  }

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('org_id');
  if (!orgId) {
    return withStandardHeaders(NextResponse.json({ error: 'org_id required' }, { status: 400 }), requestId);
  }

  const hasMembership = await hasAcceptedOrgMembership({
    supabase,
    userId: user.id,
    orgId,
  });
  if (!hasMembership) {
    return withStandardHeaders(NextResponse.json({ error: 'forbidden' }, { status: 403 }), requestId);
  }

  const summary = await getUsageSummary(supabase, orgId);

  return withStandardHeaders(
    NextResponse.json({
      plan: summary.plan,
      org: {
        id: summary.org.id,
        name: summary.org.name,
        plan: summary.org.plan,
        stripe_customer_id: summary.org.stripe_customer_id ? '***' : null,
        stripe_subscription_id: summary.org.stripe_subscription_id ? '***' : null,
      },
      usage: summary.current_month,
      limits: {
        max_reviews_mo: summary.plan.max_reviews_mo,
        max_businesses: summary.plan.max_businesses,
        max_team_members: summary.plan.max_team_members,
      },
      plans: Object.values(PLANS).map(p => ({
        id: p.id,
        name: p.name,
        price_monthly: p.price_monthly,
        max_reviews_mo: p.max_reviews_mo,
        max_businesses: p.max_businesses,
        max_team_members: p.max_team_members,
        features: p.features,
      })),
      request_id: requestId,
    }),
    requestId,
  );
}

export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return withStandardHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), requestId);
  }

  // ── Validate ──
  const [body, err] = await validateBody(request, BillingUpdateSchema);
  if (err) return err;

  if (!KNOWN_PLAN_IDS.has((body.plan_id || '').trim().toLowerCase())) {
    return withStandardHeaders(
      NextResponse.json({ error: 'invalid_plan', message: 'Invalid plan id', request_id: requestId }, { status: 400 }),
      requestId,
    );
  }

  const canonicalPlanCode = canonicalPlanFromAny(body.plan_id);
  const canonicalEntitlements = getEntitlementsForPlan(canonicalPlanCode);

  const workspaceBizId = request.headers.get('x-biz-id')?.trim() || null;
  const access = await requireBizAccessPatternB(request, workspaceBizId, {
    supabase,
    user,
    headerBizId: workspaceBizId,
  });
  if (access instanceof NextResponse) return withStandardHeaders(access, requestId);
  if (access.membership.orgId !== body.org_id || access.role !== 'owner') {
    return withStandardHeaders(
      NextResponse.json({ error: 'not_found', message: 'No disponible', request_id: requestId }, { status: 404 }),
      requestId,
    );
  }

  const emitBillingEvent = async (eventName: string, props: Record<string, unknown>) => {
    await trackEvent({
      supabase,
      orgId: body.org_id,
      userId: user.id,
      name: eventName,
      props,
      requestId,
    });
  };

  const { data: orgData, error: orgError } = await supabase
    .from('organizations')
    .select('id, stripe_customer_id')
    .eq('id', body.org_id)
    .maybeSingle();

  if (orgError || !orgData) {
    await emitBillingEvent('checkout_failed', {
      plan: canonicalPlanCode,
      source: 'billing_api',
      reason: 'org_not_found',
    });
    return withStandardHeaders(
      NextResponse.json({ error: 'not_found', message: 'Organization not found', request_id: requestId }, { status: 404 }),
      requestId,
    );
  }

  const stripePriceId = getStripePriceForPlan(canonicalPlanCode);
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey && stripePriceId) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || new URL(request.url).origin;
    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('success_url', `${baseUrl}/dashboard/plans?checkout=success&plan=${canonicalPlanCode}`);
    params.set('cancel_url', `${baseUrl}/dashboard/plans?checkout=cancel&plan=${canonicalPlanCode}`);
    params.set('line_items[0][price]', stripePriceId);
    params.set('line_items[0][quantity]', '1');
    params.set('allow_promotion_codes', 'true');
    params.set('client_reference_id', body.org_id);
    params.set('metadata[org_id]', body.org_id);
    params.set('metadata[target_plan]', canonicalPlanCode);
    params.set('subscription_data[metadata][org_id]', body.org_id);
    params.set('subscription_data[metadata][target_plan]', canonicalPlanCode);

    const existingCustomerId = (orgData as { stripe_customer_id?: string | null }).stripe_customer_id;
    if (existingCustomerId) {
      params.set('customer', existingCustomerId);
    }

    const checkoutResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      cache: 'no-store',
    });

    const checkoutPayload = (await checkoutResponse.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };

    if (!checkoutResponse.ok || !checkoutPayload.id || !checkoutPayload.url) {
      await emitBillingEvent('checkout_failed', {
        plan: canonicalPlanCode,
        source: 'billing_api',
        reason: 'stripe_checkout_create_failed',
        detail: checkoutPayload.error?.message || `status_${checkoutResponse.status}`,
      });
      return withStandardHeaders(
        NextResponse.json(
          {
            error: 'stripe_checkout_failed',
            message: checkoutPayload.error?.message || 'No hem pogut crear la sessió de Stripe.',
            request_id: requestId,
          },
          { status: 502 },
        ),
        requestId,
      );
    }

    await emitBillingEvent('checkout_started', {
      plan: canonicalPlanCode,
      source: 'billing_api',
      stripe_price_id: stripePriceId,
      stripe_session_id: checkoutPayload.id,
    });
    return withStandardHeaders(NextResponse.json({
      action: 'stripe_checkout',
      plan_id: canonicalPlanCode,
      checkout_url: checkoutPayload.url,
      session_id: checkoutPayload.id,
      request_id: requestId,
    }), requestId);
  }

  // Direct plan change fallback (dev / Stripe not configured)
  const directUpdatePayload = {
    plan: canonicalPlanCode,
    plan_code: canonicalPlanCode,
    max_businesses: canonicalEntitlements.locations_limit,
    max_reviews_mo: canonicalEntitlements.drafts_limit,
    max_team_members: canonicalEntitlements.seats_limit,
    seats_limit: canonicalEntitlements.seats_limit,
    business_limit: canonicalEntitlements.locations_limit,
    plan_price_cents: canonicalEntitlements.monthly_price_cents,
    billing_status: 'active',
  };

  const { error: updateError } = await supabase
    .from('organizations')
    .update(directUpdatePayload)
    .eq('id', body.org_id);

  if (updateError) {
    await emitBillingEvent('checkout_failed', {
      plan: canonicalPlanCode,
      source: 'billing_api',
      reason: 'update_error',
      detail: updateError.code || updateError.message || 'unknown',
    });
    return withStandardHeaders(NextResponse.json({ error: updateError.message }, { status: 500 }), requestId);
  }

  const admin = createAdminClient();
  await admin.from('org_entitlements').upsert(
    {
      org_id: body.org_id,
      locations_limit: canonicalEntitlements.locations_limit,
      seats_limit: canonicalEntitlements.seats_limit,
      lito_drafts_limit: canonicalEntitlements.drafts_limit,
      signals_level: canonicalEntitlements.signals_level,
      staff_daily_limit: 10,
      staff_monthly_ratio_cap: 0.3,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id' },
  );

  try {
    await normalizeOrgRolesForPlan(supabase, {
      orgId: body.org_id,
      planCode: toLegacySeatPlanCode(canonicalPlanCode),
    });
  } catch (normalizeError: unknown) {
    await emitBillingEvent('checkout_failed', {
      plan: canonicalPlanCode,
      source: 'billing_api',
      reason: 'role_normalization_failed',
      detail: normalizeError instanceof Error ? normalizeError.message : String(normalizeError),
    });
    return withStandardHeaders(NextResponse.json({
      error: 'role_normalization_failed',
      message: normalizeError instanceof Error ? normalizeError.message : 'No hem pogut normalitzar els rols del pla.',
    }, { status: 500 }), requestId);
  }

  await emitBillingEvent('checkout_success', {
    plan: canonicalPlanCode,
    amount: canonicalEntitlements.monthly_price_cents / 100,
    currency: 'eur',
    source: 'billing_api',
    mode: 'direct_fallback',
  });

  return withStandardHeaders(NextResponse.json({
    success: true,
    plan: canonicalPlanCode,
    message: `Pla actualitzat a ${canonicalPlanCode}`,
    request_id: requestId,
  }), requestId);
}
