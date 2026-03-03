export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { assertServiceRoleAllowed } from '@/lib/security/service-role';
import { requireInternalGuard } from '@/lib/internal-guard';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { runJob } from '@/lib/jobs/runner';
import { rebuildInsights } from '@/lib/jobs/rebuild-insights';
import { validateBody, JobRunSchema } from '@/lib/validations';

/**
 * POST /api/jobs
 * Vercel Cron calls this endpoint.
 *
 * Body: { job: "rebuild_insights" | "sync_reviews", biz_id?, org_id? }
 *
 * Auth: CRON_SECRET header or authenticated admin user.
 */
export async function POST(request: Request) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const serviceBlocked = assertServiceRoleAllowed(request);
  if (serviceBlocked) return serviceBlocked;
  const blocked = validateCsrf(request); if (blocked) return blocked;
  const guardBlocked = requireInternalGuard(request, {
    requestId,
    mode: 'secret',
  });
  if (guardBlocked) return guardBlocked;

  const [body, err] = await validateBody(request, JobRunSchema);
  if (err) return err;

  const { job } = body;

  switch (job) {
    case 'rebuild_insights': {
      const { biz_id, org_id } = body;
      const adminClient = getAdminClient();
      const result = await runJob('rebuild_insights', { biz_id, org_id }, async (admin, log) => {
        return rebuildInsights(admin, log, biz_id, org_id, 90);
      }, adminClient);
      return NextResponse.json(result);
    }

    case 'rebuild_all_insights': {
      // Rebuild for all active businesses
      const admin = getAdminClient();
      const { data: businesses } = await admin
        .from('businesses')
        .select('id, org_id')
        .eq('is_active', true);

      const results = [];
      for (const biz of (businesses || [])) {
        const result = await runJob('rebuild_insights', { biz_id: biz.id, org_id: biz.org_id }, async (a, log) => {
          return rebuildInsights(a, log, biz.id, biz.org_id, 90);
        }, admin);
        results.push({ biz_id: biz.id, ...result });
      }
      return NextResponse.json({ results });
    }

    case 'sync_reviews': {
      const { biz_id, org_id } = body;
      // Placeholder — will be implemented when Google OAuth is added
      const syncAdmin = getAdminClient();
      const result = await runJob('sync_reviews', { biz_id, org_id }, async (admin, log) => {
        log.info('sync_reviews is a placeholder — Google OAuth not yet configured');
        return { synced: 0, message: 'No OAuth configured yet' };
      }, syncAdmin);
      return NextResponse.json(result);
    }

    default:
      return NextResponse.json({ error: `Unknown job: ${job}` }, { status: 400 });
  }
}
