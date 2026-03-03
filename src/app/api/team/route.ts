export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { requireImplicitBizAccessPatternB } from '@/lib/api-handler';
import { getOrgSeatSnapshot } from '@/lib/seats';

/**
 * GET /api/team?org_id=xxx
 * Returns memberships for the org with profile info.
 *
 * Two strategies:
 *   1) PostgREST nested select (requires FK memberships→profiles + schema cache)
 *   2) Fallback: two separate queries + JS-side join (always works)
 */
export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('org_id');
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 });

  const workspaceBizId = request.headers.get('x-biz-id')?.trim() || null;
  const access = await requireImplicitBizAccessPatternB(request, {
    supabase,
    user,
    headerBizId: workspaceBizId,
  });
  if (access instanceof NextResponse || access.membership.orgId !== orgId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let members: Array<Record<string, unknown>> | null = null;

  // ── Strategy 1: Nested select via FK ──
  // Wrapped in try-catch because supabase-js can throw (not just return error)
  // if the FK hint references a constraint that doesn't exist.
  try {
    const { data, error } = await supabase
      .from('memberships')
      .select('id, user_id, org_id, role, is_default, invited_email, accepted_at, created_at, profile:profiles!memberships_user_id_profiles_fk(full_name, avatar_url)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    if (!error && data) {
      members = data.map((m: any) => ({
          id: m.id,
          user_id: m.user_id,
          org_id: m.org_id,
          role: m.role,
          is_default: m.is_default,
          invited_email: m.invited_email,
          accepted_at: m.accepted_at,
          created_at: m.created_at,
          full_name: m.profile?.full_name || null,
          avatar_url: m.profile?.avatar_url || null,
        }));
    }
    // Strategy 1 returned error — fall through to Strategy 2
  } catch {
    // FK doesn't exist or schema cache stale — fall through
  }

  if (!members) {
    // ── Strategy 2: Two separate queries + JS join ──
    // This always works, even without the FK.
    const { data: memberships, error: mErr } = await supabase
      .from('memberships')
      .select('id, user_id, org_id, role, is_default, invited_email, accepted_at, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true });

    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

    // Collect unique user_ids for accepted members
    const userIds = [...new Set(
      (memberships || [])
        .filter((m: any) => m.accepted_at && m.user_id)
        .map((m: any) => m.user_id)
    )];

    // Fetch profiles — RLS may limit visibility (profiles_select_teammates needed)
    // If RLS blocks, profiles come back empty → names show as null (graceful degradation)
    const profileMap: Record<string, { full_name: string | null; avatar_url: string | null }> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', userIds);

      for (const p of (profiles || [])) {
        profileMap[p.id] = { full_name: p.full_name, avatar_url: p.avatar_url };
      }
    }

    members = (memberships || []).map((m: any) => ({
      id: m.id,
      user_id: m.user_id,
      org_id: m.org_id,
      role: m.role,
      is_default: m.is_default,
      invited_email: m.invited_email,
      accepted_at: m.accepted_at,
      created_at: m.created_at,
      full_name: profileMap[m.user_id]?.full_name || null,
      avatar_url: profileMap[m.user_id]?.avatar_url || null,
    }));
  }

  let seats = null;
  try {
    seats = await getOrgSeatSnapshot(supabase, orgId, members.length);
  } catch {
    seats = null;
  }

  return NextResponse.json({
    members,
    seats,
  });
}
