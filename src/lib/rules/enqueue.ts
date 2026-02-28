import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { renderTemplate, type RuleTemplateData } from '@/lib/rules/template';

type IntegrationRow = {
  id: string;
};

type BusinessRow = {
  id: string;
  name: string;
  default_signature: string | null;
};

type ReviewRow = {
  id: string;
  external_id: string | null;
  author_name: string | null;
  review_text: string;
  rating: number;
};

type ExistingJobRow = {
  id: string;
  status: string;
};

type ReplyRow = {
  id: string;
};

type RuleEnqueueInput = {
  admin: SupabaseClient;
  orgId: string;
  bizId: string;
  provider: 'google_business';
  reviewExternalId: string;
  actionId: string;
  templateVersion: number;
  template: string;
  reviewSnapshot?: Partial<{
    reviewer_name: string;
    review_text: string;
    rating: number;
  }>;
};

export type RuleEnqueueResult = {
  enqueued: boolean;
  publish_job_id: string | null;
  idempotency_key: string;
  reason?: string;
};

function hashSha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isSchemaMissing(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '').toLowerCase();
  const message = String((error as { message?: string })?.message || '').toLowerCase();
  return code === '42p01' || code === '42703' || message.includes('does not exist');
}

function isConflict(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '').toLowerCase();
  return code === '23505';
}

function buildTemplateData(args: {
  business: BusinessRow;
  review: ReviewRow | null;
  snapshot?: RuleEnqueueInput['reviewSnapshot'];
}): RuleTemplateData {
  const { business, review, snapshot } = args;
  return {
    business_name: business.name,
    reviewer_name: review?.author_name || snapshot?.reviewer_name || 'Client',
    rating: review?.rating ?? snapshot?.rating ?? '',
    review_text: review?.review_text || snapshot?.review_text || '',
    signature: business.default_signature || '',
  };
}

async function findReview(
  admin: SupabaseClient,
  bizId: string,
  reviewExternalId: string,
): Promise<ReviewRow | null> {
  const byExternal = await admin
    .from('reviews')
    .select('id, external_id, author_name, review_text, rating')
    .eq('biz_id', bizId)
    .eq('external_id', reviewExternalId)
    .limit(1)
    .maybeSingle();

  if (!byExternal.error && byExternal.data) {
    return byExternal.data as ReviewRow;
  }

  if (!/^[0-9a-f-]{36}$/i.test(reviewExternalId)) {
    return null;
  }

  const byId = await admin
    .from('reviews')
    .select('id, external_id, author_name, review_text, rating')
    .eq('biz_id', bizId)
    .eq('id', reviewExternalId)
    .limit(1)
    .maybeSingle();

  if (!byId.error && byId.data) {
    return byId.data as ReviewRow;
  }

  return null;
}

export async function enqueueRulePublishJob(input: RuleEnqueueInput): Promise<RuleEnqueueResult> {
  const {
    admin,
    orgId,
    bizId,
    provider,
    reviewExternalId,
    actionId,
    templateVersion,
    template,
    reviewSnapshot,
  } = input;

  const idempotencyMaterial = `${orgId}|${bizId}|${provider}|${reviewExternalId}|${actionId}|${templateVersion}`;
  const idempotencyKey = hashSha256(idempotencyMaterial);

  const existingJobResult = await admin
    .from('publish_jobs')
    .select('id, status')
    .eq('biz_id', bizId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existingJobResult.data) {
    const existing = existingJobResult.data as ExistingJobRow;
    return {
      enqueued: true,
      publish_job_id: existing.id,
      idempotency_key: idempotencyKey,
      reason: 'idempotent_hit',
    };
  }
  if (existingJobResult.error && !isSchemaMissing(existingJobResult.error)) {
    throw new Error(existingJobResult.error.message || 'publish_jobs_lookup_failed');
  }
  if (existingJobResult.error && isSchemaMissing(existingJobResult.error)) {
    return {
      enqueued: false,
      publish_job_id: null,
      idempotency_key: idempotencyKey,
      reason: 'publish_jobs_unavailable',
    };
  }

  const { data: business, error: businessError } = await admin
    .from('businesses')
    .select('id, name, default_signature')
    .eq('id', bizId)
    .single();
  if (businessError || !business) {
    return {
      enqueued: false,
      publish_job_id: null,
      idempotency_key: idempotencyKey,
      reason: 'missing_business',
    };
  }

  const { data: integration } = await admin
    .from('integrations')
    .select('id')
    .eq('biz_id', bizId)
    .eq('provider', provider)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!integration) {
    return {
      enqueued: false,
      publish_job_id: null,
      idempotency_key: idempotencyKey,
      reason: 'missing_integration',
    };
  }

  const review = await findReview(admin, bizId, reviewExternalId);
  if (!review && !reviewSnapshot?.review_text) {
    return {
      enqueued: false,
      publish_job_id: null,
      idempotency_key: idempotencyKey,
      reason: 'missing_review_data',
    };
  }

  const content = renderTemplate(template, buildTemplateData({
    business: business as BusinessRow,
    review,
    snapshot: reviewSnapshot,
  }));

  const reviewId = review?.id || null;
  if (!reviewId) {
    return {
      enqueued: false,
      publish_job_id: null,
      idempotency_key: idempotencyKey,
      reason: 'missing_review_id',
    };
  }

  const { data: replyData, error: replyError } = await admin
    .from('replies')
    .insert({
      review_id: reviewId,
      biz_id: bizId,
      org_id: orgId,
      tone: 'proper',
      content,
      status: 'selected',
      is_edited: true,
    })
    .select('id')
    .single();

  if (replyError || !replyData) {
    throw new Error(replyError?.message || 'reply_insert_failed');
  }

  const reply = replyData as ReplyRow;

  const { data: jobData, error: jobError } = await admin
    .from('publish_jobs')
    .insert({
      reply_id: reply.id,
      biz_id: bizId,
      org_id: orgId,
      integration_id: (integration as IntegrationRow).id,
      status: 'queued',
      next_attempt_at: new Date().toISOString(),
      idempotency_key: idempotencyKey,
    })
    .select('id')
    .single();

  if (jobError && isConflict(jobError)) {
    const retryLookup = await admin
      .from('publish_jobs')
      .select('id, status')
      .eq('biz_id', bizId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (retryLookup.data) {
      return {
        enqueued: true,
        publish_job_id: (retryLookup.data as ExistingJobRow).id,
        idempotency_key: idempotencyKey,
        reason: 'idempotent_conflict',
      };
    }
  }

  if (jobError) {
    if (isSchemaMissing(jobError)) {
      return {
        enqueued: false,
        publish_job_id: null,
        idempotency_key: idempotencyKey,
        reason: 'publish_jobs_unavailable',
      };
    }
    throw new Error(jobError.message || 'publish_job_insert_failed');
  }

  return {
    enqueued: true,
    publish_job_id: (jobData as { id: string }).id,
    idempotency_key: idempotencyKey,
  };
}
