-- ============================================================
-- Flow D3.2 Cost Guardrails v1
-- - Per-minute org/user rate buckets for LITO endpoints
-- - Daily org cap for orchestrator_safe
-- - Atomic consumption via SECURITY DEFINER RPCs
--
-- Daily cap day boundary uses UTC for consistency across tenants.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Tables
-- ------------------------------------------------------------
create table if not exists public.org_rate_buckets (
  org_id uuid not null references public.organizations(id) on delete cascade,
  bucket_key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (org_id, bucket_key, window_start)
);

create table if not exists public.user_rate_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket_key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, bucket_key, window_start)
);

create table if not exists public.org_daily_caps (
  org_id uuid not null references public.organizations(id) on delete cascade,
  cap_key text not null,
  day date not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (org_id, cap_key, day)
);

create index if not exists org_rate_buckets_updated_at_idx
  on public.org_rate_buckets (updated_at desc);

create index if not exists user_rate_buckets_updated_at_idx
  on public.user_rate_buckets (updated_at desc);

create index if not exists org_daily_caps_updated_at_idx
  on public.org_daily_caps (updated_at desc);

-- ------------------------------------------------------------
-- 2) RLS (direct table access only for service_role)
-- ------------------------------------------------------------
alter table public.org_rate_buckets enable row level security;
alter table public.user_rate_buckets enable row level security;
alter table public.org_daily_caps enable row level security;

drop policy if exists "org_rate_buckets_deny_all" on public.org_rate_buckets;
create policy "org_rate_buckets_deny_all"
  on public.org_rate_buckets
  for all
  using (false)
  with check (false);

drop policy if exists "org_rate_buckets_service_role_all" on public.org_rate_buckets;
create policy "org_rate_buckets_service_role_all"
  on public.org_rate_buckets
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "user_rate_buckets_deny_all" on public.user_rate_buckets;
create policy "user_rate_buckets_deny_all"
  on public.user_rate_buckets
  for all
  using (false)
  with check (false);

drop policy if exists "user_rate_buckets_service_role_all" on public.user_rate_buckets;
create policy "user_rate_buckets_service_role_all"
  on public.user_rate_buckets
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "org_daily_caps_deny_all" on public.org_daily_caps;
create policy "org_daily_caps_deny_all"
  on public.org_daily_caps
  for all
  using (false)
  with check (false);

drop policy if exists "org_daily_caps_service_role_all" on public.org_daily_caps;
create policy "org_daily_caps_service_role_all"
  on public.org_daily_caps
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.org_rate_buckets from anon, authenticated;
revoke all on table public.user_rate_buckets from anon, authenticated;
revoke all on table public.org_daily_caps from anon, authenticated;

grant select, insert, update, delete on table public.org_rate_buckets to service_role;
grant select, insert, update, delete on table public.user_rate_buckets to service_role;
grant select, insert, update, delete on table public.org_daily_caps to service_role;

-- ------------------------------------------------------------
-- 3) RPCs
-- ------------------------------------------------------------
create or replace function public.consume_rate_limit_org(
  p_org_id uuid,
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer default 60
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_now timestamptz := now();
  v_window_seconds integer := greatest(1, least(coalesce(p_window_seconds, 60), 3600));
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_count integer;
begin
  if p_org_id is null or p_bucket_key is null or btrim(p_bucket_key) = '' or p_limit is null or p_limit < 1 then
    return query select false, v_window_seconds;
    return;
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    return query select false, v_window_seconds;
    return;
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = v_user_id
      and m.accepted_at is not null
  ) then
    return query select false, v_window_seconds;
    return;
  end if;

  v_window_start := to_timestamp(floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds);
  v_window_end := v_window_start + make_interval(secs => v_window_seconds);

  insert into public.org_rate_buckets (org_id, bucket_key, window_start, count, updated_at)
  values (p_org_id, btrim(p_bucket_key), v_window_start, 1, v_now)
  on conflict (org_id, bucket_key, window_start)
  do update set
    count = public.org_rate_buckets.count + 1,
    updated_at = excluded.updated_at
  returning count into v_count;

  return query select
    (v_count <= p_limit),
    greatest(1, ceil(extract(epoch from (v_window_end - v_now)))::integer);
