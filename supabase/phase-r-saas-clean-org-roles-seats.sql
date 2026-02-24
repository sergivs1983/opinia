-- ============================================================
-- OpinIA Phase R — SaaS-clean org/workspace roles + seats
-- ============================================================
-- Goals:
-- 1) Deterministic active workspace (single default membership per user)
-- 2) Role model: owner/admin/manager/responder (legacy staff -> responder)
-- 3) Seat plan metadata at organization level
-- 4) Minimal RLS tightening for team/business/integrations management
--
-- SAFE / IDEMPOTENT
-- - UPDATE-only data normalization (no DELETE)
-- - Additive columns/constraints/indexes
-- - Policy replacement only where explicitly managed below
-- ============================================================

-- ------------------------------------------------------------
-- A) ORGANIZATION PLAN/SEATS METADATA
-- ------------------------------------------------------------
alter table public.organizations
  add column if not exists plan_tier text,
  add column if not exists max_seats integer,
  add column if not exists owner_user_id uuid;

-- Optional FK (owner reference)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organizations_owner_user_id_fkey'
  ) then
    alter table public.organizations
      add constraint organizations_owner_user_id_fkey
      foreign key (owner_user_id) references auth.users(id)
      on delete set null;
  end if;
end $$;

-- Ensure plan_tier constraint exists
alter table public.organizations drop constraint if exists organizations_plan_tier_check;
alter table public.organizations
  add constraint organizations_plan_tier_check
  check (plan_tier in ('starter', 'pro'));

-- Backfill deterministic plan tier + seats
update public.organizations
set plan_tier = case
  when coalesce(plan_code, '') = 'pro_149' then 'pro'
  when coalesce(plan, '') in ('pro', 'agency', 'enterprise') then 'pro'
  else 'starter'
end
where plan_tier is null or plan_tier not in ('starter', 'pro');

update public.organizations
set max_seats = case
  when plan_tier = 'pro' then 6
  else 3
end
where max_seats is null or max_seats <= 0;

-- Keep existing seats_limit as source-of-truth if already present,
-- otherwise sync it from max_seats.
update public.organizations
set seats_limit = max_seats
where (seats_limit is null or seats_limit <= 0)
  and max_seats is not null;

-- Backfill owner_user_id from accepted owner membership when missing
update public.organizations o
set owner_user_id = m.user_id
from (
  select distinct on (org_id)
    org_id,
    user_id
  from public.memberships
  where accepted_at is not null
    and role::text = 'owner'
  order by org_id, created_at asc nulls last, id asc
) m
where o.id = m.org_id
  and o.owner_user_id is null;

-- ------------------------------------------------------------
-- B) ROLE MODEL NORMALIZATION
-- ------------------------------------------------------------
-- Add new enum values when memberships.role uses enum public.member_role.
do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'member_role'
  ) then
    begin
      alter type public.member_role add value if not exists 'admin';
    exception when others then
      null;
    end;

    begin
      alter type public.member_role add value if not exists 'responder';
    exception when others then
      null;
    end;
  end if;
end $$;

-- Legacy mapping: staff -> responder
update public.memberships
set role = 'responder'
where role::text = 'staff';

-- If role is a text/varchar column, enforce allowed set via CHECK.
do $$
declare
  _udt text;
begin
  select c.udt_name
    into _udt
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'memberships'
    and c.column_name = 'role';

  if _udt in ('text', 'varchar', 'bpchar') then
    alter table public.memberships drop constraint if exists memberships_role_check;
    alter table public.memberships
      add constraint memberships_role_check
      check (role in ('owner', 'admin', 'manager', 'responder'));
  end if;
end $$;

-- ------------------------------------------------------------
-- C) DATA FIX: ONE DEFAULT WORKSPACE PER USER
-- ------------------------------------------------------------
-- Keep exactly one default=true per user (prefer most recent created_at)
with ranked_defaults as (
  select
    id,
    user_id,
    row_number() over (
      partition by user_id
      order by created_at desc nulls last, id desc
    ) as rn
  from public.memberships
  where is_default = true
)
update public.memberships m
set is_default = false
from ranked_defaults d
where m.id = d.id
  and d.rn > 1;

