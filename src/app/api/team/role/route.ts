export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { validateBody, TeamRoleSchema } from '@/lib/validations';
import { asMembershipRoleFilter, normalizeMemberRole, TEAM_MANAGEMENT_ROLES } from '@/lib/roles';
import { hasAcceptedOrgMembership } from '@/lib/authz';
import { requireResourceAccessPatternB, ResourceTable } from '@/lib/api-handler';
import { assertRoleAllowedForOrgPlan, OrgRoleNotAllowedForPlanError } from '@/lib/seats';

/**
 * PATCH /api/team/role
 * Body: { membership_id, role: 'owner'|'admin'|'manager'|'responder' }
 */
export async function PATCH(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // ── Validate ──
  const [body, err] = await validateBody(request, TeamRoleSchema);
  if (err) return err;
  const gate = await requireResourceAccessPatternB(request, body.membership_id, ResourceTable.Memberships, {
    supabase,
    user,
  });
  if (gate instanceof NextResponse) return gate;

  // Prevent demoting last owner
  const { data: target } = await supabase
    .from('memberships')
    .select('id, user_id, org_id, role')
    .eq('id', body.membership_id)
    .eq('org_id', gate.membership.orgId)
    .single();

  if (!target) return NextResponse.json({ error: 'not_found', message: 'No disponible' }, { status: 404 });

  const canManageRoles = await hasAcceptedOrgMembership({
    supabase,
    userId: user.id,
    orgId: target.org_id,
    allowedRoles: asMembershipRoleFilter(TEAM_MANAGEMENT_ROLES),
  });

  if (!canManageRoles) {
    return NextResponse.json({
      error: 'not_found',
      message: 'No disponible',
    }, { status: 404 });
  }

  const normalizedRole = normalizeMemberRole(body.role);

  try {
    await assertRoleAllowedForOrgPlan(supabase, {
      orgId: target.org_id,
      role: normalizedRole,
    });
  } catch (roleError: unknown) {
    if (roleError instanceof OrgRoleNotAllowedForPlanError) {
      return NextResponse.json({
        error: roleError.code,
        message: roleError.message,
      }, { status: roleError.status });
    }
    return NextResponse.json({ error: 'plan_check_failed', message: "No hem pogut validar els permisos del pla." }, { status: 500 });
  }

  if (target.user_id === user.id && target.role === 'owner' && normalizedRole !== 'owner') {
    const { count } = await supabase
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', target.org_id)
      .eq('role', 'owner')
      .not('id', 'eq', body.membership_id)
      .not('accepted_at', 'is', null);

    if (!count || count === 0) {
      return NextResponse.json({
        error: 'last_owner',
        message: 'Cannot demote the last owner. Transfer ownership first.',
      }, { status: 409 });
    }
  }

  const { data, error } = await supabase
    .from('memberships')
    .update({ role: normalizedRole })
    .eq('id', body.membership_id)
    .select()
    .single();

  if (error) {
    if (error.code === '42501' || error.message.includes('policy')) {
      return NextResponse.json({ error: 'not_found', message: 'No disponible' }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ membership: data });
}
