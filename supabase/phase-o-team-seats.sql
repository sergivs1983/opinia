-- ============================================================
-- OpinIA Phase O — Team seats by organization plan
-- ============================================================
-- Safe / idempotent migration.
-- Adds plan_code + seats_limit model at organization level.

alter table public.organizations
  add column if not exists plan_code text not null default 'starter_49',
  add column if not exists seats_limit integer not null default 3,
  add column if not exists billing_status text not null default 'active',
  add column if not exists plan_price_cents integer;

-- Backfill deterministic plan_code + seats_limit.
-- Current mapping:
--   starter_49 => 3 seats
--   pro_149    => 6 seats
update public.organizations
set
  plan_code = case
    when coalesce(plan_code, '') in ('pro_149') then 'pro_149'
    when coalesce(plan, '') in ('agency', 'enterprise') then 'pro_149'
    else 'starter_49'
  end,
  seats_limit = case
    when coalesce(plan_code, '') = 'pro_149' then 6
    when coalesce(plan, '') in ('agency', 'enterprise') then 6
    when seats_limit is null or seats_limit <= 0 then 3
    else seats_limit
  end,
  plan_price_cents = case
    when coalesce(plan_code, '') = 'pro_149' or coalesce(plan, '') in ('agency', 'enterprise') then 14900
    when plan_price_cents is null then 4900
    else plan_price_cents
  end;

-- Ensure unique membership tuple (user, org) if missing in older envs.
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'memberships'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%(user_id, org_id)%'
  ) and not exists (
    select 1
    from pg_indexes i
    where i.schemaname = 'public'
      and i.tablename = 'memberships'
      and i.indexdef ilike 'create unique index%on public.memberships%'
      and i.indexdef ilike '%(user_id, org_id)%'
  ) then
    create unique index ux_memberships_user_org_seats
      on public.memberships(user_id, org_id);
  end if;
end $$;

-- Ensure only one default membership per user.
do $$
begin
  if not exists (
    select 1
    from pg_indexes i
    where i.schemaname = 'public'
      and i.tablename = 'memberships'
      and i.indexdef ilike 'create unique index%on public.memberships%'
      and i.indexdef ilike '%(user_id)%'
      and i.indexdef ilike '%where (is_default = true)%'
  ) then
    create unique index ux_memberships_one_default_per_user_seats
      on public.memberships(user_id)
      where is_default = true;
  end if;
end $$;

alter table public.organizations enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'organizations'
      and policyname = 'org_select_active_membership_seats'
  ) then
    create policy "org_select_active_membership_seats"
      on public.organizations
      for select
      using (
        exists (
          select 1
          from public.memberships m
          where m.org_id = id
            and m.user_id = auth.uid()
            and m.accepted_at is not null
        )
      );
  end if;
end $$;

select pg_notify('pgrst', 'reload schema');
