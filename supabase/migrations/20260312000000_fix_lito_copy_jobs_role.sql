-- Hotfix: member_role typing + lower(enum) cleanup for D1.2/D1.2+
-- - Force public.lito_copy_jobs.role to public.member_role
-- - Remove enum role lower-calls from quota/policy runtime objects

do $$
declare
  v_role_udt text;
begin
  if to_regclass('public.lito_copy_jobs') is null then
    return;
  end if;

  select c.udt_name
    into v_role_udt
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'lito_copy_jobs'
    and c.column_name = 'role'
  limit 1;

  if v_role_udt is null then
    alter table public.lito_copy_jobs
      add column role public.member_role not null default 'staff'::public.member_role;
  else
    alter table public.lito_copy_jobs
      drop constraint if exists lito_copy_jobs_role_check;

    alter table public.lito_copy_jobs
      alter column role drop default;

    update public.lito_copy_jobs
    set role = case
      when role is null then 'staff'
      when role::text in ('owner', 'manager', 'staff') then role::text
      when role::text in ('admin', 'responder') then 'staff'
      else 'staff'
    end;

    if v_role_udt <> 'member_role' then
      alter table public.lito_copy_jobs
        alter column role type public.member_role
        using (
          case
            when role::text = 'owner' then 'owner'::public.member_role
            when role::text = 'manager' then 'manager'::public.member_role
            when role::text = 'staff' then 'staff'::public.member_role
            when role::text in ('admin', 'responder') then 'staff'::public.member_role
            else 'staff'::public.member_role
          end
        );
    end if;

    update public.lito_copy_jobs
    set role = 'staff'::public.member_role
    where role is null;
  end if;

  alter table public.lito_copy_jobs
    alter column role set default 'staff'::public.member_role;

  alter table public.lito_copy_jobs
    alter column role set not null;
end
$$;

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
  v_claim_role text;
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
  v_claim_role := coalesce(current_setting('request.jwt.claim.role', true), '');

  if v_uid is null and v_claim_role <> 'service_role' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'unauthorized',
      'used', 0,
      'limit', 0,
      'remaining', 0
    );
  end if;

  if v_claim_role <> 'service_role' and not exists (
    select 1
    from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = v_uid
      and m.accepted_at is not null
      and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
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
    'used', v_used + v_increment,
    'limit', v_limit,
    'remaining', greatest(v_limit - (v_used + v_increment), 0)
  );
end;
$$;

revoke all on function public.consume_draft_quota(uuid, date, integer) from public;
grant execute on function public.consume_draft_quota(uuid, date, integer) to authenticated;
grant execute on function public.consume_draft_quota(uuid, date, integer) to service_role;

do $$
begin
  if to_regclass('public.lito_copy_jobs') is not null then
    execute 'drop policy if exists "lito_copy_jobs_select_authenticated_scope" on public.lito_copy_jobs';
    execute $policy$
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
              and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
          )
        )
    $policy$;
  end if;

  if to_regclass('public.biz_insights_daily') is not null then
    execute 'drop policy if exists "biz_insights_daily_select_member_scope" on public.biz_insights_daily';
    execute $policy$
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
        )
    $policy$;
  end if;

  if to_regclass('public.recommendation_log') is not null then
    execute 'drop policy if exists "recommendation_log_select_user_biz_scope" on public.recommendation_log';
    execute $policy$
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
        )
    $policy$;

    execute 'drop policy if exists "recommendation_log_update_user_biz_scope" on public.recommendation_log';
    execute $policy$
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
        )
    $policy$;
  end if;
end
$$;

notify pgrst, 'reload schema';
