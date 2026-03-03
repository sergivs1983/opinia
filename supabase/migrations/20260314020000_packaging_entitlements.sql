begin;

do $$
begin
  if to_regclass('public.organizations') is null then
    raise notice 'Table public.organizations not found - skipping packaging entitlements migration';
    return;
  end if;

  alter table public.organizations
    add column if not exists plan_code text,
    add column if not exists lito_staff_ai_paused boolean not null default false;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.organizations'::regclass
      and conname = 'organizations_plan_code_check'
  ) then
    alter table public.organizations drop constraint organizations_plan_code_check;
  end if;

  alter table public.organizations
    add constraint organizations_plan_code_check
    check (
      plan_code is null
      or plan_code in (
        'starter',
        'business',
        'scale',
        'enterprise',
        'starter_29',
        'starter_49',
        'pro',
        'pro_49',
        'pro_149',
        'scale_149'
      )
    );

  create table if not exists public.org_entitlements (
    org_id uuid primary key references public.organizations(id) on delete cascade,
    locations_limit integer not null default 1,
    seats_limit integer not null default 1,
    lito_drafts_limit integer not null default 15,
    signals_level text not null default 'basic',
    staff_daily_limit integer not null default 10,
    staff_monthly_ratio_cap numeric(5,2) not null default 0.30,
    updated_at timestamptz not null default now()
  );

  alter table public.org_entitlements
    add column if not exists locations_limit integer not null default 1,
    add column if not exists seats_limit integer not null default 1,
    add column if not exists lito_drafts_limit integer not null default 15,
    add column if not exists signals_level text not null default 'basic',
    add column if not exists staff_daily_limit integer not null default 10,
    add column if not exists staff_monthly_ratio_cap numeric(5,2) not null default 0.30,
    add column if not exists updated_at timestamptz not null default now();

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.org_entitlements'::regclass
      and conname = 'org_entitlements_signals_level_check'
  ) then
    alter table public.org_entitlements
      add constraint org_entitlements_signals_level_check
      check (signals_level in ('basic', 'advanced', 'full'));
  end if;

  insert into public.org_entitlements (
    org_id,
    locations_limit,
    seats_limit,
    lito_drafts_limit,
    signals_level,
    staff_daily_limit,
    staff_monthly_ratio_cap,
    updated_at
  )
  select
    o.id as org_id,
    case
      when lower(coalesce(nullif(o.plan_code, ''), nullif(o.plan, ''), 'starter')) in ('scale', 'scale_149', 'pro_149') then 15
      when lower(coalesce(nullif(o.plan_code, ''), nullif(o.plan, ''), 'starter')) in ('business', 'pro', 'pro_49') then 5
      else 1
    end as locations_limit,
    case
      when lower(coalesce(nullif(o.plan_code, ''), nullif(o.plan, ''), 'starter')) in ('scale', 'scale_149', 'pro_149') then 9999
      when lower(coalesce(nullif(o.plan_code, ''), nullif(o.plan, ''), 'starter')) in ('business', 'pro', 'pro_49') then 3
      else 1
    end as seats_limit,
    case
      when lower(coalesce(nullif(o.plan_code, ''), nullif(o.plan, ''), 'starter')) in ('scale', 'scale_149', 'pro_149') then 1000
      when lower(coalesce(nullif(o.plan_code, ''), nullif(o.plan, ''), 'starter')) in ('business', 'pro', 'pro_49') then 150
      else 15
    end as lito_drafts_limit,
    case
      when lower(coalesce(nullif(o.plan_code, ''), nullif(o.plan, ''), 'starter')) in ('scale', 'scale_149', 'pro_149') then 'full'
      when lower(coalesce(nullif(o.plan_code, ''), nullif(o.plan, ''), 'starter')) in ('business', 'pro', 'pro_49') then 'advanced'
      else 'basic'
    end as signals_level,
    10 as staff_daily_limit,
    0.30 as staff_monthly_ratio_cap,
    now() as updated_at
  from public.organizations o
  on conflict (org_id) do update
  set
    locations_limit = excluded.locations_limit,
    seats_limit = excluded.seats_limit,
    lito_drafts_limit = excluded.lito_drafts_limit,
    signals_level = excluded.signals_level,
    staff_daily_limit = excluded.staff_daily_limit,
    staff_monthly_ratio_cap = excluded.staff_monthly_ratio_cap,
    updated_at = excluded.updated_at;
end
$$;

do $$
begin
  if to_regclass('public.org_entitlements') is null then
    raise notice 'Table public.org_entitlements not found - skipping RLS/policies';
  else
    alter table public.org_entitlements enable row level security;

    if to_regclass('public.memberships') is not null then
      drop policy if exists org_entitlements_select_member on public.org_entitlements;
      create policy org_entitlements_select_member
        on public.org_entitlements
        for select
        to authenticated
        using (
          exists (
            select 1
            from public.memberships m
            where m.org_id = org_entitlements.org_id
              and m.user_id = auth.uid()
              and m.accepted_at is not null
          )
        );
    else
      raise notice 'Table public.memberships not found - skipping org_entitlements_select_member policy';
    end if;

    drop policy if exists org_entitlements_service_role_all on public.org_entitlements;
    create policy org_entitlements_service_role_all
      on public.org_entitlements
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
