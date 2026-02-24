/**
 * Minimal job runner for OpinIA async tasks.
 * Jobs run server-side via API routes called by Vercel Cron.
 * Each job logs to job_runs table for observability.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { createLogger, createRequestId } from '@/lib/logger';

export type JobType = 'analyze_review' | 'rebuild_insights' | 'sync_reviews';

export interface JobResult {
  success: boolean;
  output?: any;
  error?: string;
}

/**
 * Wrap a job function with logging, timing, and persistence.
 */
export async function runJob(
  jobType: JobType,
  input: Record<string, any>,
  fn: (admin: any, log: ReturnType<typeof createLogger>) => Promise<any>
): Promise<JobResult> {
  const admin = createAdminClient();
  const requestId = createRequestId();
  const log = createLogger({
    request_id: requestId,
    biz_id: input.biz_id,
    org_id: input.org_id,
  });

  // Create job_run record
  const { data: jobRun } = await admin
    .from('job_runs')
    .insert({
      job_type: jobType,
      biz_id: input.biz_id || null,
      org_id: input.org_id || null,
      status: 'running',
      input,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  const jobId = jobRun?.id;
  const startMs = Date.now();

  log.info(`[job:${jobType}] started`, { job_id: jobId });

  try {
    const output = await fn(admin, log);
    const durationMs = Date.now() - startMs;

    if (jobId) {
      await admin.from('job_runs').update({
        status: 'success',
        output: output || {},
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
      }).eq('id', jobId);
    }

    log.info(`[job:${jobType}] success`, { duration_ms: durationMs });
    return { success: true, output };

  } catch (err: any) {
    const durationMs = Date.now() - startMs;
    const errorMsg = err?.message || 'Unknown error';

    if (jobId) {
      await admin.from('job_runs').update({
        status: 'failed',
        error: errorMsg,
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
      }).eq('id', jobId);
    }

    log.error(`[job:${jobType}] failed`, { error: errorMsg, duration_ms: durationMs });
    return { success: false, error: errorMsg };
  }
}
