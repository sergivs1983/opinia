-- Flow D1 + D1.2 (MVP PRO)
-- - Signals-backed weekly recommendations
-- - Deterministic LITO copy payload persistence
-- - Atomic monthly draft quota via RPC
-- - Private recommendation meta table
-- - RLS policies without SRF calls in policy expressions

-- ---------------------------------------------------------------------------
-- recommendation_log extension (D1 + D1.2 payload columns)
-- ---------------------------------------------------------------------------
alter table public.recommendation_log
  add column if not exists format text null,
  add column if not exists source text not null default 'evergreen',
  add column if not exists signal jsonb null,
  add column if not exists steps jsonb null,
  add column if not exists assets_needed text[] null,
  add column if not exists copy_short text null,
  add column if not exists copy_long text null,
  add column if not exists hashtags text[] null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'recommendation_log_format_check'
      and conrelid = 'public.recommendation_log'::regclass
  ) then
    alter table public.recommendation_log
      add constraint recommendation_log_format_check
      check (format is null or format in ('post', 'story', 'reel'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'recommendation_log_source_check'
      and conrelid = 'public.recommendation_log'::regclass
  ) then
    alter table public.recommendation_log
      add constraint recommendation_log_source_check
      check (source in ('evergreen', 'signal'));
  end if;
end $$;

update public.recommendation_log
set source = 'evergreen'
where source is null;

-- ---------------------------------------------------------------------------
-- D1 rollup table
-- ---------------------------------------------------------------------------
create table if not exists public.biz_insights_daily (
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  provider public.integration_provider not null,
  day date not null,
  metrics jsonb not null default '{}'::jsonb,
  categories_summary jsonb not null default '{}'::jsonb,
  keywords_top text[] null,
  lang_dist jsonb not null default '{}'::jsonb,
  dominant_lang text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (biz_id, provider, day)
);

create index if not exists idx_biz_insights_daily_org_day
  on public.biz_insights_daily (org_id, day desc);

create index if not exists idx_biz_insights_daily_biz_day
  on public.biz_insights_daily (biz_id, day desc);

-- ---------------------------------------------------------------------------
-- D1.2 monthly AI draft quotas
-- ---------------------------------------------------------------------------
create table if not exists public.ai_quotas_monthly (
  org_id uuid not null references public.organizations(id) on delete cascade,
  month_start date not null,
  drafts_used integer not null default 0 check (drafts_used >= 0),
  drafts_limit integer not null default 120 check (drafts_limit >= 0),
  updated_at timestamptz not null default now(),
  primary key (org_id, month_start)
);

create index if not exists idx_ai_quotas_monthly_month
  on public.ai_quotas_monthly (month_start desc);

drop function if exists public.consume_draft_quota(uuid, date, integer);

create or replace function public.consume_draft_quota(
  p_org_id uuid,
  p_month_start date default (date_trunc('month', now())::date),
  p_increment integer default 1
)
returns table(allowed boolean, used integer, quota_limit integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_month date;
  v_inc integer;
  v_plan text;
  v_limit integer;
  v_used integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if p_org_id is null then
    raise exception 'org_required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = v_uid
      and m.accepted_at is not null
      and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  v_month := coalesce(p_month_start, date_trunc('month', now())::date);
  v_inc := greatest(coalesce(p_increment, 1), 0);

  select coalesce(
    to_jsonb(o)->>'plan_code',
    to_jsonb(o)->>'plan',
    'starter'
  )
    into v_plan
  from public.organizations o
  where o.id = p_org_id
  limit 1;

  if v_plan is null then
    raise exception 'org_not_found' using errcode = '22023';
  end if;

  v_limit := case
    when lower(v_plan) in ('starter', 'starter_29', 'starter_49') then 120
    when lower(v_plan) in ('pro', 'pro_49') then 400
    when lower(v_plan) in ('scale', 'scale_149', 'pro_149') then 1500
    else 120
  end;

  insert into public.ai_quotas_monthly (org_id, month_start, drafts_used, drafts_limit, updated_at)
  values (p_org_id, v_month, 0, v_limit, now())
  on conflict (org_id, month_start) do nothing;

  select q.drafts_used, q.drafts_limit
    into v_used, v_limit
  from public.ai_quotas_monthly q
  where q.org_id = p_org_id
    and q.month_start = v_month
  for update;

  if v_used + v_inc > v_limit then
    return query
    select false as allowed, v_used as used, v_limit as quota_limit;
    return;
  end if;

  update public.ai_quotas_monthly q
  set drafts_used = v_used + v_inc,
      drafts_limit = v_limit,
      updated_at = now()
  where q.org_id = p_org_id
    and q.month_start = v_month;

  return query
  select true as allowed, (v_used + v_inc) as used, v_limit as quota_limit;
end;
$$;

revoke all on function public.consume_draft_quota(uuid, date, integer) from public;
grant execute on function public.consume_draft_quota(uuid, date, integer) to authenticated;
grant execute on function public.consume_draft_quota(uuid, date, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Private recommendation meta table
-- ---------------------------------------------------------------------------
create table if not exists public.recommendation_log_meta (
  recommendation_id uuid primary key references public.recommendation_log(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  internal_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recommendation_log_meta_org
  on public.recommendation_log_meta (org_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- RLS — no SRF usage inside policy expressions
-- ---------------------------------------------------------------------------
alter table public.biz_insights_daily enable row level security;
alter table public.ai_quotas_monthly enable row level security;
alter table public.recommendation_log_meta enable row level security;
alter table public.recommendation_log enable row level security;

drop policy if exists "biz_insights_daily_select_member_scope" on public.biz_insights_daily;
create policy "biz_insights_daily_select_member_scope"
  on public.biz_insights_daily
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_insights_daily.biz_id
        and bm.org_id = biz_insights_daily.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_insights_daily.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
  );

drop policy if exists "biz_insights_daily_deny_write_authenticated" on public.biz_insights_daily;
create policy "biz_insights_daily_deny_write_authenticated"
  on public.biz_insights_daily
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "biz_insights_daily_service_role_all" on public.biz_insights_daily;
create policy "biz_insights_daily_service_role_all"
  on public.biz_insights_daily
  for all
  to service_role
  using (true)
  with check (true);

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

drop policy if exists "recommendation_log_meta_select_deny_authenticated" on public.recommendation_log_meta;
create policy "recommendation_log_meta_select_deny_authenticated"
  on public.recommendation_log_meta
  for select
  to authenticated
  using (false);

drop policy if exists "recommendation_log_meta_write_deny_authenticated" on public.recommendation_log_meta;
create policy "recommendation_log_meta_write_deny_authenticated"
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

drop policy if exists "recommendation_log_select_user_biz_scope" on public.recommendation_log;
create policy "recommendation_log_select_user_biz_scope"
  on public.recommendation_log
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = recommendation_log.biz_id
        and bm.org_id = recommendation_log.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = recommendation_log.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
  );

drop policy if exists "recommendation_log_update_user_biz_scope" on public.recommendation_log;
create policy "recommendation_log_update_user_biz_scope"
  on public.recommendation_log
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = recommendation_log.biz_id
        and bm.org_id = recommendation_log.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = recommendation_log.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
  )
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = recommendation_log.biz_id
        and bm.org_id = recommendation_log.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = recommendation_log.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
  );

drop policy if exists "recommendation_log_deny_write_authenticated" on public.recommendation_log;
drop policy if exists "recommendation_log_insert_deny_authenticated" on public.recommendation_log;
create policy "recommendation_log_insert_deny_authenticated"
  on public.recommendation_log
  for insert
  to authenticated
  with check (false);

drop policy if exists "recommendation_log_delete_deny_authenticated" on public.recommendation_log;
create policy "recommendation_log_delete_deny_authenticated"
  on public.recommendation_log
  for delete
  to authenticated
  using (false);

notify pgrst, 'reload schema';
