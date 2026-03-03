export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { hasAcceptedOrgMembership } from '@/lib/authz';
import { requireBizAccessPatternB } from '@/lib/api-handler';

/**
 * GET /api/status?org_id=xxx&biz_id=xxx
 * Returns operational status for the internal dashboard.
 */
export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('org_id');
  const bizId = searchParams.get('biz_id');
  if (!orgId) return NextResponse.json({ error: 'org_id required' }, { status: 400 });

  let scopedOrgId = orgId;
  let scopedBizId: string | null = null;

  if (bizId) {
    const gate = await requireBizAccessPatternB(request, bizId, {
      supabase,
      user,
      queryBizId: bizId,
    });
    if (gate instanceof NextResponse) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (gate.membership.orgId !== orgId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    scopedOrgId = gate.membership.orgId;
    scopedBizId = gate.bizId;
  } else {
    const hasMembership = await hasAcceptedOrgMembership({
      supabase,
      userId: user.id,
      orgId,
    });
    if (!hasMembership) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Usage this month
  const monthKey = new Date().toISOString().slice(0, 7) + '-01';
  const { data: usage } = await supabase
    .from('usage_monthly')
    .select('*')
    .eq('org_id', scopedOrgId)
    .eq('month', monthKey)
    .maybeSingle();

  // Last job runs
  const jobsQuery = supabase
    .from('job_runs')
    .select('id, job_type, status, started_at, finished_at, duration_ms, error')
    .eq('org_id', scopedOrgId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (scopedBizId) jobsQuery.eq('biz_id', scopedBizId);
  const { data: recentJobs } = await jobsQuery;

  // Recent audit entries (for this biz)
  let recentActivity: any[] = [];
  if (scopedBizId) {
    const { data } = await supabase
      .from('activity_log')
      .select('action, created_at, metadata')
      .eq('biz_id', scopedBizId)
      .order('created_at', { ascending: false })
      .limit(10);
    recentActivity = data || [];
  }

  // Org plan
  const { data: org } = await supabase
    .from('organizations')
    .select('plan, name')
    .eq('id', scopedOrgId)
    .maybeSingle();

  return NextResponse.json({
    health: { ok: true, ts: new Date().toISOString() },
    usage: usage || { ai_generations: 0, reviews_synced: 0 },
    plan: org?.plan || 'free',
    org_name: org?.name || '',
    recent_jobs: recentJobs || [],
    recent_activity: recentActivity,
    environment: process.env.NODE_ENV,
    demo_mode: process.env.NEXT_PUBLIC_DEMO_MODE === 'true',
  });
}
