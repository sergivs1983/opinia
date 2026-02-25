export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { createLogger, createRequestId } from '@/lib/logger';
import { audit } from '@/lib/audit';
import { bumpDailyMetric } from '@/lib/metrics';
import { dispatchEvent } from '@/lib/integrations';
import { validateBody, ApproveReplySchema } from '@/lib/validations';
import { hasAcceptedBusinessMembership } from '@/lib/authz';
import { asMembershipRoleFilter, PUBLISH_ROLES } from '@/lib/roles';

export async function POST(
  request: Request,
  { params }: { params: { replyId: string } }
) {
  const requestId = request.headers.get('x-request-id')?.trim() || createRequestId();
  const log = createLogger({ request_id: requestId, route: '/api/replies/approve' });
  const startMs = Date.now();

  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'Auth required' }, { status: 401 });

  log.info('Approve request', { reply_id: params.replyId, user_id: user.id });

  // ── Validate ──
  const [body, err] = await validateBody(request, ApproveReplySchema);
  if (err) return err;

  // Get reply with status check
  const { data: reply } = await supabase
    .from('replies')
    .select('id, review_id, biz_id, org_id, status, content')
    .eq('id', params.replyId)
    .single();

  if (!reply) {
    log.warn('Reply not found', { reply_id: params.replyId });
    return NextResponse.json({ error: 'not_found', message: 'Reply not found' }, { status: 404 });
  }

  const publishAccess = await hasAcceptedBusinessMembership({
    supabase,
    userId: user.id,
    businessId: reply.biz_id,
    allowedRoles: asMembershipRoleFilter(PUBLISH_ROLES),
  });
  if (!publishAccess.allowed) {
    return NextResponse.json(
      { error: 'forbidden', message: 'No tens permisos per publicar respostes en aquesta organització.' },
      { status: 403 },
    );
  }

  // IDEMPOTENCY: if already published, return success
  if (reply.status === 'published') {
    log.info('Reply already published (idempotent)', { reply_id: params.replyId });
    return NextResponse.json({ success: true, already_published: true });
  }

  if (reply.status !== 'draft') {
    log.warn('Reply not in draft status', { reply_id: params.replyId, status: reply.status });
    return NextResponse.json({ error: 'invalid_state', message: `Reply is ${reply.status}, not draft` }, { status: 409 });
  }

  // Update to published
  const { error } = await supabase.from('replies').update({
    status: 'published',
    content: body.final_content,
    is_edited: true,
    published_at: new Date().toISOString(),
    published_by: user.id,
  }).eq('id', params.replyId);

  if (error) {
    log.error('Publish failed', { error: error.message });
    return NextResponse.json({ error: 'db_error', message: error.message }, { status: 500 });
  }

  // Archive other drafts
  await supabase.from('replies')
    .update({ status: 'archived' })
    .eq('review_id', reply.review_id)
    .neq('id', params.replyId)
    .eq('status', 'draft');

  // Mark review as replied
  await supabase.from('reviews')
    .update({ is_replied: true })
    .eq('id', reply.review_id);

  await bumpDailyMetric(
    reply.biz_id,
    new Date().toISOString().slice(0, 10),
    { replies_approved: 1 },
    { log },
  );

  void dispatchEvent({
    businessId: reply.biz_id,
    event: 'reply.approved',
    data: {
      reply_id: reply.id,
      review_id: reply.review_id,
      status: 'published',
    },
    requestId,
    userId: user.id,
    log: log.child({ hook: 'reply.approved' }),
  }).catch((dispatchError: unknown) => {
    log.warn('reply.approved integration dispatch failed (non-blocking)', {
      reply_id: reply.id,
      error: dispatchError instanceof Error ? dispatchError.message : 'unknown',
    });
  });

  // Golden Dataset: save diff if human edited
  if (reply.content && body.final_content !== reply.content) {
    const diffScore = computeDiffScore(reply.content, body.final_content);
    await supabase.from('ai_reply_edits').insert({
      org_id: reply.org_id,
      biz_id: reply.biz_id,
      review_id: reply.review_id,
      reply_id: reply.id,
      original_ai_reply: reply.content,
      final_human_reply: body.final_content,
      diff_score: diffScore,
    }).then(({ error: e }) => {
      if (e) log.warn('Golden dataset save failed (non-blocking)', { error: e.message });
    });
  }

  // Audit
  await audit(supabase, {
    orgId: reply.org_id, bizId: reply.biz_id, userId: user.id,
    action: 'approve_reply', targetType: 'reply', targetId: params.replyId,
    metadata: { request_id: requestId, review_id: reply.review_id },
  });

  log.info('Reply published', { reply_id: params.replyId, duration_ms: Date.now() - startMs });
  return NextResponse.json({ success: true });
}

function computeDiffScore(original: string, edited: string): number {
  const wordsA = new Set(original.toLowerCase().split(/\s+/).filter(w => w.length > 1));
  const wordsB = new Set(edited.toLowerCase().split(/\s+/).filter(w => w.length > 1));
  if (wordsA.size === 0 && wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  const similarity = union > 0 ? intersection / union : 0;
  return Math.round((1 - similarity) * 100);
}