-- Users with accepted memberships and no default -> set most recent accepted
with users_without_default as (
  select m.user_id
  from public.memberships m
  group by m.user_id
  having count(*) filter (where m.accepted_at is not null) > 0
     and count(*) filter (where m.is_default = true) = 0
), ranked_active as (
  select
    m.id,
    m.user_id,
    row_number() over (
      partition by m.user_id
      order by m.created_at desc nulls last, m.id desc
    ) as rn
  from public.memberships m
  join users_without_default u
    on u.user_id = m.user_id
  where m.accepted_at is not null
)
update public.memberships m
set is_default = true
from ranked_active ra
where m.id = ra.id
  and ra.rn = 1;

-- ------------------------------------------------------------
-- D) INTEGRITY INDEXES
-- ------------------------------------------------------------
create unique index if not exists ux_memberships_user_org
  on public.memberships(user_id, org_id);

create unique index if not exists ux_memberships_one_default_per_user
  on public.memberships(user_id)
  where is_default = true;

-- ------------------------------------------------------------
-- E) RLS (minimal, explicit role-based management)
-- ------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.businesses enable row level security;
alter table public.integrations enable row level security;

-- Organizations visibility by active membership
-- (drop legacy duplicates to avoid policy drift)
drop policy if exists org_select on public.organizations;
drop policy if exists org_select_active_membership on public.organizations;
drop policy if exists org_select_active_membership_seats on public.organizations;

create policy "org_select_membership_active"
  on public.organizations
  for select
  using (
    exists (
      select 1
      from public.memberships m
      where m.org_id = public.organizations.id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

-- Membership policies
-- Replaced to enforce owner/admin management (manager no team-admin)
drop policy if exists members_insert on public.memberships;
drop policy if exists members_update on public.memberships;
drop policy if exists members_delete on public.memberships;

create policy "members_insert_owner_admin"
  on public.memberships
  for insert
  with check (
    exists (
      select 1
      from public.memberships own
      where own.org_id = public.memberships.org_id
        and own.user_id = auth.uid()
        and own.accepted_at is not null
        and own.role::text in ('owner', 'admin')
    )
  );

create policy "members_update_owner_admin"
  on public.memberships
  for update
  using (
    exists (
      select 1
      from public.memberships own
      where own.org_id = public.memberships.org_id
        and own.user_id = auth.uid()
        and own.accepted_at is not null
        and own.role::text in ('owner', 'admin')
    )
  );

create policy "members_delete_owner_admin_or_self"
  on public.memberships
  for delete
  using (
    public.memberships.user_id = auth.uid()
    or exists (
      select 1
      from public.memberships own
      where own.org_id = public.memberships.org_id
        and own.user_id = auth.uid()
        and own.accepted_at is not null
        and own.role::text in ('owner', 'admin')
    )
  );

-- Business management by owner/admin
-- (manager/responder are execution roles, not config roles)
drop policy if exists biz_insert on public.businesses;
drop policy if exists biz_update on public.businesses;

create policy "biz_insert_owner_admin"
  on public.businesses
  for insert
  with check (
    exists (
      select 1
      from public.memberships m
      where m.org_id = public.businesses.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role::text in ('owner', 'admin')
    )
  );

create policy "biz_update_owner_admin"
  on public.businesses
  for update
  using (
    exists (
      select 1
      from public.memberships m
      where m.org_id = public.businesses.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role::text in ('owner', 'admin')
    )
  );

-- Integrations management by owner/admin
drop policy if exists integrations_insert on public.integrations;
drop policy if exists integrations_update on public.integrations;

create policy "integrations_insert_owner_admin"
  on public.integrations
  for insert
  with check (
    exists (
      select 1
      from public.memberships m
      where m.org_id = public.integrations.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role::text in ('owner', 'admin')
    )
  );

create policy "integrations_update_owner_admin"
  on public.integrations
  for update
  using (
    exists (
      select 1
      from public.memberships m
      where m.org_id = public.integrations.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role::text in ('owner', 'admin')
    )
  );

-- Refresh PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
