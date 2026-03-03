export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/replies/[replyId]/publish
 *
 * Enqueues an async GBP publish job for the given reply.
 * Does NOT change reply.status — the worker updates it on confirmed GBP success.
 *
 * Security layers (all mandatory):
 *   1. CSRF — Origin/Referer check, no exemptions (user endpoint = browser only)
 *   2. Session auth — createServerSupabaseClient (RLS enforced, NO admin client)
 *   3. PUBLISH_ROLES membership guard
 *   4. Pattern B 404 — any inaccessible resource returns 404, never 401/403
 *   5. Cache-Control: no-store on all responses
 *
 * Pre-conditions:
 *   - reply.is_edited must be true (human reviewed)
 *   - reply.status must be 'draft' or 'selected'
 *   - An active google_business integration must exist for the biz
 *
 * Idempotency:
 *   Key = "reply:{replyId}:{reply.updated_at}"  scoped to (biz_id, idempotency_key).
 *   If a job with the same key already exists → return it (no duplicate enqueue).
 *
 * Response: { job_id: string }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireResourceAccessPatternB, ResourceTable } from '@/lib/api-handler';
import { roleCanPublish } from '@/lib/roles';
import { audit } from '@/lib/audit';
import { writeAudit } from '@/lib/audit-log';
import { createLogger } from '@/lib/logger';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { buildReplyPublishIdempotencyKey } from '@/lib/publish/domain';
import { validateCsrf } from '@/lib/security/csrf';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SECURE_HEADERS = { 'Cache-Control': 'no-store' } as const;

function json(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { ...SECURE_HEADERS, ...(init?.headers ?? {}) },
  });
}

// ─── Body schema ──────────────────────────────────────────────────────────────