end;
$$;

create or replace function public.consume_rate_limit_user(
  p_user_id uuid,
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer default 60
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_auth_user_id uuid;
  v_now timestamptz := now();
  v_window_seconds integer := greatest(1, least(coalesce(p_window_seconds, 60), 3600));
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_count integer;
begin
  if p_user_id is null or p_bucket_key is null or btrim(p_bucket_key) = '' or p_limit is null or p_limit < 1 then
    return query select false, v_window_seconds;
    return;
  end if;

  v_auth_user_id := auth.uid();
  if v_auth_user_id is null or p_user_id <> v_auth_user_id then
    return query select false, v_window_seconds;
    return;
  end if;

  v_window_start := to_timestamp(floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds);
  v_window_end := v_window_start + make_interval(secs => v_window_seconds);

  insert into public.user_rate_buckets (user_id, bucket_key, window_start, count, updated_at)
  values (p_user_id, btrim(p_bucket_key), v_window_start, 1, v_now)
  on conflict (user_id, bucket_key, window_start)
  do update set
    count = public.user_rate_buckets.count + 1,
    updated_at = excluded.updated_at
  returning count into v_count;

  return query select
    (v_count <= p_limit),
    greatest(1, ceil(extract(epoch from (v_window_end - v_now)))::integer);
end;
$$;

create or replace function public.consume_orchestrator_daily_cap(
  p_org_id uuid,
  p_plan_code text,
  p_cap_key text default 'orchestrator_safe'
)
returns table(allowed boolean, resets_at timestamptz, "limit" integer, count integer)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_plan text := lower(btrim(coalesce(p_plan_code, 'starter')));
  v_cap_key text := btrim(coalesce(p_cap_key, 'orchestrator_safe'));
  v_day date := (now() at time zone 'utc')::date;
  v_limit integer;
  v_count integer;
  v_resets_at timestamptz;
begin
  if p_org_id is null or v_cap_key = '' then
    v_resets_at := ((v_day + 1)::timestamp at time zone 'utc');
    return query select false, v_resets_at, 0, 0;
    return;
  end if;

  v_user_id := auth.uid();
  if v_user_id is null then
    v_resets_at := ((v_day + 1)::timestamp at time zone 'utc');
    return query select false, v_resets_at, 0, 0;
    return;
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = v_user_id
      and m.accepted_at is not null
  ) then
    v_resets_at := ((v_day + 1)::timestamp at time zone 'utc');
    return query select false, v_resets_at, 0, 0;
    return;
  end if;

  v_limit := case
    when v_plan in ('scale', 'scale_149', 'pro_149', 'agency', 'enterprise') then 50
    when v_plan in ('business', 'pro', 'pro_49') then 15
    else 5
  end;

  insert into public.org_daily_caps (org_id, cap_key, day, count, updated_at)
  values (p_org_id, v_cap_key, v_day, 1, now())
  on conflict (org_id, cap_key, day)
  do update set
    count = public.org_daily_caps.count + 1,
    updated_at = excluded.updated_at
  returning public.org_daily_caps.count into v_count;

  v_resets_at := ((v_day + 1)::timestamp at time zone 'utc');

  return query select
    (v_count <= v_limit),
    v_resets_at,
    v_limit,
    v_count;
end;
$$;

revoke all on function public.consume_rate_limit_org(uuid, text, integer, integer) from public;
revoke all on function public.consume_rate_limit_user(uuid, text, integer, integer) from public;
revoke all on function public.consume_orchestrator_daily_cap(uuid, text, text) from public;

grant execute on function public.consume_rate_limit_org(uuid, text, integer, integer) to authenticated;
grant execute on function public.consume_rate_limit_org(uuid, text, integer, integer) to service_role;
grant execute on function public.consume_rate_limit_user(uuid, text, integer, integer) to authenticated;
grant execute on function public.consume_rate_limit_user(uuid, text, integer, integer) to service_role;
grant execute on function public.consume_orchestrator_daily_cap(uuid, text, text) to authenticated;
grant execute on function public.consume_orchestrator_daily_cap(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
