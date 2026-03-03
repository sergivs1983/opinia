export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/publish-jobs/[jobId]
 *
 * Returns the current status of a publish job.
 *
 * Security layers:
 *   1. Session auth (createServerSupabaseClient — RLS enforced, NO admin client)
 *   2. Pattern B 404 — returns 404 (not 403) if job doesn't exist OR the
 *      authenticated user doesn't have membership for the job's business.
 *      Prevents cross-tenant enumeration of job IDs.
 *   3. Cache-Control: no-store (job status is live/sensitive data)
 */

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireResourceAccessPatternB, ResourceTable } from '@/lib/api-handler';
import { createLogger } from '@/lib/logger';
import { parsePublishJobStatus } from '@/lib/publish/domain';
import { getRequestIdFromHeaders } from '@/lib/request-id';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SECURE_HEADERS = { 'Cache-Control': 'no-store' } as const;

function json(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { ...SECURE_HEADERS, ...(init?.headers ?? {}) },
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: { jobId: string } },
) {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'GET /api/publish-jobs/[jobId]' });

  // ── Auth (session only — NO admin/service_role client) ────────────────────
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return json({ error: 'unauthorized', message: 'Auth required' }, { status: 401 });
  }

  const gate = await requireResourceAccessPatternB(
    request,
    params.jobId,
    ResourceTable.PublishJobs,
    { supabase, user },
  );
  if (gate instanceof NextResponse) {
    log.warn('Access denied (Pattern B 404)', { job_id: params.jobId });
    return json({ error: 'not_found', message: 'Not found' }, { status: 404 });
  }

  // ── Fetch job scoped by Pattern B gate ────────────────────────────────────
  const { data: job } = await supabase
    .from('publish_jobs')
    .select(`
      id,
      biz_id,
      reply_id,
      integration_id,
      status,
      attempts,
      max_attempts,
      next_attempt_at,
      locked_until,
      processing_started_at,
      last_error_code,
      last_error_detail,
      result_gbp_reply_id,
      finished_at,
      published_at,
      created_at,
      updated_at
    `)
    .eq('id', params.jobId)
    .eq('biz_id', gate.bizId)
    .maybeSingle();

  if (!job) {
    log.warn('Publish job not found (Pattern B 404)', { job_id: params.jobId });
    return json({ error: 'not_found', message: 'Not found' }, { status: 404 });
  }

  return json({
    id:                  job.id,
    reply_id:            job.reply_id,
    integration_id:      job.integration_id,
    status:              parsePublishJobStatus(job.status) || job.status,
    attempts:            job.attempts,
    max_attempts:        job.max_attempts,
    next_attempt_at:     job.next_attempt_at,
    locked_until:        job.locked_until,
    processing_started_at: job.processing_started_at,
    last_error_code:     job.last_error_code,
    last_error_detail:   job.last_error_detail,
    result_gbp_reply_id: job.result_gbp_reply_id,
    finished_at:         job.finished_at,
    published_at:        job.published_at,
    created_at:          job.created_at,
    updated_at:          job.updated_at,
  });
}
