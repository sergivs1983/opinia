import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActionCard } from '@/types/lito-cards';

export const LITO_REBUILD_CARDS_JOB_TYPE = 'rebuild_cards';
export const LITO_WORKER_DEFAULT_LIMIT = 20;
export const LITO_WORKER_MAX_ATTEMPTS = 3;

export type LitoCardsCacheRow = {
  biz_id: string;
  cards: unknown;
  generated_at: string | null;
  stale: boolean;
  mode: string;
  updated_at: string;
};

export type LitoJobRow = {
  id: string;
  biz_id: string;
  job_type: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  run_at: string;
  attempts: number;
  last_error: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
};

function truncateErrorMessage(input: unknown): string {
  const raw = input instanceof Error ? input.message : String(input || 'unknown_error');
  return raw.slice(0, 600);
}

export async function getLitoCardsCacheByBiz(input: {
  admin: SupabaseClient;
  bizId: string;
}): Promise<LitoCardsCacheRow | null> {
  const { data, error } = await input.admin
    .from('lito_cards_cache')
    .select('biz_id, cards, generated_at, stale, mode, updated_at')
    .eq('biz_id', input.bizId)
    .maybeSingle();

  if (error) throw new Error(error.message || 'lito_cards_cache_fetch_failed');
  return (data as LitoCardsCacheRow | null) || null;
}

export async function enqueueRebuildCards(input: {
  supabase: SupabaseClient;
  bizId: string;
}): Promise<void> {
  const { error } = await input.supabase.rpc('enqueue_rebuild_cards', { p_biz_id: input.bizId });
  if (error) throw new Error(error.message || 'enqueue_rebuild_cards_failed');
}

export async function popLitoJobs(input: {
  admin: SupabaseClient;
  limit?: number;
}): Promise<LitoJobRow[]> {
  const safeLimit = Math.max(1, Math.min(input.limit ?? LITO_WORKER_DEFAULT_LIMIT, 100));
  const { data, error } = await input.admin.rpc('pop_lito_jobs', { p_limit: safeLimit });
  if (error) throw new Error(error.message || 'pop_lito_jobs_failed');
  return ((data || []) as LitoJobRow[]).filter((row) => row.job_type === LITO_REBUILD_CARDS_JOB_TYPE);
}

export async function cleanupStuckLitoJobs(input: {
  admin: SupabaseClient;
}): Promise<number> {
  const { data, error } = await input.admin.rpc('cleanup_lito_jobs');
  if (error) throw new Error(error.message || 'cleanup_lito_jobs_failed');

  if (typeof data === 'number' && Number.isFinite(data)) return data;
  const parsed = Number(data ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function upsertLitoCardsCache(input: {
  admin: SupabaseClient;
  bizId: string;
  cards: ActionCard[];
  generatedAt: string;
  mode: 'basic' | 'advanced';
  stale: boolean;
}): Promise<void> {
  const { error } = await input.admin
    .from('lito_cards_cache')
    .upsert(
      {
        biz_id: input.bizId,
        cards: input.cards,
        generated_at: input.generatedAt,
        mode: input.mode,
        stale: input.stale,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'biz_id' },
    );

  if (error) throw new Error(error.message || 'lito_cards_cache_upsert_failed');
}

export async function markLitoJobDone(input: {
  admin: SupabaseClient;
  jobId: string;
}): Promise<void> {
  const { error } = await input.admin
    .from('lito_jobs')
    .update({
      status: 'done',
      locked_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.jobId)
    .eq('status', 'running');

  if (error) throw new Error(error.message || 'lito_job_mark_done_failed');
}

export async function markLitoJobFailedOrRetry(input: {
  admin: SupabaseClient;
  job: Pick<LitoJobRow, 'id' | 'attempts'>;
  error: unknown;
}): Promise<void> {
  const now = new Date();
  const shouldFail = (input.job.attempts || 0) >= LITO_WORKER_MAX_ATTEMPTS;

  const payload = {
    status: shouldFail ? 'failed' : 'queued',
    run_at: shouldFail ? now.toISOString() : new Date(now.getTime() + 60_000).toISOString(),
    locked_at: null,
    last_error: truncateErrorMessage(input.error),
    updated_at: now.toISOString(),
  };

  const { error } = await input.admin
    .from('lito_jobs')
    .update(payload)
    .eq('id', input.job.id)
    .eq('status', 'running');

  if (error) throw new Error(error.message || 'lito_job_mark_failed_or_retry_failed');
}

export function normalizeCachedCards(cards: unknown): ActionCard[] {
  if (!Array.isArray(cards)) return [];
  return cards
    .filter((item) => item && typeof item === 'object')
    .map((item) => item as ActionCard)
    .filter((card) => typeof card.id === 'string' && typeof card.type === 'string');
}
