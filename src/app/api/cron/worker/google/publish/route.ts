export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/_internal/google/publish   (canonical URL, via next.config.js rewrite)
 * →   /api/cron/worker/google/publish  (handler path — NOT directly accessible)
 *
 * Internal worker: drains queued publish_jobs for Google Business Profile.
 *
 * Security:
 *   1. Middleware returns 404 for direct /api/cron/worker/* access
 *   2. HMAC guard: x-opin-timestamp + x-opin-signature (401 on any failure)
 *      Canonical: "${ts}.POST.${pathname}.${sha256(body)}"
 *   3. createAdminClient (service_role) used ONLY here — never in user endpoints
 *
 * Per-job flow:
 *   a) Ownership checks: job.biz_id === reply.biz_id === review.biz_id === integration.biz_id
 *   b) Validate: integration.provider === 'google_business', review.external_id present
 *   c) Human-in-the-loop: reply.is_edited must be true → else fail, no retry
 *   d) Idempotency pre-call: if a success job exists for same (biz_id, idempotency_key) → skip
 *   e) Get valid Google access token
 *   f) Call publishReplyToGoogle:
 *      - GbpPermanentError → fail immediately (no retry)
 *      - GbpTransientError → retry with exponential backoff+jitter, up to max_attempts
 *      - Unhandled error   → retry (treated as transient)
 *   g) On success: update reply.status='published', archive siblings, mark is_replied=true
 *
 * Concurrency: up to BATCH=10 jobs claimed atomically, processed with pLimit(5).
 *
 * Returns: { processed, succeeded, failed, requeued_stuck }
 */

