-- Flow D1.2+ hardening
-- Idempotent job ledger for LITO copy generate/refine

create table if not exists public.lito_copy_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  recommendation_id uuid not null references public.recommendation_log(id) on delete cascade,
  action text not null,
  idempotency_key text not null,
  status text not null default 'running',
  result jsonb null,
  error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lito_copy_jobs_action_check'
      and conrelid = 'public.lito_copy_jobs'::regclass
  ) then
    alter table public.lito_copy_jobs
      add constraint lito_copy_jobs_action_check
      check (action in ('generate', 'refine'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lito_copy_jobs_status_check'
      and conrelid = 'public.lito_copy_jobs'::regclass
  ) then
    alter table public.lito_copy_jobs
      add constraint lito_copy_jobs_status_check
      check (status in ('running', 'success', 'failed'));
  end if;
end $$;

create unique index if not exists ux_lito_copy_jobs_org_idempotency
  on public.lito_copy_jobs (org_id, idempotency_key);

create index if not exists idx_lito_copy_jobs_biz_created
  on public.lito_copy_jobs (biz_id, created_at desc);

create index if not exists idx_lito_copy_jobs_recommendation
  on public.lito_copy_jobs (recommendation_id, created_at desc);

alter table public.lito_copy_jobs enable row level security;

drop policy if exists "lito_copy_jobs_select_authenticated_scope" on public.lito_copy_jobs;
create policy "lito_copy_jobs_select_authenticated_scope"
  on public.lito_copy_jobs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = lito_copy_jobs.biz_id
        and bm.org_id = lito_copy_jobs.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = lito_copy_jobs.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and lower(m.role) in ('owner', 'admin')
    )
  );

drop policy if exists "lito_copy_jobs_deny_write_authenticated" on public.lito_copy_jobs;
create policy "lito_copy_jobs_deny_write_authenticated"
  on public.lito_copy_jobs
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "lito_copy_jobs_service_role_all" on public.lito_copy_jobs;
create policy "lito_copy_jobs_service_role_all"
  on public.lito_copy_jobs
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';
