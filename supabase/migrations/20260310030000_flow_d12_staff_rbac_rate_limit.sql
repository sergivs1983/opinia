-- Flow D1.2+ RBAC hardening
-- Staff daily limit + role/user attribution on lito_copy_jobs

create table if not exists public.ai_rate_limits_daily (
  user_id uuid not null,
  day date not null,
  actions_used integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_rate_limits_daily_actions_used_non_negative'
      and conrelid = 'public.ai_rate_limits_daily'::regclass
  ) then
    alter table public.ai_rate_limits_daily
      add constraint ai_rate_limits_daily_actions_used_non_negative
      check (actions_used >= 0);
  end if;
end $$;

alter table public.ai_rate_limits_daily enable row level security;

drop policy if exists "ai_rate_limits_daily_select_self" on public.ai_rate_limits_daily;
create policy "ai_rate_limits_daily_select_self"
  on public.ai_rate_limits_daily
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "ai_rate_limits_daily_deny_write_authenticated" on public.ai_rate_limits_daily;
create policy "ai_rate_limits_daily_deny_write_authenticated"
  on public.ai_rate_limits_daily
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "ai_rate_limits_daily_service_role_all" on public.ai_rate_limits_daily;
create policy "ai_rate_limits_daily_service_role_all"
  on public.ai_rate_limits_daily
  for all
  to service_role
  using (true)
  with check (true);

alter table public.lito_copy_jobs
  add column if not exists user_id uuid null;

alter table public.lito_copy_jobs
  add column if not exists role text null;

update public.lito_copy_jobs
set role = 'responder'
where role is null;

alter table public.lito_copy_jobs
  alter column role set default 'responder';

alter table public.lito_copy_jobs
  alter column role set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lito_copy_jobs_role_check'
      and conrelid = 'public.lito_copy_jobs'::regclass
  ) then
    alter table public.lito_copy_jobs
      add constraint lito_copy_jobs_role_check
      check (lower(role) in ('owner', 'admin', 'manager', 'responder', 'staff'));
  end if;
end $$;

create index if not exists idx_lito_copy_jobs_user_created
  on public.lito_copy_jobs (user_id, created_at desc);

create or replace function public.consume_staff_daily_action(
  p_user_id uuid,
  p_day date default (timezone('utc', now()))::date,
  p_limit integer default 10
)
returns table(allowed boolean, used integer, "limit" integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  insert into public.ai_rate_limits_daily (user_id, day, actions_used, updated_at)
  values (p_user_id, p_day, 0, now())
  on conflict (user_id, day) do nothing;

  select actions_used
  into v_used
  from public.ai_rate_limits_daily
  where user_id = p_user_id
    and day = p_day
  for update;

  if v_used >= p_limit then
    return query select false, v_used, p_limit;
    return;
  end if;

  update public.ai_rate_limits_daily
  set actions_used = v_used + 1,
      updated_at = now()
  where user_id = p_user_id
    and day = p_day;

  return query select true, v_used + 1, p_limit;
end;
$$;

revoke all on function public.consume_staff_daily_action(uuid, date, integer) from public;
grant execute on function public.consume_staff_daily_action(uuid, date, integer) to service_role;

notify pgrst, 'reload schema';
