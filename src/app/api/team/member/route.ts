export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { asMembershipRoleFilter, TEAM_MANAGEMENT_ROLES } from '@/lib/roles';
import { hasAcceptedOrgMembership } from '@/lib/authz';

/**
 * DELETE /api/team/member?id=xxx
 * RLS: owners can remove anyone; users can remove themselves.
 * Prevents removing the last owner.
 */
export async function DELETE(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Load the target membership
  const { data: target } = await supabase
    .from('memberships')
    .select('id, user_id, org_id, role')
    .eq('id', id)
    .single();

  if (!target) return NextResponse.json({ error: 'Membership not found' }, { status: 404 });

  const isSelf = target.user_id === user.id;
  if (!isSelf) {
    const canManageTeam = await hasAcceptedOrgMembership({
      supabase,
      userId: user.id,
      orgId: target.org_id,
      allowedRoles: asMembershipRoleFilter(TEAM_MANAGEMENT_ROLES),
    });

    if (!canManageTeam) {
      return NextResponse.json({
        error: 'forbidden',
        message: "No tens permisos per eliminar membres d'aquest equip.",
      }, { status: 403 });
    }
  }

  // Prevent deleting the last owner
  if (target.role === 'owner') {
    const { count } = await supabase
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', target.org_id)
      .eq('role', 'owner')
      .not('id', 'eq', id)
      .not('accepted_at', 'is', null);

    if (!count || count === 0) {
      return NextResponse.json({
        error: 'last_owner',
        message: 'Cannot remove the last owner. Transfer ownership first.',
      }, { status: 409 });
    }
  }

  const { error } = await supabase
    .from('memberships')
    .delete()
    .eq('id', id);

  if (error) {
    if (error.code === '42501' || error.message.includes('policy')) {
      return NextResponse.json({ error: 'forbidden', message: 'Only owners can remove members.' }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