import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import pLimit from 'p-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInternalGuard } from '@/lib/internal-guard';
import { writeAudit } from '@/lib/audit-log';
import { getValidGoogleAccessToken } from '@/lib/integrations/google/auth';
import {
  publishReplyToGoogle,
  GbpPermanentError,
  GbpTransientError,
} from '@/lib/integrations/google/publish';
import { truncatePublishErrorDetail } from '@/lib/publish/domain';
import { createLogger, type AppLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Jobs claimed per invocation (pop_publish_jobs p_limit) */
const BATCH       = 10;
/** Max concurrent job processors */
const CONCURRENCY = 5;
/** Max chars for last_error_detail before truncation */
const MAX_DETAIL  = 300;

function jsonNoStore(body: Record<string, unknown>, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

// ─── Backoff ──────────────────────────────────────────────────────────────────

/**
 * Exponential backoff + jitter for next_attempt_at.
 * attempt=1 → ~30s | attempt=2 → ~60s | … | max 30 min.
 * Always at least 15s to avoid hot-loop retries.
 */
function nextAttemptAt(attempt: number): Date {
  const baseMs   = Math.min(30 * 60, Math.pow(2, Math.max(0, attempt - 1)) * 30) * 1_000;
  const jitterMs = Math.floor(Math.random() * 5_000);
  return new Date(Date.now() + Math.max(15_000, baseMs + jitterMs));
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PublishJobRow {
  id: string;
  reply_id: string;
  biz_id: string;
  org_id: string;
  integration_id: string | null;
  attempts: number;
  max_attempts: number;
  status: string;
  idempotency_key: string;
}

type JobOutcome = 'succeeded' | 'failed' | 'retrying';

// ─── DB write helpers ─────────────────────────────────────────────────────────

async function markFailed(
  admin: SupabaseClient,
  jobId: string,
  code: string,
  detail: string,
): Promise<void> {
  const now = new Date().toISOString();
  await admin.from('publish_jobs').update({
    status:            'failed',
    locked_until:      null,
    finished_at:       now,
    last_error_code:   code,
    last_error_detail: truncatePublishErrorDetail(detail, MAX_DETAIL),
    processing_started_at: null,
    updated_at:        now,
  }).eq('id', jobId);
}

async function markRetry(
  admin: SupabaseClient,
  job: PublishJobRow,
  code: string,
  detail: string,
): Promise<void> {
  const now = new Date().toISOString();
  await admin.from('publish_jobs').update({
    status:            'queued_retry',
    locked_until:      null,
    next_attempt_at:   nextAttemptAt(job.attempts).toISOString(),
    last_error_code:   code,
    last_error_detail: truncatePublishErrorDetail(detail, MAX_DETAIL),
    processing_started_at: null,
    updated_at:        now,
  }).eq('id', job.id);
}

async function markSuccess(
  admin: SupabaseClient,
  jobId: string,
  gbpReplyId?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await admin.from('publish_jobs').update({
    status:              'success',
    locked_until:        null,
    finished_at:         now,
    published_at:        now,
    result_gbp_reply_id: gbpReplyId ?? null,
    last_error_code:     null,
    last_error_detail:   null,
    processing_started_at: null,
    updated_at:          now,
  }).eq('id', jobId);
}

function isMissingRelationError(error: unknown): boolean {
  const message = ((error as { message?: string })?.message || '').toLowerCase();
  const code = String((error as { code?: string })?.code || '').toUpperCase();
  return code === '42P01' || (message.includes('relation') && message.includes('does not exist'));
}

async function enqueuePublishFailureDlq(
  admin: SupabaseClient,
  job: PublishJobRow,
  code: string,
  detail: string,
): Promise<void> {
  const now = new Date().toISOString();
  const normalizedDetail = truncatePublishErrorDetail(detail, MAX_DETAIL);

  const { error } = await admin.from('failed_jobs').insert({
    org_id: job.org_id,
    biz_id: job.biz_id,
    job_type: 'publish_google_reply',
    payload: {
      publish_job_id: job.id,
      reply_id: job.reply_id,
      integration_id: job.integration_id ?? null,
      idempotency_key: job.idempotency_key,
    },
    error_code: code,
    error_message: normalizedDetail,
    provider: 'google_business',
    attempt_count: job.attempts,
    max_attempts: job.max_attempts,
    status: 'queued',
    created_at: now,
    updated_at: now,
  });

  if (error && !isMissingRelationError(error)) {
    // Non-blocking: publish job is already marked failed.
  }
}

async function markFailedAndDlq(
  admin: SupabaseClient,
  job: PublishJobRow,
  code: string,
  detail: string,
): Promise<void> {
  await markFailed(admin, job.id, code, detail);
  await enqueuePublishFailureDlq(admin, job, code, detail);
}

// ─── Per-job processor ────────────────────────────────────────────────────────

async function processJob(
  admin: SupabaseClient,
  job: PublishJobRow,
  log: AppLogger,
): Promise<JobOutcome> {
  const jl = log.child({ job_id: job.id, reply_id: job.reply_id });
  const last = job.attempts >= job.max_attempts;

  await admin.from('publish_jobs').update({
    processing_started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', job.id).eq('status', 'running');

  // ── Load reply ─────────────────────────────────────────────────────────────
  const { data: reply } = await admin
    .from('replies')
    .select('id, biz_id, content, is_edited, review_id, status')
    .eq('id', job.reply_id)
    .single();

  if (!reply) {
    await markFailedAndDlq(admin, job, 'reply_not_found', `reply ${job.reply_id} not found`);
    return 'failed';
  }

  // Ownership: reply.biz_id
  if (reply.biz_id !== job.biz_id) {
    await markFailedAndDlq(admin, job, 'ownership_mismatch_reply',
      `reply.biz_id ${reply.biz_id} !== job.biz_id ${job.biz_id}`);
    return 'failed';
  }

  // Human-in-the-loop: permanent failure, no retry
  if (!reply.is_edited) {
    jl.warn('publish_conflict: reply.is_edited=false');
    await markFailedAndDlq(admin, job, 'publish_conflict_not_human_edited', 'reply.is_edited is false');
    return 'failed';
  }

  // ── Load review ────────────────────────────────────────────────────────────
  const { data: review } = await admin
    .from('reviews')
    .select('id, biz_id, external_id')
    .eq('id', reply.review_id)
    .single();

  if (!review) {
    await markFailedAndDlq(admin, job, 'review_not_found', `review ${reply.review_id} not found`);
    return 'failed';
  }

  if (review.biz_id !== job.biz_id) {
    await markFailedAndDlq(admin, job, 'ownership_mismatch_review',
      `review.biz_id ${review.biz_id} !== job.biz_id ${job.biz_id}`);
    return 'failed';
  }

  if (!review.external_id) {
    await markFailedAndDlq(admin, job, 'review_external_id_missing', 'review has no external_id');
    return 'failed';
  }

  // ── Load integration ───────────────────────────────────────────────────────
  const integrationId = job.integration_id;
  if (!integrationId) {
    if (last) { await markFailedAndDlq(admin, job, 'integration_id_missing', 'job.integration_id is null'); return 'failed'; }
    await markRetry(admin, job, 'integration_id_missing', 'job.integration_id is null');
    return 'retrying';
  }

  const { data: integration } = await admin
    .from('integrations')
    .select('id, biz_id, provider, is_active')
    .eq('id', integrationId)
    .single();

  if (!integration || !integration.is_active) {
    const code = !integration ? 'integration_not_found' : 'integration_inactive';
    const detail = !integration ? `integration ${integrationId} not found` : 'integration is inactive';
    if (last) { await markFailedAndDlq(admin, job, code, detail); return 'failed'; }
    await markRetry(admin, job, code, detail);
    return 'retrying';
  }

  if (integration.biz_id !== job.biz_id) {
    await markFailedAndDlq(admin, job, 'ownership_mismatch_integration',
      `integration.biz_id ${integration.biz_id} !== job.biz_id ${job.biz_id}`);
    return 'failed';
  }

  if (integration.provider !== 'google_business') {
    await markFailedAndDlq(admin, job, 'integration_provider_mismatch',
      `provider is ${integration.provider}, expected google_business`);
    return 'failed';
  }

  // ── Idempotency pre-call ───────────────────────────────────────────────────
  const { data: prior } = await admin
    .from('publish_jobs')
    .select('id, result_gbp_reply_id, finished_at')
    .eq('biz_id', job.biz_id)
    .eq('idempotency_key', job.idempotency_key)
    .eq('status', 'success')
    .neq('id', job.id)
    .limit(1)
    .maybeSingle();

  if (prior) {
    jl.info('Idempotency: success already exists — skipping GBP call', { prior_job_id: prior.id });
    await markSuccess(admin, job.id, prior.result_gbp_reply_id ?? undefined);
    // Copy finished_at + tag with skipped marker
    await admin.from('publish_jobs').update({
      finished_at:    prior.finished_at,
      last_error_code: `skipped:idempotent:${prior.id}`,
    }).eq('id', job.id);
    return 'succeeded';
  }

  // ── Get valid Google access token ──────────────────────────────────────────
  const tokenData = await getValidGoogleAccessToken(admin, job.biz_id);
  if (!tokenData) {
    if (last) { await markFailedAndDlq(admin, job, 'no_google_token', 'Could not retrieve valid Google access token'); return 'failed'; }
    await markRetry(admin, job, 'no_google_token', 'No valid Google access token');
    return 'retrying';
  }

  // ── Load biz (google_place_id) ─────────────────────────────────────────────
  const { data: biz } = await admin
    .from('businesses')
    .select('id, google_place_id')
    .eq('id', job.biz_id)
    .single();

  // ── Call Google Business Profile API ──────────────────────────────────────
  let gbpResult: { gbpReplyId?: string };

  try {
    gbpResult = await publishReplyToGoogle({
      accessToken:      tokenData.accessToken,
      externalReviewId: review.external_id,
      replyText:        reply.content,
      googlePlaceId:    biz?.google_place_id ?? undefined,
    });
  } catch (err) {
    if (err instanceof GbpPermanentError) {
      jl.warn('GBP permanent error — failing immediately', { code: err.code });
      await markFailedAndDlq(admin, job, err.code, err.message.slice(0, MAX_DETAIL));
      return 'failed';
    }

    const code   = err instanceof GbpTransientError ? err.code : 'gbp_unknown_error';
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, MAX_DETAIL);
    jl.warn('GBP error', { code, last_attempt: last });

    if (last) { await markFailedAndDlq(admin, job, code, detail); return 'failed'; }
    await markRetry(admin, job, code, detail);
    return 'retrying';
  }

  // ── Success: update publish_job + reply + siblings + review ───────────────
  await markSuccess(admin, job.id, gbpResult.gbpReplyId);

  const publishedAt = new Date().toISOString();

  // reply → published (worker commits after confirmed GBP success)
  await admin.from('replies').update({
    status:       'published',
    published_at: publishedAt,
    // published_by intentionally null — worker action, not a direct user action
  }).eq('id', job.reply_id);

  // Archive other drafts/selected for the same review
  await admin.from('replies')
    .update({ status: 'archived' })
    .eq('review_id', reply.review_id)
    .neq('id', job.reply_id)
    .in('status', ['draft', 'selected']);

  // Mark review as replied
  await admin.from('reviews')
    .update({ is_replied: true })
    .eq('id', reply.review_id);

  jl.info('Job succeeded', { gbp_reply_id: gbpResult.gbpReplyId ?? null });
  return 'succeeded';
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/_internal/google/publish' });

  // ── HMAC guard ─────────────────────────────────────────────────────────────
  const rawBody = await request.text();
  const blocked = requireInternalGuard(request, {
    requestId,
    mode: 'hmac',
    rawBody,
    pathname: '/api/_internal/google/publish',
  });
  if (blocked) {
    blocked.headers.set('x-request-id', requestId);
    blocked.headers.set('Cache-Control', 'no-store');
    return blocked;
  }

  // ── Admin client (service_role — ONLY here) ────────────────────────────────
  const admin = createAdminClient();

  // ── Requeue stuck ──────────────────────────────────────────────────────────
  const { data: reqCount } = await admin
    .rpc('requeue_stuck_publish_jobs') as { data: number | null };
  const requeuedStuck = reqCount ?? 0;
  if (requeuedStuck > 0) log.info('Requeued stuck jobs', { count: requeuedStuck });

  // ── Pop batch ──────────────────────────────────────────────────────────────
  const { data: jobs, error: popErr } = await admin
    .rpc('pop_publish_jobs', { p_limit: BATCH }) as {
      data: PublishJobRow[] | null;
      error: unknown;
    };

  if (popErr) {
    log.error('pop_publish_jobs RPC failed', { error: String(popErr) });
    return jsonNoStore({ error: 'rpc_error' }, 500);
  }

  const jobList = jobs ?? [];
  log.info('Jobs claimed', { count: jobList.length });

  if (jobList.length === 0) {
    return jsonNoStore({ processed: 0, succeeded: 0, failed: 0, requeued_stuck: requeuedStuck }, 200);
  }

  // ── Process concurrently (p-limit) ─────────────────────────────────────────
  const limit    = pLimit(CONCURRENCY);
  const outcomes = await Promise.all(
    jobList.map(job => limit(() => processJob(admin, job, log))),
  );

  const succeeded = outcomes.filter(o => o === 'succeeded').length;
  const failed    = outcomes.filter(o => o === 'failed').length;
  // 'retrying' → queued_retry, not counted in either bucket

  // ── Audit batch ────────────────────────────────────────────────────────────
  void writeAudit({
    bizId:     '00000000-0000-0000-0000-000000000000',
    requestId,
    action:    'worker_batch_complete',
    resource:  'publish_jobs',
    result:    failed === 0 ? 'success' : 'failure',
    details:   { processed: jobList.length, succeeded, failed, requeued_stuck: requeuedStuck },
  });

  log.info('Batch complete', { processed: jobList.length, succeeded, failed, requeued_stuck: requeuedStuck });

  return jsonNoStore({ processed: jobList.length, succeeded, failed, requeued_stuck: requeuedStuck }, 200);
}