const PublishBodySchema = z.object({
  /** Optional: override the reply content before publishing (max 4000 chars) */
  final_content: z.string().min(1).max(4000).optional(),
});

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: { replyId: string } },
) {
  // ── 1. CSRF (no Bearer exemption) ─────────────────────────────────────────
  const csrfErr = validateCsrf(request);
  if (csrfErr) return csrfErr;

  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/replies/[replyId]/publish' });

  // ── 2. Auth (session only — NO admin/service_role client) ─────────────────
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return json({ error: 'unauthorized', message: 'Auth required' }, { status: 401 });
  }

  // ── 3. Parse body (optional) ──────────────────────────────────────────────
  let body: z.infer<typeof PublishBodySchema> = {};
  try {
    const raw = await request.json().catch(() => ({}));
    body = PublishBodySchema.parse(raw);
  } catch {
    return json({ error: 'validation_error', message: 'Invalid request body' }, { status: 400 });
  }
  const gate = await requireResourceAccessPatternB(request, params.replyId, ResourceTable.Replies, {
    supabase,
    user,
  });
  if (gate instanceof NextResponse) {
    log.warn('Access denied (Pattern B 404)', { reply_id: params.replyId });
    return json({ error: 'not_found', message: 'Not found' }, { status: 404 });
  }

  // ── 4. Load reply (Pattern B 404) ─────────────────────────────────────────
  const { data: reply } = await supabase
    .from('replies')
    .select('id, review_id, biz_id, org_id, status, content, is_edited, updated_at')
    .eq('id', params.replyId)
    .eq('biz_id', gate.bizId)
    .single();

  if (!reply) {
    log.warn('Reply not found (Pattern B 404)', { reply_id: params.replyId });
    return json({ error: 'not_found', message: 'Not found' }, { status: 404 });
  }

  // ── 5. Authorise (Pattern B 404 on denial — never 403) ───────────────────
  if (!roleCanPublish(gate.role)) {
    log.warn('Access denied (Pattern B 404)', { reply_id: params.replyId });
    return json({ error: 'not_found', message: 'Not found' }, { status: 404 });
  }

  // ── 6. Human-in-the-loop guard ────────────────────────────────────────────
  if (!reply.is_edited) {
    log.warn('publish_conflict: reply.is_edited=false', { reply_id: params.replyId });
    return json(
      { error: 'publish_conflict', message: 'Reply must be human-reviewed (is_edited=true) before publishing' },
      { status: 422 },
    );
  }

  // ── 7. State check ────────────────────────────────────────────────────────
  if (reply.status === 'published') {
    // Already published — look up the existing job and return it
    const { data: existingJob } = await supabase
      .from('publish_jobs')
      .select('id, status')
      .eq('reply_id', params.replyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    log.info('Reply already published (idempotent)', { reply_id: params.replyId });
    return json({ job_id: existingJob?.id ?? null, status: existingJob?.status ?? 'success', already_published: true });
  }

  if (reply.status === 'archived') {
    return json(
      { error: 'invalid_state', message: "Cannot publish an archived reply" },
      { status: 409 },
    );
  }

  if (reply.status !== 'draft' && reply.status !== 'selected') {
    return json(
      { error: 'invalid_state', message: `Cannot publish reply with status '${reply.status}'` },
      { status: 409 },
    );
  }

  // ── 8. Find active Google integration for this biz ────────────────────────
  const { data: integration } = await supabase
    .from('integrations')
    .select('id, provider')
    .eq('biz_id', reply.biz_id)
    .eq('provider', 'google_business')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!integration) {
    log.warn('No active google_business integration', { biz_id: reply.biz_id });
    return json(
      { error: 'no_integration', message: 'No active Google Business integration found for this business' },
      { status: 422 },
    );
  }

  // ── 9. Idempotency key (scoped to biz_id via UNIQUE(biz_id, idempotency_key)) ──
  const idempotencyKey = buildReplyPublishIdempotencyKey({
    replyId: params.replyId,
    updatedAtIso: reply.updated_at,
  });

  const { data: existingJob } = await supabase
    .from('publish_jobs')
    .select('id, status')
    .eq('biz_id', reply.biz_id)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existingJob) {
    log.info('Returning existing publish job (idempotent)', { job_id: existingJob.id });
    return json({ job_id: existingJob.id, status: existingJob.status });
  }

  // ── 10. Apply final_content override if provided ──────────────────────────
  if (body.final_content && body.final_content !== reply.content) {
    await supabase
      .from('replies')
      .update({ content: body.final_content, updated_at: new Date().toISOString() })
      .eq('id', params.replyId);
  }

  // ── 11. Create publish_job ─────────────────────────────────────────────────
  const { data: newJob, error: jobErr } = await supabase
    .from('publish_jobs')
    .insert({
      reply_id:        params.replyId,
      biz_id:          reply.biz_id,
      org_id:          reply.org_id,
      integration_id:  integration.id,
      status:          'queued',
      next_attempt_at: new Date().toISOString(),
      idempotency_key: idempotencyKey,
    })
    .select('id, status')
    .single();

  if (jobErr || !newJob) {
    log.error('publish_jobs insert failed', { error: jobErr?.message });
    return json({ error: 'job_enqueue_failed', message: 'Failed to enqueue publish job' }, { status: 500 });
  }

  log.info('Publish job enqueued', { job_id: newJob.id, reply_id: params.replyId });

  // ── 12. Audit (non-blocking) ──────────────────────────────────────────────
  void audit(supabase, {
    orgId:      reply.org_id,
    bizId:      reply.biz_id,
    userId:     user.id,
    action:     'approve_reply',
    targetType: 'reply',
    targetId:   params.replyId,
    metadata:   { request_id: requestId, review_id: reply.review_id, job_id: newJob.id },
  }).catch(() => { /* non-blocking */ });

  void writeAudit({
    bizId:      reply.biz_id,
    userId:     user.id,
    requestId,
    action:     'publish_reply_queued',
    resource:   'publish_jobs',
    resourceId: newJob.id,
    result:     'success',
    details:    { reply_id: params.replyId, review_id: reply.review_id, integration_id: integration.id },
  }).catch(() => { /* writeAudit never throws */ });

  return json({ job_id: newJob.id, status: 'queued' }, { status: 201 });
}
