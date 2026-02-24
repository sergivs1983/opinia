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
 * Auth callback — runs after OAuth or magic link.
 *
 * CRITICAL: Ensures every authenticated user has:
 *   1. A profile row
 *   2. An organization
 *   3. A membership (role: owner)
 *
 * Uses the service_role (admin) client for writes to bypass RLS,
 * because the user's own session can't insert into tables where
 * RLS policies require a membership that doesn't exist yet.
 */
function redirectWithActiveOrg(origin: string, path: string, orgId: string): NextResponse {
  const response = NextResponse.redirect(`${origin}${path}`);
  response.cookies.set(ACTIVE_ORG_COOKIE, orgId, {
    path: '/',
    sameSite: 'lax',
    maxAge: ACTIVE_ORG_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const redirect = searchParams.get('redirect') || '/dashboard/inbox';
  const cookieOrgId = request.cookies.get(ACTIVE_ORG_COOKIE)?.value ?? getServerActiveOrgCookieValue();

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  // 1. Exchange code for session (uses anon client with cookies)
  const supabase = createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('[callback] exchangeCodeForSession failed:', error.message);
    return NextResponse.redirect(`${origin}/login?error=auth_error`);
  }

  // 2. Get authenticated user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=no_user`);
  }

  // 3. Use admin client (service_role) for all DB writes — bypasses RLS
  const admin = createAdminClient();

  try {
    // 4. Ensure profile exists
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (!existingProfile) {
      const fullName =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split('@')[0] ||
        'Usuari';

      const { error: profileErr } = await admin.from('profiles').insert({
        id: user.id,
        full_name: fullName,
        avatar_url: user.user_metadata?.avatar_url || '',
        locale: 'ca',
      });

      if (profileErr) {
        console.error('[callback] profile insert failed:', profileErr.message);
      }
    }

    // 5. Ensure membership exists
    let orgId: string;
    const activeMembership = await resolveServerActiveMembership({
      supabase: admin,
      userId: user.id,
      cookieOrgId,
    });

    if (activeMembership) {
      orgId = activeMembership.org_id;
    } else {
      // No membership: create org + membership
      const displayName =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split('@')[0] ||
        'Usuari';

      const { data: newOrg, error: orgErr } = await admin
        .from('organizations')
        .insert({ name: displayName })
        .select('id')
        .single();

      if (orgErr || !newOrg) {
        console.error('[callback] org creation failed:', orgErr?.message);
        return NextResponse.redirect(`${origin}/login?error=setup_failed`);
      }

      orgId = newOrg.id;

      try {
        await assertOrgHasSeat(admin, orgId);
      } catch (seatError: unknown) {
        await admin.from('organizations').delete().eq('id', orgId);

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

      const { error: memberErr } = await admin.from('memberships').insert({
        user_id: user.id,
        org_id: orgId,
        role: 'owner',
        is_default: true,
        accepted_at: new Date().toISOString(),
      });

      if (memberErr) {
        console.error('[callback] membership insert failed:', memberErr.message);
        await admin.from('organizations').delete().eq('id', orgId);
        return NextResponse.redirect(`${origin}/login?error=setup_failed`);
      }
    }

    // 6. Check if user has any completed business
    const { data: businesses } = await admin
      .from('businesses')
      .select('id, onboarding_done')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .limit(1);

    if (!businesses || businesses.length === 0 || !businesses[0].onboarding_done) {
      return redirectWithActiveOrg(origin, '/onboarding', orgId);
    }

    return redirectWithActiveOrg(origin, redirect, orgId);

  } catch (err) {
    console.error('[callback] unexpected error:', err);
    return NextResponse.redirect(`${origin}/login?error=setup_failed`);
  }
}
