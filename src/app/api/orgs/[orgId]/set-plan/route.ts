export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { NextResponse } from 'next/server';
import { normalizePlanCode } from '@/lib/billing/entitlements';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trackEvent } from '@/lib/telemetry';
import { hasAcceptedOrgMembership } from '@/lib/authz';
import {
  isMissingSeatColumnsError,
  mapSeatPlan,
  normalizeOrgRolesForPlan,
} from '@/lib/seats';
import {
  OrgSetPlanParamsSchema,
  OrgSetPlanSchema,
  validateBody,
  validateParams,
} from '@/lib/validations';

function hasValidAdminSecret(request: Request): boolean {
  const expectedSecret = process.env.ORG_PLAN_ADMIN_SECRET;
  const providedSecret = request.headers.get('x-admin-secret')?.trim();
  return Boolean(expectedSecret && providedSecret && expectedSecret === providedSecret);
}

export async function POST(
  request: Request,
  { params }: { params: { orgId: string } },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const [routeParams, paramsErr] = validateParams(params, OrgSetPlanParamsSchema);
  if (paramsErr) return paramsErr;

  const [body, bodyErr] = await validateBody(request, OrgSetPlanSchema);
  if (bodyErr) return bodyErr;

  const secretAuthorized = hasValidAdminSecret(request);
  const supabase = createServerSupabaseClient();
  let actorUserId: string | null = null;

  if (!secretAuthorized) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    actorUserId = user.id;

    const hasMembership = await hasAcceptedOrgMembership({
      supabase,
      userId: user.id,
      orgId: routeParams.orgId,
      allowedRoles: ['owner'],
    });

    if (!hasMembership) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  const admin = createAdminClient();
  const seatPlan = mapSeatPlan(body.plan_code);
  const canonicalPlanCode = normalizePlanCode(seatPlan.plan_code);
  const payload = {
    plan_code: canonicalPlanCode,
    seats_limit: seatPlan.seats_limit,
    business_limit: seatPlan.business_limit,
    plan_price_cents: seatPlan.plan_price_cents,
    billing_status: 'active',
  };

  const { error } = await admin
    .from('organizations')
    .update(payload)
    .eq('id', routeParams.orgId);

  if (error && isMissingSeatColumnsError(error)) {
    await trackEvent({
      supabase: admin,
      orgId: routeParams.orgId,
      userId: actorUserId,
      name: 'checkout_failed',
      props: {
        source: secretAuthorized ? 'set_plan_admin_secret' : 'set_plan_owner',
        plan: canonicalPlanCode,
        reason: 'schema_missing',
      },
      requestId,
    });
    return NextResponse.json(
      {
        error: 'schema_missing',
        message: "Falten columnes de límits de pla. Executa la migració '20260314030000_phase_t_plan_business_limits_social_posts.sql'.",
      },
      { status: 409 },
    );
  }

  if (error) {
    await trackEvent({
      supabase: admin,
      orgId: routeParams.orgId,
      userId: actorUserId,
      name: 'checkout_failed',
      props: {
        source: secretAuthorized ? 'set_plan_admin_secret' : 'set_plan_owner',
        plan: canonicalPlanCode,
        reason: error.code || error.message || 'update_failed',
      },
      requestId,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    await normalizeOrgRolesForPlan(admin, {
      orgId: routeParams.orgId,
      planCode: seatPlan.plan_code,
    });
  } catch (normalizeError: unknown) {
    await trackEvent({
      supabase: admin,
      orgId: routeParams.orgId,
      userId: actorUserId,
      name: 'checkout_failed',
      props: {
        source: secretAuthorized ? 'set_plan_admin_secret' : 'set_plan_owner',
        plan: canonicalPlanCode,
        reason: 'role_normalization_failed',
        detail: normalizeError instanceof Error ? normalizeError.message : String(normalizeError),
      },
      requestId,
    });
    return NextResponse.json(
      {
        error: 'role_normalization_failed',
        message: normalizeError instanceof Error ? normalizeError.message : 'No hem pogut normalitzar els rols del pla.',
      },
      { status: 500 },
    );
  }

  await trackEvent({
    supabase: admin,
    orgId: routeParams.orgId,
    userId: actorUserId,
    name: 'checkout_success',
    props: {
      source: secretAuthorized ? 'set_plan_admin_secret' : 'set_plan_owner',
      plan: canonicalPlanCode,
    },
    requestId,
  });

  return NextResponse.json({
    ok: true,
    org_id: routeParams.orgId,
    plan_code: canonicalPlanCode,
    seats_limit: seatPlan.seats_limit,
    business_limit: seatPlan.business_limit,
  });
}
