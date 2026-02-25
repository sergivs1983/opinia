export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { runJob } from '@/lib/jobs/runner';
import { rebuildInsights } from '@/lib/jobs/rebuild-insights';
import { validateBody, JobRunSchema } from '@/lib/validations';
import { hasAcceptedOrgMembership, isAdminViewer } from '@/lib/authz';

/**
 * POST /api/jobs
 * Vercel Cron calls this endpoint.
 *
 * Body: { job: "rebuild_insights" | "sync_reviews", biz_id?, org_id? }
 *
 * Auth: CRON_SECRET header or authenticated admin user.
 */
export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const cronSecret = request.headers.get('x-cron-secret');
  const expectedSecret = process.env.CRON_SECRET;
  const hasValidCronSecret = Boolean(expectedSecret && cronSecret === expectedSecret);

  const supabase = createServerSupabaseClient();
  let user: { id: string; email?: string | null } | null = null;

  if (!hasValidCronSecret) {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    user = authUser;
  }

  const [body, err] = await validateBody(request, JobRunSchema);
  if (err) return err;

  if (!hasValidCronSecret && user) {
    if (body.job === 'rebuild_all_insights') {
      if (!isAdminViewer({ user, orgId: null, businessId: null })) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
    } else {
      const orgId = body.org_id;
      if (!orgId) {
        return NextResponse.json({ error: 'org_id required' }, { status: 400 });
      }

      const hasMembership = await hasAcceptedOrgMembership({
        supabase,
        userId: user.id,
        orgId,
      });
      if (!hasMembership) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

      if (body.biz_id) {
        const { data: business } = await supabase
          .from('businesses')
          .select('id')
          .eq('id', body.biz_id)
          .eq('org_id', orgId)
          .maybeSingle();
        if (!business) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
    }
  }

  const { job } = body;

  switch (job) {
    case 'rebuild_insights': {
      const { biz_id, org_id } = body;
      const result = await runJob('rebuild_insights', { biz_id, org_id }, async (admin, log) => {
        return rebuildInsights(admin, log, biz_id, org_id, 90);
      });
      return NextResponse.json(result);
    }

    case 'rebuild_all_insights': {
      // Rebuild for all active businesses
      const admin = createAdminClient();
      const { data: businesses } = await admin
        .from('businesses')
        .select('id, org_id')
        .eq('is_active', true);

      const results = [];
      for (const biz of (businesses || [])) {
        const result = await runJob('rebuild_insights', { biz_id: biz.id, org_id: biz.org_id }, async (a, log) => {
          return rebuildInsights(a, log, biz.id, biz.org_id, 90);
        });
        results.push({ biz_id: biz.id, ...result });
      }
      return NextResponse.json({ results });
    }

    case 'sync_reviews': {
      const { biz_id, org_id } = body;
      // Placeholder — will be implemented when Google OAuth is added
      const result = await runJob('sync_reviews', { biz_id, org_id }, async (admin, log) => {
        log.info('sync_reviews is a placeholder — Google OAuth not yet configured');
        return { synced: 0, message: 'No OAuth configured yet' };
      });
      return NextResponse.json(result);
    }

    default:
      return NextResponse.json({ error: `Unknown job: ${job}` }, { status: 400 });
  }
}
