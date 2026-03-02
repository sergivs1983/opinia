begin;

create table if not exists public.lito_cards_cache (
  biz_id uuid primary key references public.businesses(id) on delete cascade,
  cards jsonb not null default '[]'::jsonb,
  generated_at timestamptz null,
  stale boolean not null default true,
  mode text not null default 'basic',
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lito_cards_cache_mode_check'
      and conrelid = 'public.lito_cards_cache'::regclass
  ) then
    alter table public.lito_cards_cache
      add constraint lito_cards_cache_mode_check
      check (mode in ('basic', 'advanced'));
  end if;
end $$;

create index if not exists idx_lito_cards_cache_stale_updated
  on public.lito_cards_cache (stale, updated_at desc);

create table if not exists public.lito_jobs (
  id uuid primary key default gen_random_uuid(),
  biz_id uuid not null references public.businesses(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued',
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text null,
  locked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lito_jobs_job_type_check'
      and conrelid = 'public.lito_jobs'::regclass
  ) then
    alter table public.lito_jobs
      add constraint lito_jobs_job_type_check
      check (job_type in ('rebuild_cards'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lito_jobs_status_check'
      and conrelid = 'public.lito_jobs'::regclass
  ) then
    alter table public.lito_jobs
      add constraint lito_jobs_status_check
      check (status in ('queued', 'running', 'done', 'failed'));
  end if;
end $$;

create index if not exists idx_lito_jobs_poll
  on public.lito_jobs (run_at asc, created_at asc)
  where status = 'queued';

create index if not exists idx_lito_jobs_biz_created
  on public.lito_jobs (biz_id, created_at desc);

create unique index if not exists ux_lito_jobs_rebuild_dedupe
  on public.lito_jobs (biz_id, job_type)
  where status in ('queued', 'running');

alter table public.lito_cards_cache enable row level security;
alter table public.lito_jobs enable row level security;

drop policy if exists "lito_cards_cache_deny_authenticated" on public.lito_cards_cache;
create policy "lito_cards_cache_deny_authenticated"
  on public.lito_cards_cache
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "lito_cards_cache_service_role_all" on public.lito_cards_cache;
create policy "lito_cards_cache_service_role_all"
  on public.lito_cards_cache
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "lito_jobs_deny_authenticated" on public.lito_jobs;
create policy "lito_jobs_deny_authenticated"
  on public.lito_jobs
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "lito_jobs_service_role_all" on public.lito_jobs;
create policy "lito_jobs_service_role_all"
  on public.lito_jobs
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.enqueue_rebuild_cards(p_biz_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_biz_id is null then
    return;
  end if;

  insert into public.lito_cards_cache (biz_id, stale, updated_at)
  values (p_biz_id, true, now())
  on conflict (biz_id)
  do update
  set stale = true,
      updated_at = now();

  insert into public.lito_jobs (biz_id, job_type, status, run_at, updated_at)
  values (p_biz_id, 'rebuild_cards', 'queued', now(), now())
  on conflict (biz_id, job_type) where status in ('queued', 'running')
  do nothing;
end;
$$;

revoke all on function public.enqueue_rebuild_cards(uuid) from public;
revoke all on function public.enqueue_rebuild_cards(uuid) from anon;
revoke all on function public.enqueue_rebuild_cards(uuid) from authenticated;
grant execute on function public.enqueue_rebuild_cards(uuid) to service_role;

create or replace function public.pop_lito_jobs(p_limit integer default 20)
returns setof public.lito_jobs
language sql
security definer
set search_path = public
as $$
  with claim as (
    select lj.id
    from public.lito_jobs lj
    where lj.status = 'queued'
      and lj.job_type = 'rebuild_cards'
      and lj.run_at <= now()
      and (lj.locked_at is null or lj.locked_at < now() - interval '10 minutes')
    order by lj.run_at asc, lj.created_at asc
    limit greatest(coalesce(p_limit, 20), 1)
    for update skip locked
  )
  update public.lito_jobs lj
  set
    status = 'running',
    attempts = lj.attempts + 1,
    locked_at = now(),
    updated_at = now()
  from claim
  where lj.id = claim.id
  returning lj.*;
$$;

revoke all on function public.pop_lito_jobs(integer) from public;
revoke all on function public.pop_lito_jobs(integer) from anon;
revoke all on function public.pop_lito_jobs(integer) from authenticated;
grant execute on function public.pop_lito_jobs(integer) to service_role;

create or replace function public.lito_enqueue_rebuild_cards_from_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_biz_id uuid;
begin
  v_biz_id := coalesce(new.biz_id, old.biz_id);
  perform public.enqueue_rebuild_cards(v_biz_id);
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.social_drafts') is not null then
    drop trigger if exists trg_lito_enqueue_rebuild_cards_social_drafts on public.social_drafts;
    create trigger trg_lito_enqueue_rebuild_cards_social_drafts
      after insert or update of status
      on public.social_drafts
      for each row
      execute function public.lito_enqueue_rebuild_cards_from_row();
  end if;
end $$;

do $$
begin
  if to_regclass('public.social_schedules') is not null then
    drop trigger if exists trg_lito_enqueue_rebuild_cards_social_schedules on public.social_schedules;
    create trigger trg_lito_enqueue_rebuild_cards_social_schedules
      after insert or update of status, scheduled_at
      on public.social_schedules
      for each row
      execute function public.lito_enqueue_rebuild_cards_from_row();
  end if;
end $$;

do $$
begin
  if to_regclass('public.biz_signals') is not null then
    drop trigger if exists trg_lito_enqueue_rebuild_cards_biz_signals on public.biz_signals;
    create trigger trg_lito_enqueue_rebuild_cards_biz_signals
      after insert or update
      on public.biz_signals
      for each row
      execute function public.lito_enqueue_rebuild_cards_from_row();
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
