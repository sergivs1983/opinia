export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import {
  ACTIVE_ORG_COOKIE,
  ACTIVE_ORG_COOKIE_MAX_AGE_SECONDS,
} from '@/lib/workspace/active-org';
import { getServerActiveOrgCookieValue, resolveServerActiveMembership } from '@/lib/workspace/server-active-org';
import { assertOrgHasSeat, OrgSeatLimitError } from '@/lib/seats';

/**
 * POST /api/bootstrap
 *
 * Called by the frontend when a logged-in user has no membership.
 * Creates profile (upsert) + organization + owner membership.
 * Uses service_role to bypass RLS chicken-and-egg problem.
 */
function jsonWithActiveOrg(body: Record<string, unknown>, status: number, orgId: string | null) {
  const response = NextResponse.json(body, { status });
  if (orgId) {
    response.cookies.set(ACTIVE_ORG_COOKIE, orgId, {
      path: '/',
      sameSite: 'lax',
      maxAge: ACTIVE_ORG_COOKIE_MAX_AGE_SECONDS,
    });
  }
  return response;
}

export async function POST(request: NextRequest) {
  const cookieOrgId = request.cookies.get(ACTIVE_ORG_COOKIE)?.value ?? getServerActiveOrgCookieValue();
  // 1. Get authenticated user from cookies/session
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // 2. Admin client — bypasses RLS
  const admin = createAdminClient();

  // 3. Upsert profile
  const fullName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split('@')[0] ||
    'Usuari';

  await admin.from('profiles').upsert(
    {
      id: user.id,
      full_name: fullName,
      avatar_url: user.user_metadata?.avatar_url || '',
      locale: 'ca',
    },
    { onConflict: 'id' }
  );

  // 4. Check if membership already exists (idempotent)
  const existing = await resolveServerActiveMembership({
    supabase: admin,
    userId: user.id,
    cookieOrgId,
  });

  if (existing) {
    return jsonWithActiveOrg({ org_id: existing.org_id }, 200, existing.org_id);
  }

  // 5. Create organization
  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .insert({ name: fullName })
    .select('id')
    .single();

  if (orgErr || !org) {
    console.error('[bootstrap] org creation failed:', orgErr?.message);
    return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 });
  }

  // 6. Create owner membership
  try {
    await assertOrgHasSeat(admin, org.id);
  } catch (seatError: unknown) {
    if (seatError instanceof OrgSeatLimitError) {
      await admin.from('organizations').delete().eq('id', org.id);
      return NextResponse.json({
        error: seatError.code,
        message: seatError.message,
        seats: seatError.snapshot,
      }, { status: seatError.status });
    }
    await admin.from('organizations').delete().eq('id', org.id);
    return NextResponse.json({
      error: 'seat_check_failed',
      message: "No hem pogut validar el límit de seients.",
    }, { status: 500 });
  }

  const { error: memErr } = await admin.from('memberships').insert({
    user_id: user.id,
    org_id: org.id,
    role: 'owner',
    is_default: true,
    accepted_at: new Date().toISOString(),
  });

  if (memErr) {
    console.error('[bootstrap] membership failed:', memErr.message);
    // Rollback org
    await admin.from('organizations').delete().eq('id', org.id);
    return NextResponse.json({ error: 'Failed to create membership' }, { status: 500 });
  }

  return jsonWithActiveOrg({ org_id: org.id }, 200, org.id);
}
