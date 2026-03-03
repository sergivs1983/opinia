export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { validateBody, TeamInviteSchema } from '@/lib/validations';
import { requireBizAccessPatternB } from '@/lib/api-handler';
import {
  assertOrgHasSeat,
  assertRoleAllowedForOrgPlan,
  OrgRoleNotAllowedForPlanError,
  OrgSeatLimitError,
} from '@/lib/seats';
import { normalizeMemberRole, roleCanManageTeam } from '@/lib/roles';

/**
 * POST /api/team/invite
 * Body: { org_id, email, role?: 'admin'|'manager'|'responder' }
 * Creates a pending membership (accepted_at = null).
 */
export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // ── Validate ──
  const [body, err] = await validateBody(request, TeamInviteSchema);
  if (err) return err;

  const workspaceBizId = request.headers.get('x-biz-id')?.trim();
  const access = await requireBizAccessPatternB(request, workspaceBizId, {
    supabase,
    user,
    headerBizId: workspaceBizId || null,
  });
  if (access instanceof NextResponse) return access;

  if (!roleCanManageTeam(access.role)) {
    return NextResponse.json({
      error: 'not_found',
      message: 'No disponible',
    }, { status: 404 });
  }

  const { data: scopedBusiness } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', access.bizId)
    .eq('org_id', body.org_id)
    .maybeSingle();

  if (!scopedBusiness) {
    return NextResponse.json({
      error: 'not_found',
      message: 'No disponible',
    }, { status: 404 });
  }

  const cleanEmail = body.email.trim().toLowerCase();
  const normalizedRole = normalizeMemberRole(body.role);

  try {
    await assertRoleAllowedForOrgPlan(supabase, {
      orgId: body.org_id,
      role: normalizedRole,
    });
  } catch (roleError: unknown) {
    if (roleError instanceof OrgRoleNotAllowedForPlanError) {
      return NextResponse.json({
        error: roleError.code,
        message: roleError.message,
      }, { status: roleError.status });
    }

    return NextResponse.json({
      error: 'plan_check_failed',
      message: "No hem pogut validar els permisos del pla.",
    }, { status: 500 });
  }

  // Check if already invited/member
  const { data: existingMembers } = await supabase
    .from('memberships')
    .select('id, invited_email, accepted_at')
    .eq('org_id', body.org_id);

  const alreadyPresent = (existingMembers || []).some(m =>
    m.invited_email?.toLowerCase() === cleanEmail
  );

  if (alreadyPresent) {
    return NextResponse.json({
      error: 'already_invited',
      message: "Aquest correu ja té una invitació pendent.",
    }, { status: 409 });
  }

  try {
    await assertOrgHasSeat(supabase, body.org_id);
  } catch (seatError: unknown) {
    if (seatError instanceof OrgSeatLimitError) {
      return NextResponse.json({
        error: seatError.code,
        message: seatError.message,
        seats: seatError.snapshot,
      }, { status: seatError.status });
    }

    return NextResponse.json({
      error: 'seat_check_failed',
      message: "No hem pogut validar el límit de seients.",
    }, { status: 500 });
  }

  // Insert pending invite
  const { data, error } = await supabase.from('memberships').insert({
    org_id: body.org_id,
    user_id: user.id,
    role: normalizedRole,
    invited_email: cleanEmail,
    accepted_at: null,
  }).select().single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({
        error: 'already_invited',
        message: "Ja existeix una invitació per a aquest correu.",
      }, { status: 409 });
    }
    if (error.code === '42501' || error.message?.includes('policy')) {
      return NextResponse.json({
        error: 'forbidden',
        message: "No tens permisos per convidar persones.",
      }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ membership: data }, { status: 201 });
}
