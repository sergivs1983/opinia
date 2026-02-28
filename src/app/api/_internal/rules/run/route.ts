export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { validateHmacHeader } from '@/lib/security/hmac';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createLogger } from '@/lib/logger';
import { buildTriage } from '@/lib/rules/triage';
import { evaluateRules } from '@/lib/rules/evaluate';
import { validateTemplate } from '@/lib/rules/template';
import { enqueueRulePublishJob } from '@/lib/rules/enqueue';

type RuleRunRow = {
  id: string;
  org_id: string;
  biz_id: string;
  provider: string;
  review_id: string;
  status: 'queued' | 'processing' | 'done' | 'skipped' | 'failed';
  decision: Record<string, unknown> | null;
};

type ReviewLookupRow = {
  id: string;
  external_id: string | null;
  author_name: string | null;
  review_text: string;
  rating: number;
  language_detected: string | null;
};

type ProcessSummary = {
  processed: number;
  done: number;
  skipped: number;
  failed: number;
};

function jsonNoStore(body: Record<string, unknown>, requestId: string, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function asObject(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object' && !Array.isArray(value))
    ? (value as Record<string, unknown>)
    : {};
}

async function loadReview(admin: ReturnType<typeof createAdminClient>, run: RuleRunRow): Promise<ReviewLookupRow | null> {
  const byExternal = await admin
    .from('reviews')
    .select('id, external_id, author_name, review_text, rating, language_detected')
    .eq('biz_id', run.biz_id)
    .eq('external_id', run.review_id)
    .limit(1)
    .maybeSingle();

  if (!byExternal.error && byExternal.data) return byExternal.data as ReviewLookupRow;

  if (!/^[0-9a-f-]{36}$/i.test(run.review_id)) return null;

  const byId = await admin
    .from('reviews')
    .select('id, external_id, author_name, review_text, rating, language_detected')
    .eq('biz_id', run.biz_id)
    .eq('id', run.review_id)
    .limit(1)
    .maybeSingle();

  if (!byId.error && byId.data) return byId.data as ReviewLookupRow;
  return null;
}

function reviewSnapshotFromDecision(decision: Record<string, unknown> | null): {
  rating?: number;
  text?: string;
  language?: string;
  reviewer_name?: string;
} | null {
  const reviewSnapshot = asObject(asObject(decision).review_snapshot);
  if (Object.keys(reviewSnapshot).length === 0) return null;

  return {
    rating: Number.isFinite(Number(reviewSnapshot.rating)) ? Number(reviewSnapshot.rating) : undefined,
    text: typeof reviewSnapshot.text === 'string' ? reviewSnapshot.text : undefined,
    language: typeof reviewSnapshot.language === 'string' ? reviewSnapshot.language : undefined,
    reviewer_name: typeof reviewSnapshot.reviewer_name === 'string' ? reviewSnapshot.reviewer_name : undefined,
  };
}

async function updateRun(
  admin: ReturnType<typeof createAdminClient>,
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await admin
    .from('rule_runs')
    .update({
      ...patch,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);
}

async function processRun(
  admin: ReturnType<typeof createAdminClient>,
  run: RuleRunRow,
  requestId: string,
  log: ReturnType<typeof createLogger>,
): Promise<'done' | 'skipped' | 'failed'> {
  if (run.status === 'done') return 'skipped';

  try {
    const review = await loadReview(admin, run);
    const snapshot = reviewSnapshotFromDecision(run.decision);

    if (!review && !snapshot) {
      await updateRun(admin, run.id, {
        status: 'skipped',
        error: null,
        decision: {
          reason: 'missing_review_data',
          request_id: requestId,
        },
      });
      return 'skipped';
    }

    const triage = buildTriage({
      rating: review?.rating ?? snapshot?.rating ?? null,
      text: review?.review_text ?? snapshot?.text ?? null,
      language: review?.language_detected ?? snapshot?.language ?? null,
    });

    const match = await evaluateRules({
      admin,
      orgId: run.org_id,
      bizId: run.biz_id,
      provider: run.provider,
      triage,
    });

    if (!match) {
      await updateRun(admin, run.id, {
        status: 'skipped',
        triage,
        matched_rule_id: null,
        matched_action_id: null,
        publish_job_id: null,
        error: null,
        decision: {
          reason: 'no_rule_match',
          request_id: requestId,
          triage,
        },
      });
      return 'skipped';
    }

    let actionType = match.action_type;
    let publishJobId: string | null = null;
    let enqueueReason: string | null = null;
    let templateValidationUnknown: string[] = [];

    if (actionType === 'auto_publish_template') {
      if (!match.allow_auto_publish) {
        actionType = 'require_approval';
        enqueueReason = 'allow_auto_publish_disabled';
      } else if (!match.template) {
        actionType = 'require_approval';
        enqueueReason = 'missing_template';
      } else {
        const validation = validateTemplate(match.template);
        templateValidationUnknown = validation.unknown_placeholders;
        if (!validation.valid) {
          actionType = 'require_approval';
          enqueueReason = 'invalid_template';
        } else {
          const enqueueResult = await enqueueRulePublishJob({
            admin,
            orgId: run.org_id,
            bizId: run.biz_id,
            provider: 'google_business',
            reviewExternalId: run.review_id,
            actionId: match.action_id,
            templateVersion: match.template_version,
            template: match.template,
            reviewSnapshot: {
              reviewer_name: review?.author_name || snapshot?.reviewer_name,
              review_text: review?.review_text || snapshot?.text,
              rating: review?.rating ?? snapshot?.rating,
            },
          });

          if (enqueueResult.enqueued) {
            publishJobId = enqueueResult.publish_job_id;
          } else {
            actionType = 'require_approval';
            enqueueReason = enqueueResult.reason || 'enqueue_failed';
          }
        }
      }
    }

    await updateRun(admin, run.id, {
      status: 'done',
      triage,
      matched_rule_id: match.rule_id,
      matched_action_id: match.action_id,
      publish_job_id: publishJobId,
      error: null,
      decision: {
        request_id: requestId,
        matched_conditions: match.matched_conditions,
        action_type: actionType,
        original_action_type: match.action_type,
        enqueue_reason: enqueueReason,
        template_version: match.template_version,
        template_unknown_placeholders: templateValidationUnknown,
        reviewed_at: new Date().toISOString(),
      },
    });

    return 'done';
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)) || 'unknown_error';
    log.error('rule_run failed', { run_id: run.id, error: message });
    await updateRun(admin, run.id, {
      status: 'failed',
      error: {
        message,
        request_id: requestId,
      },
    });
    return 'failed';
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/_internal/rules/run' });
  const rawBody = await request.text();

  const hmac = validateHmacHeader({
    timestampHeader: request.headers.get('x-opin-timestamp'),
    signatureHeader: request.headers.get('x-opin-signature'),
    method: 'POST',
    pathname: '/api/_internal/rules/run',
    rawBody,
  });

  if (!hmac.valid) {
    log.warn('HMAC validation failed for rules worker', { reason: hmac.reason });
    return jsonNoStore({ error: 'Unauthorized', request_id: requestId }, requestId, 401);
  }

  let parsed: Record<string, unknown> = {};
  if (rawBody.length > 0) {
    try {
      parsed = asObject(JSON.parse(rawBody));
    } catch {
      return jsonNoStore(
        { error: 'bad_request', message: 'Invalid JSON body', request_id: requestId },
        requestId,
        400,
      );
    }
  }

  const requestedLimit = Number(parsed.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.trunc(requestedLimit), 50))
    : 25;
  const workerId = typeof parsed.worker_id === 'string' && parsed.worker_id.trim().length > 0
    ? parsed.worker_id.trim()
    : `rules-worker:${requestId}`;

  const admin = createAdminClient();
  const { data: claimedRuns, error: claimError } = await admin
    .rpc('pop_rule_runs', { p_limit: limit, p_worker: workerId }) as {
      data: RuleRunRow[] | null;
      error: { message?: string; code?: string } | null;
    };

  if (claimError) {
    log.error('pop_rule_runs failed', { error: claimError.message, code: normalize(claimError.code) });
    return jsonNoStore(
      { ok: false, error: 'rpc_error', request_id: requestId },
      requestId,
      500,
    );
  }

  const runs = claimedRuns || [];
  const summary: ProcessSummary = {
    processed: runs.length,
    done: 0,
    skipped: 0,
    failed: 0,
  };

  for (const run of runs) {
    const outcome = await processRun(admin, run, requestId, log);
    if (outcome === 'done') summary.done += 1;
    else if (outcome === 'skipped') summary.skipped += 1;
    else summary.failed += 1;
  }

  return jsonNoStore(
    {
      ok: true,
      processed: summary.processed,
      done: summary.done,
      skipped: summary.skipped,
      failed: summary.failed,
      request_id: requestId,
    },
    requestId,
    200,
  );
}
