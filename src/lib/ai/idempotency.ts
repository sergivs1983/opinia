import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemberRole } from '@/types/database';

export type LitoCopyAction = 'generate' | 'refine';

type LitoCopyJobRow = {
  id: string;
  status: 'running' | 'success' | 'failed';
  result: unknown;
  error: string | null;
  updated_at: string;
};

export type AcquireLitoCopyJobResult =
  | { state: 'acquired'; jobId: string; idempotencyKey: string }
  | { state: 'cached'; idempotencyKey: string; result: Record<string, unknown> }
  | { state: 'in_flight'; idempotencyKey: string }
  | { state: 'retry_later'; idempotencyKey: string };

type BuildIdempotencyInput = {
  org_id: string;
  biz_id: string;
  recommendation_id: string;
  action: LitoCopyAction;
  instruction?: string | null;
  model?: string | null;
  lang?: string | null;
  format?: string | null;
  channel?: string | null;
  tone?: string | null;
};

function normalize(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function isUniqueViolation(error: unknown): boolean {
  const code = ((error as { code?: string })?.code || '').toUpperCase();
  const message = ((error as { message?: string })?.message || '').toLowerCase();
  return code === '23505' || message.includes('duplicate key');
}

export function buildIdempotencyKey(input: BuildIdempotencyInput): string {
  const canonical = [
    normalize(input.org_id),
    normalize(input.biz_id),
    normalize(input.recommendation_id),
    normalize(input.action),
    normalize(input.instruction || ''),
    normalize(input.model || ''),
    normalize(input.lang || ''),
    normalize(input.format || ''),
    normalize(input.channel || ''),
    normalize(input.tone || ''),
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

export async function acquireLitoCopyJob(params: {
  admin: SupabaseClient;
  orgId: string;
  bizId: string;
  recommendationId: string;
  userId: string;
  role: MemberRole;
  action: LitoCopyAction;
  idempotencyKey: string;
  retryAfterMs?: number;
}): Promise<AcquireLitoCopyJobResult> {
  const nowIso = new Date().toISOString();
  const retryAfterMs = params.retryAfterMs ?? 10_000;

  const { data: insertData, error: insertErr } = await params.admin
    .from('lito_copy_jobs')
    .insert({
      org_id: params.orgId,
      biz_id: params.bizId,
      recommendation_id: params.recommendationId,
      user_id: params.userId,
      role: params.role,
      action: params.action,
      idempotency_key: params.idempotencyKey,
      status: 'running',
      updated_at: nowIso,
    })
    .select('id')
    .single();

  if (!insertErr && insertData) {
    return {
      state: 'acquired',
      jobId: (insertData as { id: string }).id,
      idempotencyKey: params.idempotencyKey,
    };
  }

  if (!isUniqueViolation(insertErr)) {
    throw insertErr;
  }

  const { data: existingData, error: existingErr } = await params.admin
    .from('lito_copy_jobs')
    .select('id, status, result, error, updated_at')
    .eq('org_id', params.orgId)
    .eq('idempotency_key', params.idempotencyKey)
    .maybeSingle();

  if (existingErr || !existingData) {
    throw existingErr || new Error('idempotency_job_not_found');
  }

  const existing = existingData as LitoCopyJobRow;

  if (existing.status === 'success' && existing.result && typeof existing.result === 'object') {
    return {
      state: 'cached',
      idempotencyKey: params.idempotencyKey,
      result: existing.result as Record<string, unknown>,
    };
  }

  if (existing.status === 'running') {
    return {
      state: 'in_flight',
      idempotencyKey: params.idempotencyKey,
    };
  }

  const updatedAtMs = Date.parse(existing.updated_at || '');
  if (Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs < retryAfterMs) {
    return {
      state: 'retry_later',
      idempotencyKey: params.idempotencyKey,
    };
  }

  const { data: claimData, error: claimErr } = await params.admin
    .from('lito_copy_jobs')
    .update({
      status: 'running',
      error: null,
      updated_at: nowIso,
    })
    .eq('id', existing.id)
    .eq('status', 'failed')
    .eq('updated_at', existing.updated_at)
    .select('id')
    .maybeSingle();

  if (claimErr) {
    throw claimErr;
  }

  if (!claimData) {
    return {
      state: 'in_flight',
      idempotencyKey: params.idempotencyKey,
    };
  }

  return {
    state: 'acquired',
    jobId: (claimData as { id: string }).id,
    idempotencyKey: params.idempotencyKey,
  };
}

export async function markLitoCopyJobSuccess(params: {
  admin: SupabaseClient;
  jobId: string;
  result: Record<string, unknown>;
}): Promise<void> {
  await params.admin
    .from('lito_copy_jobs')
    .update({
      status: 'success',
      result: params.result,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.jobId);
}

export async function markLitoCopyJobFailed(params: {
  admin: SupabaseClient;
  jobId: string;
  error: string;
}): Promise<void> {
  await params.admin
    .from('lito_copy_jobs')
    .update({
      status: 'failed',
      error: params.error.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.jobId)
    .neq('status', 'success');
}
