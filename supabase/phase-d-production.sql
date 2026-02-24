-- ============================================================
-- OpinIA Phase D — Production Hardening
-- Run AFTER phase-c-insights.sql
-- Adds: insights_daily, job_runs, billing columns, usage enforcement
-- ============================================================

-- 1) INSIGHTS DAILY (pre-aggregated for fast reads)
-- ============================================================
create table if not exists public.insights_daily (
  id          uuid primary key default uuid_generate_v4(),
  biz_id      uuid not null references public.businesses(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  date        date not null,
  topic       text not null,
  praise_count integer not null default 0,
  complaint_count integer not null default 0,
  neutral_count integer not null default 0,
  total_count  integer not null default 0,
  avg_rating   real not null default 0,
  urgency_high_count integer not null default 0,
  unique (biz_id, date, topic)
);

create index if not exists idx_insights_daily_biz_date
  on public.insights_daily(biz_id, date desc);

create index if not exists idx_insights_daily_org
  on public.insights_daily(org_id, date desc);

alter table public.insights_daily enable row level security;

drop policy if exists "insights_daily_select" on public.insights_daily;
create policy "insights_daily_select" on public.insights_daily
  for select using (org_id in (select public.user_org_ids()));

-- Service role writes via cron/jobs
drop policy if exists "insights_daily_all" on public.insights_daily;
create policy "insights_daily_all" on public.insights_daily
  for all using (true) with check (true);


-- 2) JOB RUNS (observability)
-- ============================================================
create table if not exists public.job_runs (
  id          uuid primary key default uuid_generate_v4(),
  job_type    text not null,            -- analyze_review, rebuild_insights, sync_reviews
  biz_id      uuid references public.businesses(id) on delete set null,
  org_id      uuid references public.organizations(id) on delete set null,
  status      text not null default 'pending',  -- pending, running, success, failed
  input       jsonb default '{}'::jsonb,
  output      jsonb default '{}'::jsonb,
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  created_at  timestamptz not null default now()
);

create index if not exists idx_job_runs_type_status
  on public.job_runs(job_type, status);

create index if not exists idx_job_runs_biz
  on public.job_runs(biz_id, created_at desc);

alter table public.job_runs enable row level security;

drop policy if exists "job_runs_select" on public.job_runs;
create policy "job_runs_select" on public.job_runs
  for select using (org_id in (select public.user_org_ids()));

drop policy if exists "job_runs_all_service" on public.job_runs;
create policy "job_runs_all_service" on public.job_runs
  for all using (true) with check (true);


-- 3) EXTEND ORGANIZATIONS (billing columns)
-- ============================================================
alter table public.organizations
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id        text,
  add column if not exists billing_period_start    date,
  add column if not exists billing_period_end      date,
  add column if not exists max_team_members        integer not null default 1;


-- 4) USAGE MONTHLY — allow service_role writes
-- ============================================================
drop policy if exists "usage_upsert" on public.usage_monthly;
create policy "usage_upsert" on public.usage_monthly
  for all using (true) with check (true);
