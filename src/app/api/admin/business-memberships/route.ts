export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { hasAcceptedOrgMembership } from '@/lib/authz';
import { normalizeMemberRole, asMembershipRoleFilter, TEAM_MANAGEMENT_ROLES } from '@/lib/roles';
import { assertRoleAllowedForOrgPlan, OrgRoleNotAllowedForPlanError } from '@/lib/seats';
import {
  validateBody,
  validateQuery,
  AdminBusinessAssignmentsQuerySchema,
  AdminBusinessAssignmentsUpdateSchema,
} from '@/lib/validations';

type BusinessMembershipsErrorKind = 'missing_table' | 'schema_cache' | 'other';

function classifyBusinessMembershipsError(error: unknown): BusinessMembershipsErrorKind {
  const err = error as { message?: string; code?: string } | null;
  const message = (err?.message || '').toLowerCase();
  const code = (err?.code || '').toUpperCase();

  if (code === 'PGRST205' || code === 'PGRST204' || message.includes('schema cache')) {
    return 'schema_cache';
  }

  if (code === '42P01') return 'missing_table';
  if (
    message.includes('relation')
    && message.includes('business_memberships')
    && message.includes('does not exist')
  ) {
    return 'missing_table';
  }

  return 'other';
}

export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [query, queryErr] = validateQuery(request, AdminBusinessAssignmentsQuerySchema);
  if (queryErr) return queryErr;

  const canManage = await hasAcceptedOrgMembership({
    supabase,
    userId: user.id,
    orgId: query.org_id,
    allowedRoles: asMembershipRoleFilter(TEAM_MANAGEMENT_ROLES),
  });
  if (!canManage) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('business_memberships')
    .select('id, org_id, business_id, user_id, role_override, is_active, created_at, updated_at')
    .eq('org_id', query.org_id)
    .order('created_at', { ascending: true });

  if (error) {
    const errorKind = classifyBusinessMembershipsError(error);
    if (errorKind === 'schema_cache') {
      return NextResponse.json({
        assignments: [],
        warning: 'schema_cache_stale',
        message: "No hem pogut validar l'esquema ara mateix. Refresca i, si cal, executa NOTIFY pgrst, 'reload schema'.",
      });
    }
    if (errorKind === 'missing_table') {
      return NextResponse.json({
        error: 'schema_missing',
        message: "Falta la taula business_memberships. Executa la migració 'phase-s-team-rbac-business-scope.sql'.",
      }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ assignments: data || [] });
}

export async function PATCH(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [body, bodyErr] = await validateBody(request, AdminBusinessAssignmentsUpdateSchema);
  if (bodyErr) return bodyErr;

  const canManage = await hasAcceptedOrgMembership({
    supabase,
    userId: user.id,
    orgId: body.org_id,
    allowedRoles: asMembershipRoleFilter(TEAM_MANAGEMENT_ROLES),
  });
  if (!canManage) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { data: targetMembership, error: targetMembershipError } = await supabase
    .from('memberships')
    .select('id, user_id, org_id, role')
    .eq('id', body.membership_id)
    .eq('org_id', body.org_id)
    .single();

  if (targetMembershipError || !targetMembership) {
    return NextResponse.json({ error: 'not_found', message: 'Membership no trobat' }, { status: 404 });
  }

  const uniqueBusinessIds = Array.from(new Set(body.business_ids));
  if (uniqueBusinessIds.length > 0) {
    const { data: orgBusinesses, error: orgBusinessesError } = await supabase
      .from('businesses')
      .select('id')
      .eq('org_id', body.org_id)
      .in('id', uniqueBusinessIds);

    if (orgBusinessesError) {
      return NextResponse.json({ error: orgBusinessesError.message }, { status: 500 });
    }

    if ((orgBusinesses || []).length !== uniqueBusinessIds.length) {
      return NextResponse.json({
        error: 'validation_error',
        message: 'Hi ha negocis fora de l’organització seleccionada.',
      }, { status: 400 });
    }
  }

  const normalizedOverride = body.role_override
    ? normalizeMemberRole(body.role_override)
    : null;

  if (normalizedOverride) {
    try {
      await assertRoleAllowedForOrgPlan(supabase, {
        orgId: body.org_id,
        role: normalizedOverride,
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
  }

  const { error: deactivateError } = await supabase
    .from('business_memberships')
    .update({ is_active: false, role_override: normalizedOverride })
    .eq('org_id', body.org_id)
    .eq('user_id', targetMembership.user_id);

  if (deactivateError) {
    const errorKind = classifyBusinessMembershipsError(deactivateError);
    if (errorKind === 'schema_cache') {
      return NextResponse.json({
        error: 'schema_cache_stale',
        message: "No hem pogut validar l'esquema ara mateix. Refresca i torna-ho a provar.",
      }, { status: 503 });
    }
    if (errorKind === 'missing_table') {
      return NextResponse.json({
        error: 'schema_missing',
        message: "Falta la taula business_memberships. Executa la migració 'phase-s-team-rbac-business-scope.sql'.",
      }, { status: 409 });
    }
    return NextResponse.json({ error: deactivateError.message }, { status: 500 });
  }

  if (uniqueBusinessIds.length > 0) {
    const rows = uniqueBusinessIds.map((businessId) => ({
      org_id: body.org_id,
      business_id: businessId,
      user_id: targetMembership.user_id,
      role_override: normalizedOverride,
      is_active: true,
    }));

    const { error: upsertError } = await supabase
      .from('business_memberships')
      .upsert(rows, { onConflict: 'user_id,business_id' });

    if (upsertError) {
      const errorKind = classifyBusinessMembershipsError(upsertError);
      if (errorKind === 'schema_cache') {
        return NextResponse.json({
          error: 'schema_cache_stale',
          message: "No hem pogut validar l'esquema ara mateix. Refresca i torna-ho a provar.",
        }, { status: 503 });
      }
      if (errorKind === 'missing_table') {
        return NextResponse.json({
          error: 'schema_missing',
          message: "Falta la taula business_memberships. Executa la migració 'phase-s-team-rbac-business-scope.sql'.",
        }, { status: 409 });
      }
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
  }

  const { data: refreshedAssignments, error: refreshedError } = await supabase
    .from('business_memberships')
    .select('id, org_id, business_id, user_id, role_override, is_active, created_at, updated_at')
    .eq('org_id', body.org_id)
    .eq('user_id', targetMembership.user_id)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (refreshedError) {
    return NextResponse.json({ error: refreshedError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    user_id: targetMembership.user_id,
    assignments: refreshedAssignments || [],
  });
}
