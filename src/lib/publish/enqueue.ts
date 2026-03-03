import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildDraftExecutionPublishIdempotencyKey,
  buildReplyPublishIdempotencyKey,
  parsePublishJobStatus,
} from '@/lib/publish/domain';

type PublishJobRow = {
  id: string;
  status: string;
};

type IntegrationRow = {
  id: string;
};

export class PublishEnqueueError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = 'PublishEnqueueError';
    this.code = code;
    this.status = status;
  }
}

export type EnqueuePublishJobResult = {
  jobId: string;
  status: string;
  idempotencyKey: string;
  reused: boolean;
};

function isConflict(error: { code?: string } | null | undefined): boolean {
  return String(error?.code || '').toUpperCase() === '23505';
}

function normalizeIdempotencyKey(input: {
  draftId?: string | null;
  reviewId?: string | null;
  replyContent?: string | null;
  replyId: string;
  replyUpdatedAtIso?: string | null;
}): string {
  if (input.draftId && input.reviewId && input.replyContent) {
    return buildDraftExecutionPublishIdempotencyKey({
      draftId: input.draftId,
      reviewId: input.reviewId,
      replyContent: input.replyContent,
    });
  }

  return buildReplyPublishIdempotencyKey({
    replyId: input.replyId,
    updatedAtIso: input.replyUpdatedAtIso || new Date().toISOString(),
  });
}

async function getActiveGoogleIntegrationId(input: {
  admin: SupabaseClient;
  bizId: string;
}): Promise<string> {
  const { data, error } = await input.admin
    .from('integrations')
    .select('id')
    .eq('biz_id', input.bizId)
    .eq('provider', 'google_business')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new PublishEnqueueError('integration_lookup_failed', error.message || 'integration_lookup_failed', 500);
  }
  if (!data) {
    throw new PublishEnqueueError('integration_not_found', 'No active Google integration found', 422);
  }

  return (data as IntegrationRow).id;
}

export async function enqueuePublishJob(input: {
  admin: SupabaseClient;
  bizId: string;
  orgId: string;
  replyId: string;
  replyUpdatedAtIso?: string | null;
  draftId?: string | null;
  reviewId?: string | null;
  replyContent?: string | null;
}): Promise<EnqueuePublishJobResult> {
  const idempotencyKey = normalizeIdempotencyKey({
    draftId: input.draftId,
    reviewId: input.reviewId,
    replyContent: input.replyContent,
    replyId: input.replyId,
    replyUpdatedAtIso: input.replyUpdatedAtIso,
  });

  const existing = await input.admin
    .from('publish_jobs')
    .select('id, status')
    .eq('biz_id', input.bizId)
    .eq('idempotency_key', idempotencyKey)
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    throw new PublishEnqueueError('publish_job_lookup_failed', existing.error.message || 'publish_job_lookup_failed', 500);
  }
  if (existing.data) {
    const row = existing.data as PublishJobRow;
    return {
      jobId: row.id,
      status: parsePublishJobStatus(row.status) || row.status,
      idempotencyKey,
      reused: true,
    };
  }

  const integrationId = await getActiveGoogleIntegrationId({
    admin: input.admin,
    bizId: input.bizId,
  });

  const { data: inserted, error: insertError } = await input.admin
    .from('publish_jobs')
    .insert({
      reply_id: input.replyId,
      biz_id: input.bizId,
      org_id: input.orgId,
      integration_id: integrationId,
      status: 'queued',
      next_attempt_at: new Date().toISOString(),
      idempotency_key: idempotencyKey,
    })
    .select('id, status')
    .single();

  if (insertError && isConflict(insertError)) {
    const raced = await input.admin
      .from('publish_jobs')
      .select('id, status')
      .eq('biz_id', input.bizId)
      .eq('idempotency_key', idempotencyKey)
      .limit(1)
      .maybeSingle();

    if (raced.data) {
      const row = raced.data as PublishJobRow;
      return {
        jobId: row.id,
        status: parsePublishJobStatus(row.status) || row.status,
        idempotencyKey,
        reused: true,
      };
    }
  }

  if (insertError || !inserted) {
    throw new PublishEnqueueError('publish_job_insert_failed', insertError?.message || 'publish_job_insert_failed', 500);
  }

  const row = inserted as PublishJobRow;
  return {
    jobId: row.id,
    status: parsePublishJobStatus(row.status) || row.status,
    idempotencyKey,
    reused: false,
  };
}
