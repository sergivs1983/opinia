-- ============================================================
-- OpinIA Phase A — Dead Letter Queue (failed_jobs)
-- ============================================================

create table if not exists public.failed_jobs (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  biz_id          uuid not null references public.businesses(id) on delete cascade,
  job_type        text not null,
  payload         jsonb not null default '{}'::jsonb,
  error_code      text,
  error_message   text,
  provider        text,
  model           text,
  attempt_count   int not null default 0,
  max_attempts    int not null default 5,
  next_retry_at   timestamptz,
  status          text not null default 'queued'
                    check (status in ('queued', 'retrying', 'failed', 'resolved')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Partial index: only retryable jobs (what the retry worker scans)
create index if not exists idx_fj_retryable
  on public.failed_jobs (next_retry_at)
  where status in ('queued', 'retrying');

create index if not exists idx_fj_org_biz
  on public.failed_jobs (org_id, biz_id, created_at desc);

create index if not exists idx_fj_status_type
  on public.failed_jobs (status, job_type);

create trigger trg_fj_updated_at
  before update on public.failed_jobs
  for each row execute function public.trg_set_updated_at();

-- RLS
alter table public.failed_jobs enable row level security;

create policy "fj_select_org" on public.failed_jobs
  for select to authenticated
  using (org_id in (select public.user_org_ids()));

-- service_role writes (bypasses RLS automatically)

comment on table public.failed_jobs is
  'DLQ for failed LLM calls and async job errors. Retryable via /api/dlq endpoints.';
