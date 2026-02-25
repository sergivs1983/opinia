export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { getUsageSummary, PLANS } from '@/lib/billing/plans';
import { validateBody, BillingUpdateSchema } from '@/lib/validations';
import { hasAcceptedOrgMembership } from '@/lib/authz';
import {
  isMissingSeatColumnsError,
  mapBillingPlanToSeatPlan,
  normalizeOrgRolesForPlan,
} from '@/lib/seats';

/**
 * GET /api/billing — Returns current usage, plan info
 * POST /api/billing — Upgrade/downgrade plan
 */
export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('org_id');
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 });

  const hasMembership = await hasAcceptedOrgMembership({
    supabase,
    userId: user.id,
    orgId,
  });
  if (!hasMembership) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const admin = createAdminClient();
  const summary = await getUsageSummary(admin, orgId);

  return NextResponse.json({
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
  });
}

export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Validate ──
  const [body, err] = await validateBody(request, BillingUpdateSchema);
  if (err) return err;

  const plan = PLANS[body.plan_id];
  if (!plan) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });

  const hasMembership = await hasAcceptedOrgMembership({
    supabase,
    userId: user.id,
    orgId: body.org_id,
    allowedRoles: ['owner'],
  });
  if (!hasMembership) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const admin = createAdminClient();

  // Check if Stripe is configured for paid plans
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (plan.price_monthly > 0 && stripeKey && plan.stripe_price_id) {
    return NextResponse.json({
      action: 'stripe_checkout',
      message: 'Stripe Checkout integration ready — configure STRIPE_SECRET_KEY and price IDs.',
      plan_id: body.plan_id,
    });
  }

  // Direct plan change (for free plan or dev mode)
  const baseUpdate = {
    plan: body.plan_id,
    max_businesses: plan.max_businesses,
    max_reviews_mo: plan.max_reviews_mo,
    max_team_members: plan.max_team_members,
  };
  const seatPlan = mapBillingPlanToSeatPlan(body.plan_id, plan.price_monthly);
  const updateWithSeats = {
    ...baseUpdate,
    plan_code: seatPlan.plan_code,
    seats_limit: seatPlan.seats_limit,
    business_limit: seatPlan.business_limit,
    plan_price_cents: seatPlan.plan_price_cents,
    billing_status: 'active',
  };

  let { error: updateError } = await admin
    .from('organizations')
    .update(updateWithSeats)
    .eq('id', body.org_id);

  if (updateError && isMissingSeatColumnsError(updateError)) {
    const retry = await admin
      .from('organizations')
      .update(baseUpdate)
      .eq('id', body.org_id);
    updateError = retry.error;
  }

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  try {
    await normalizeOrgRolesForPlan(admin, {
      orgId: body.org_id,
      planCode: seatPlan.plan_code,
    });
  } catch (normalizeError: unknown) {
    return NextResponse.json({
      error: 'role_normalization_failed',
      message: normalizeError instanceof Error ? normalizeError.message : 'No hem pogut normalitzar els rols del pla.',
    }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    plan: body.plan_id,
    message: `Pla actualitzat a ${plan.name}`,
  });
}
