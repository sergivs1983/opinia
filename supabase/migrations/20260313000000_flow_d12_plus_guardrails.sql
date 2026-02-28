-- Flow D1.2+ hardening (idempotent)
-- - org-level AI provider + staff panic toggle
-- - staff daily usage table
-- - atomic RPC guards for staff + org quota wrapper

alter table public.organizations
  add column if not exists ai_provider text;

update public.organizations
set ai_provider = 'auto'
where ai_provider is null or btrim(ai_provider) = '';

alter table public.organizations
  alter column ai_provider set default 'auto';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organizations_ai_provider_check'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_ai_provider_check
      check (ai_provider in ('auto', 'openai', 'anthropic'));
  end if;
end $$;

alter table public.organizations
  add column if not exists lito_staff_ai_paused boolean not null default false;

create table if not exists public.lito_user_daily_usage (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  used integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id, day)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lito_user_daily_usage_used_non_negative'
      and conrelid = 'public.lito_user_daily_usage'::regclass
  ) then
    alter table public.lito_user_daily_usage
      add constraint lito_user_daily_usage_used_non_negative
      check (used >= 0);
  end if;
end $$;

create index if not exists idx_lito_user_daily_usage_day
  on public.lito_user_daily_usage (org_id, day desc);

alter table public.lito_user_daily_usage enable row level security;

drop policy if exists "lito_user_daily_usage_select_self" on public.lito_user_daily_usage;
create policy "lito_user_daily_usage_select_self"
  on public.lito_user_daily_usage
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.memberships m
      where m.org_id = lito_user_daily_usage.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

drop policy if exists "lito_user_daily_usage_deny_write_authenticated" on public.lito_user_daily_usage;
create policy "lito_user_daily_usage_deny_write_authenticated"
  on public.lito_user_daily_usage
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "lito_user_daily_usage_service_role_all" on public.lito_user_daily_usage;
create policy "lito_user_daily_usage_service_role_all"
  on public.lito_user_daily_usage
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.consume_staff_daily(
  p_org_id uuid,
  p_user_id uuid,
  p_day date default (timezone('utc', now()))::date,
  p_inc integer default 1,
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_used integer;
  v_inc integer;
  v_limit integer;
begin
  if p_org_id is null or p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input', 'used', 0, 'limit', 0, 'remaining', 0);
  end if;

  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized', 'used', 0, 'limit', 0, 'remaining', 0);
  end if;

  if p_user_id <> v_uid then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed', 'used', 0, 'limit', 0, 'remaining', 0);
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = v_uid
      and m.accepted_at is not null
      and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed', 'used', 0, 'limit', 0, 'remaining', 0);
  end if;

  v_inc := greatest(coalesce(p_inc, 1), 1);
  v_limit := greatest(coalesce(p_limit, 10), 1);

  insert into public.lito_user_daily_usage (org_id, user_id, day, used, updated_at)
  values (p_org_id, p_user_id, coalesce(p_day, (timezone('utc', now()))::date), 0, now())
  on conflict (org_id, user_id, day) do nothing;

  select used
    into v_used
  from public.lito_user_daily_usage
  where org_id = p_org_id
    and user_id = p_user_id
    and day = coalesce(p_day, (timezone('utc', now()))::date)
  for update;

  if v_used + v_inc > v_limit then
    return jsonb_build_object(
      'ok', false,
      'reason', 'staff_daily_limit',
      'used', v_used,
      'limit', v_limit,
      'remaining', greatest(v_limit - v_used, 0)
    );
  end if;

  update public.lito_user_daily_usage
  set used = v_used + v_inc,
      updated_at = now()
  where org_id = p_org_id
    and user_id = p_user_id
    and day = coalesce(p_day, (timezone('utc', now()))::date);

  return jsonb_build_object(
    'ok', true,
    'reason', null,
    'used', v_used + v_inc,
    'limit', v_limit,
    'remaining', greatest(v_limit - (v_used + v_inc), 0)
  );
end;
$$;

revoke all on function public.consume_staff_daily(uuid, uuid, date, integer, integer) from public;
grant execute on function public.consume_staff_daily(uuid, uuid, date, integer, integer) to authenticated;
grant execute on function public.consume_staff_daily(uuid, uuid, date, integer, integer) to service_role;

create or replace function public.enforce_staff_monthly_cap(
  p_org_id uuid,
  p_inc integer default 1,
  p_cap_ratio numeric default 0.30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_month_start date;
  v_month_end date;
  v_staff_used integer;
  v_org_limit integer;
  v_cap_limit integer;
  v_plan text;
  v_inc integer;
begin
  if p_org_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input', 'used', 0, 'limit', 0, 'remaining', 0);
  end if;

  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized', 'used', 0, 'limit', 0, 'remaining', 0);
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = v_uid
      and m.accepted_at is not null
      and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed', 'used', 0, 'limit', 0, 'remaining', 0);
  end if;

  v_month_start := date_trunc('month', timezone('utc', now()))::date;
  v_month_end := (v_month_start + interval '1 month')::date;
  v_inc := greatest(coalesce(p_inc, 1), 1);

  select coalesce(sum(du.used), 0)
    into v_staff_used
  from public.lito_user_daily_usage du
  where du.org_id = p_org_id
    and du.day >= v_month_start
    and du.day < v_month_end;

  select q.drafts_limit
    into v_org_limit
  from public.ai_quotas_monthly q
  where q.org_id = p_org_id
    and q.month_start = v_month_start
  limit 1;

  if v_org_limit is null then
    select lower(coalesce(nullif(o.plan_code, ''), nullif(o.plan, ''), 'starter'))
      into v_plan
    from public.organizations o
    where o.id = p_org_id
    limit 1;

    v_org_limit := case
      when v_plan in ('starter', 'starter_29', 'starter_49', 'basic', '29') then 120
      when v_plan in ('pro', 'pro_49', '49') then 400
      when v_plan in ('scale', 'scale_149', 'pro_149', '149') then 1500
      else 120
    end;
  end if;

  v_cap_limit := floor(v_org_limit * greatest(coalesce(p_cap_ratio, 0.30), 0))::integer;

  if v_staff_used + v_inc > v_cap_limit then
    return jsonb_build_object(
      'ok', false,
      'reason', 'staff_monthly_cap',
      'used', v_staff_used,
      'limit', v_cap_limit,
      'remaining', greatest(v_cap_limit - v_staff_used, 0)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', null,
    'used', v_staff_used + v_inc,
    'limit', v_cap_limit,
    'remaining', greatest(v_cap_limit - (v_staff_used + v_inc), 0)
  );
end;
$$;

revoke all on function public.enforce_staff_monthly_cap(uuid, integer, numeric) from public;
grant execute on function public.enforce_staff_monthly_cap(uuid, integer, numeric) to authenticated;
grant execute on function public.enforce_staff_monthly_cap(uuid, integer, numeric) to service_role;

create or replace function public.consume_org_quota(
  p_org_id uuid,
  p_inc integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.consume_draft_quota(
    p_org_id,
    date_trunc('month', timezone('utc', now()))::date,
    greatest(coalesce(p_inc, 1), 1)
  );
end;
$$;

revoke all on function public.consume_org_quota(uuid, integer) from public;
grant execute on function public.consume_org_quota(uuid, integer) to authenticated;
grant execute on function public.consume_org_quota(uuid, integer) to service_role;

notify pgrst, 'reload schema';
