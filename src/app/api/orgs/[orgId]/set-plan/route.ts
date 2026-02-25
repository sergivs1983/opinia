export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
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
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const [routeParams, paramsErr] = validateParams(params, OrgSetPlanParamsSchema);
  if (paramsErr) return paramsErr;

  const [body, bodyErr] = await validateBody(request, OrgSetPlanSchema);
  if (bodyErr) return bodyErr;

  const secretAuthorized = hasValidAdminSecret(request);
  const supabase = createServerSupabaseClient();

  if (!secretAuthorized) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

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
  const payload = {
    plan_code: seatPlan.plan_code,
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
    return NextResponse.json(
      {
        error: 'schema_missing',
        message: "Falten columnes de límits de pla. Executa la migració 'phase-t-plan-business-limits-social-posts.sql'.",
      },
      { status: 409 },
    );
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    await normalizeOrgRolesForPlan(admin, {
      orgId: routeParams.orgId,
      planCode: seatPlan.plan_code,
    });
  } catch (normalizeError: unknown) {
    return NextResponse.json(
      {
        error: 'role_normalization_failed',
        message: normalizeError instanceof Error ? normalizeError.message : 'No hem pogut normalitzar els rols del pla.',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    org_id: routeParams.orgId,
    plan_code: seatPlan.plan_code,
    seats_limit: seatPlan.seats_limit,
    business_limit: seatPlan.business_limit,
  });
}
