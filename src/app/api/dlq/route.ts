export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateCsrf } from '@/lib/security/csrf';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { validateBody, DLQActionSchema } from '@/lib/validations';
import { requireBizAccess, requireBizAccessPatternB, withRequestContext } from '@/lib/api-handler';

/**
 * GET /api/dlq?status=queued&biz_id=xxx&limit=50
 * List failed jobs. Auth + RLS filter by org.
 */
export const GET = withRequestContext(async function(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'queued';
  const bizId = searchParams.get('biz_id');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

  let query = supabase
    .from('failed_jobs')
    .select('id, org_id, biz_id, job_type, error_code, error_message, provider, model, attempt_count, max_attempts, next_retry_at, status, created_at, updated_at')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (bizId) {
    // ── Biz-level guard (si biz_id present) ───────────────────────────────
    const bizGuard = await requireBizAccess({ supabase, userId: user.id, bizId });
    if (bizGuard) return bizGuard;
    query = query.eq('biz_id', bizId);
  } else {
    // ── Sense biz_id: filtre org explícit (defense-in-depth vs RLS laxa) ─
    // No confiem únicament en la RLS de failed_jobs per aïllar tenants.
    // Obtenim les orgs de l'usuari i filtrem explícitament.
    const { data: memberships } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('user_id', user.id)
      .not('accepted_at', 'is', null);

    const orgIds = (memberships || []).map((m: { org_id: string }) => m.org_id);
    if (orgIds.length === 0) {
      // Usuari sense cap org acceptada: retornem buit sense tocar la DB.
      return NextResponse.json([]);
    }
    query = query.in('org_id', orgIds);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
});

/**
 * POST /api/dlq
 * Body: { action: "retry", failed_job_id: "..." }
 *        { action: "retry_batch", limit: 10 }
 *        { action: "resolve", failed_job_id: "..." }
 */
export const POST = withRequestContext(async function(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/dlq', user_id: user.id });

  const [body, err] = await validateBody(request, DLQActionSchema);
  if (err) return err;

  const { action } = body;
  const admin = createAdminClient();

  // ── RETRY SINGLE ──────────────────────────────────────────
  if (action === 'retry') {
    const { data: job } = await supabase
      .from('failed_jobs')
      .select('*')
      .eq('id', body.failed_job_id)
      .single();

    if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    // ── Patró B: job d'un altre tenant → 404 (no filtrar existència) ────
    if (job.biz_id) {
      const bizGuard = await requireBizAccessPatternB({ supabase, userId: user.id, bizId: job.biz_id });
      if (bizGuard) return bizGuard;
    }

    if (job.attempt_count >= job.max_attempts) {
      await admin.from('failed_jobs').update({ status: 'failed' }).eq('id', job.id);
      log.warn('DLQ job max attempts reached', { job_id: job.id, attempts: job.attempt_count });
      return NextResponse.json(
        { error: 'max_attempts_reached', message: `Job exceeded ${job.max_attempts} retry attempts` },
        { status: 409 }
      );
    }

    const newAttempt = job.attempt_count + 1;
    // Exponential backoff: 1min, 2min, 4min, 8min, 16min
    const backoffMs = Math.min(60_000 * Math.pow(2, newAttempt - 1), 960_000);

    await admin.from('failed_jobs').update({
      status: 'retrying',
      attempt_count: newAttempt,
      next_retry_at: new Date(Date.now() + backoffMs).toISOString(),
    }).eq('id', job.id);

    const { error: retryAuditError } = await admin.from('activity_log').insert({
      org_id: job.org_id,
      biz_id: job.biz_id,
      user_id: user.id,
      action: 'dlq_retried',
      target_type: job.job_type,
      target_id: job.id,
      metadata: { request_id: requestId, attempt: newAttempt, next_retry_ms: backoffMs },
    });
    if (retryAuditError) {
      log.warn('DLQ retry audit insert failed', { error: retryAuditError.message, job_id: job.id });
    }

    log.info('DLQ job marked for retry', { job_id: job.id, attempt: newAttempt });
    return NextResponse.json({ success: true, job_id: job.id, new_status: 'retrying', attempt: newAttempt });
  }

  // ── RETRY BATCH ───────────────────────────────────────────
  if (action === 'retry_batch') {
    const batchLimit = Math.min(body.limit || 10, 50);

    // ── Defense-in-depth: filtre org explícit (no confiar únicament en RLS) ─
    const { data: batchMems } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('user_id', user.id)
      .not('accepted_at', 'is', null);
    const batchOrgIds = (batchMems || []).map((m: { org_id: string }) => m.org_id);
    if (batchOrgIds.length === 0) return NextResponse.json({ retried: 0 });

    const { data: jobs } = await supabase
      .from('failed_jobs')
      .select('id, attempt_count, max_attempts')
      .eq('status', 'queued')
      .in('org_id', batchOrgIds)
      .order('created_at', { ascending: true })
      .limit(batchLimit);

    if (!jobs?.length) return NextResponse.json({ retried: 0 });

    const eligible = jobs.filter(j => j.attempt_count < j.max_attempts);
    if (!eligible.length) return NextResponse.json({ retried: 0, skipped: jobs.length });

    const ids = eligible.map(j => j.id);
    await admin.from('failed_jobs').update({
      status: 'retrying',
      next_retry_at: new Date(Date.now() + 60_000).toISOString(),
    }).in('id', ids);

    log.info('DLQ batch retry', { count: ids.length });
    return NextResponse.json({ retried: ids.length, job_ids: ids });
  }

  // ── RESOLVE ───────────────────────────────────────────────
  if (action === 'resolve') {
    // Read first (via user supabase for RLS check)
    const { data: job } = await supabase
      .from('failed_jobs')
      .select('org_id, biz_id, job_type, status')
      .eq('id', body.failed_job_id)
      .maybeSingle();

    if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    // ── Patró B: job d'un altre tenant → 404 (no filtrar existència) ────
    if (job.biz_id) {
      const bizGuard = await requireBizAccessPatternB({ supabase, userId: user.id, bizId: job.biz_id });
      if (bizGuard) return bizGuard;
    }

    await admin.from('failed_jobs').update({ status: 'resolved' }).eq('id', body.failed_job_id);

    const { error: resolveAuditError } = await admin.from('activity_log').insert({
      org_id: job.org_id,
      biz_id: job.biz_id,
      user_id: user.id,
      action: 'dlq_resolved',
      target_type: job.job_type,
      target_id: body.failed_job_id,
      metadata: { request_id: requestId },
    });
    if (resolveAuditError) {
      log.warn('DLQ resolve audit insert failed', { error: resolveAuditError.message, job_id: body.failed_job_id });
    }

    log.info('DLQ job resolved', { job_id: body.failed_job_id });
    return NextResponse.json({ success: true, new_status: 'resolved' });
  }

  return NextResponse.json(
    { error: 'bad_request', message: 'Unknown action. Use: retry, retry_batch, resolve' },
    { status: 400 }
  );
});
