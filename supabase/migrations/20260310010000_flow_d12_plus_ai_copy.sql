-- Flow D1.2+ (MVP PRO)
-- - recommendation_log copy payload fields
-- - atomic quota RPC contract (json response)
-- - private recommendation metadata table

-- ---------------------------------------------------------------------------
-- recommendation_log generated_copy -> jsonb (schema-safe conversion)
-- ---------------------------------------------------------------------------
create or replace function public._opinia_try_parse_jsonb(input text)
returns jsonb
language plpgsql
immutable
as $$
begin
  if input is null or btrim(input) = '' then
    return null;
  end if;
  begin
    return input::jsonb;
  exception
    when others then
      return jsonb_build_object('legacy_text', input);
  end;
end;
$$;

do $$
declare
  v_data_type text;
begin
  select c.data_type
    into v_data_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'recommendation_log'
    and c.column_name = 'generated_copy';

  if v_data_type is null then
    alter table public.recommendation_log
      add column generated_copy jsonb null;
  elsif v_data_type in ('text', 'character varying') then
    alter table public.recommendation_log
      alter column generated_copy type jsonb
      using public._opinia_try_parse_jsonb(generated_copy);
  end if;
end $$;

drop function if exists public._opinia_try_parse_jsonb(text);

alter table public.recommendation_log
  add column if not exists generated_copy_updated_at timestamptz null,
  add column if not exists last_action_at timestamptz null,
  add column if not exists generated_copy_status text not null default 'none';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'recommendation_log_generated_copy_status_check'
      and conrelid = 'public.recommendation_log'::regclass
  ) then
    alter table public.recommendation_log
      add constraint recommendation_log_generated_copy_status_check
      check (generated_copy_status in ('none', 'generated', 'refined'));
  end if;
end $$;

update public.recommendation_log
set generated_copy_status = 'none'
where generated_copy_status is null;

-- ---------------------------------------------------------------------------
-- AI monthly quota table (idempotent)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_quotas_monthly (
  org_id uuid not null references public.organizations(id) on delete cascade,
  month_start date not null,
  drafts_limit integer not null default 120 check (drafts_limit >= 0),
  drafts_used integer not null default 0 check (drafts_used >= 0),
  updated_at timestamptz not null default now(),
  primary key (org_id, month_start)
);

create index if not exists idx_ai_quotas_monthly_month_start
  on public.ai_quotas_monthly (month_start desc);

-- ---------------------------------------------------------------------------
-- Atomic quota consume RPC (json contract)
-- ---------------------------------------------------------------------------
drop function if exists public.consume_draft_quota(uuid, date, integer);

create or replace function public.consume_draft_quota(
  p_org_id uuid,
  p_month_start date default (date_trunc('month', now())::date),
  p_increment integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
  v_month date;
  v_increment integer;
  v_plan text;
  v_limit integer;
  v_used integer;
begin
  if p_org_id is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'org_required',
      'used', 0,
      'limit', 0,
      'remaining', 0
    );
  end if;

  v_uid := auth.uid();
  v_role := lower(coalesce(current_setting('request.jwt.claim.role', true), ''));

  if v_uid is null and v_role <> 'service_role' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'unauthorized',
      'used', 0,
      'limit', 0,
      'remaining', 0
    );
  end if;

  if v_role <> 'service_role' and not exists (
    select 1
    from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = v_uid
      and m.accepted_at is not null
  ) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'not_allowed',
      'used', 0,
      'limit', 0,
      'remaining', 0
    );
  end if;

  select lower(coalesce(nullif(o.plan_code, ''), nullif(o.plan, ''), 'starter'))
    into v_plan
  from public.organizations o
  where o.id = p_org_id
  limit 1;

  if v_plan is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'org_not_found',
      'used', 0,
      'limit', 0,
      'remaining', 0
    );
  end if;

  v_limit := case
    when v_plan in ('starter', 'starter_29', 'starter_49', 'basic', '29') then 120
    when v_plan in ('pro', 'pro_49', '49') then 400
    when v_plan in ('scale', 'scale_149', 'pro_149', '149') then 1500
    else 120
  end;

  v_month := coalesce(p_month_start, date_trunc('month', now())::date);
  v_increment := greatest(coalesce(p_increment, 1), 0);

  insert into public.ai_quotas_monthly (org_id, month_start, drafts_limit, drafts_used, updated_at)
  values (p_org_id, v_month, v_limit, 0, now())
  on conflict (org_id, month_start) do nothing;

  select q.drafts_used, q.drafts_limit
    into v_used, v_limit
  from public.ai_quotas_monthly q
  where q.org_id = p_org_id
    and q.month_start = v_month
  for update;

  if v_used + v_increment > v_limit then
    return jsonb_build_object(
      'ok', false,
      'reason', 'quota_exceeded',
      'used', v_used,
      'limit', v_limit,
      'remaining', greatest(v_limit - v_used, 0)
    );
  end if;

  update public.ai_quotas_monthly q
  set drafts_used = v_used + v_increment,
      drafts_limit = v_limit,
      updated_at = now()
  where q.org_id = p_org_id
    and q.month_start = v_month;

  return jsonb_build_object(
    'ok', true,
    'reason', null,
    'used', v_used + v_increment,
    'limit', v_limit,
    'remaining', greatest(v_limit - (v_used + v_increment), 0)
  );
end;
$$;

revoke all on function public.consume_draft_quota(uuid, date, integer) from public;
grant execute on function public.consume_draft_quota(uuid, date, integer) to authenticated;
grant execute on function public.consume_draft_quota(uuid, date, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Private recommendation metadata (service role only)
-- ---------------------------------------------------------------------------
create table if not exists public.recommendation_log_meta (
  recommendation_id uuid primary key references public.recommendation_log(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  internal_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recommendation_log_meta_org_updated
  on public.recommendation_log_meta (org_id, updated_at desc);

alter table public.ai_quotas_monthly enable row level security;
alter table public.recommendation_log_meta enable row level security;

drop policy if exists "ai_quotas_monthly_select_member_scope" on public.ai_quotas_monthly;
create policy "ai_quotas_monthly_select_member_scope"
  on public.ai_quotas_monthly
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.org_id = ai_quotas_monthly.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

drop policy if exists "ai_quotas_monthly_deny_write_authenticated" on public.ai_quotas_monthly;
create policy "ai_quotas_monthly_deny_write_authenticated"
  on public.ai_quotas_monthly
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "ai_quotas_monthly_service_role_all" on public.ai_quotas_monthly;
create policy "ai_quotas_monthly_service_role_all"
  on public.ai_quotas_monthly
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "recommendation_log_meta_deny_authenticated" on public.recommendation_log_meta;
create policy "recommendation_log_meta_deny_authenticated"
  on public.recommendation_log_meta
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "recommendation_log_meta_service_role_all" on public.recommendation_log_meta;
create policy "recommendation_log_meta_service_role_all"
  on public.recommendation_log_meta
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';
