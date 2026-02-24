-- ============================================================
-- OpinIA — Model A Strict: user_biz_ids() via explicit assignment only
-- ============================================================
-- PREREQUISITE: phase-s-team-rbac-business-scope.sql must have run
--   (business_memberships table + indexes must exist).
--
-- MODEL A: every user — including owner/admin — needs an explicit
--   is_active=true row in business_memberships to access a business.
--   The owner/admin org-level bypass is removed.
--
-- COL NAME: this file assumes business_memberships.business_id.
--   If your live DB has biz_id, do:
--     sed 's/bm\.business_id/bm.biz_id/g' this-file.sql | psql ...
--   Or verify first with G1-B diagnostic query.
--
-- ORDER OF EXECUTION:
--   1) Verify prerequisite (section 0)
--   2) Backfill (section A) — MUST run before redefining function
--   3) Redefine functions (sections B, C)
--   4) NOTIFY (section D)
--
-- ROLLBACK: see bottom of file (section ROLLBACK)
-- ============================================================

-- ── 0) SAFETY: verify prerequisite ──────────────────────────────────────────
do $$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name   = 'business_memberships'
  ) then
    raise exception
      'business_memberships table not found — run phase-s-team-rbac-business-scope.sql first';
  end if;

  -- Detect real column name (business_id vs biz_id) and raise informative error
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'business_memberships'
      and column_name  = 'business_id'
  ) then
    raise exception
      'Column business_id not found in business_memberships. '
      'Your live table may use biz_id. '
      'Inspect with: SELECT column_name FROM information_schema.columns '
      'WHERE table_name=''business_memberships'' AND table_schema=''public'';';
  end if;
end $$;

-- ── A) BACKFILL (idempotent) ─────────────────────────────────────────────────
-- Inserts one row per (accepted org member × business in that org).
-- ON CONFLICT DO NOTHING: preserves existing role_override customizations.
-- Must run BEFORE redefining user_biz_ids() so no existing session loses access.
insert into public.business_memberships
  (org_id, business_id, user_id, role_override, is_active)
select
  m.org_id,
  b.id   as business_id,
  m.user_id,
  null   as role_override,  -- effective role inherits from memberships.role
  true   as is_active
from public.memberships m
join public.businesses b
  on b.org_id = m.org_id
where m.accepted_at is not null
on conflict (user_id, business_id)
do nothing;
-- NOTE: if you want to reactivate previously deactivated rows, change to:
--   DO UPDATE SET is_active = true
--   (only if you're sure; this reactivates manually-revoked accesses too)

-- ── B) user_biz_ids() — strict assignment only ───────────────────────────────
-- Removes owner/admin org-level bypass. Pure business_memberships lookup.
-- security definer + set search_path prevents search-path injection.
create or replace function public.user_biz_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select bm.business_id
  from public.business_memberships bm
  where bm.user_id  = auth.uid()
    and bm.is_active = true;
$$;

-- ── C) user_biz_ids_with_role(roles[]) — effective role via assignment ────────
-- effective_role = bm.role_override if set, else org membership role.
-- An accepted org membership is required to compute effective role.
-- Used in write-gate RLS policies (manager+, owner/admin only).
create or replace function public.user_biz_ids_with_role(allowed_roles text[])
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select bm.business_id
  from public.business_memberships bm
  join public.memberships m
    on  m.user_id     = bm.user_id
    and m.org_id      = bm.org_id
    and m.accepted_at is not null
  where bm.user_id  = auth.uid()
    and bm.is_active = true
    and coalesce(bm.role_override, m.role::text) = any(allowed_roles);
$$;

-- ── D) Notify PostgREST ───────────────────────────────────────────────────────
notify pgrst, 'reload schema';

-- ============================================================
-- ROLLBACK (paste in SQL editor to revert, no data loss)
-- ============================================================
/*
create or replace function public.user_biz_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  with my_org_role as (
    select m.org_id, m.role::text as role
    from public.memberships m
    where m.user_id = auth.uid() and m.accepted_at is not null
  ),
  admin_org_biz as (
    select b.id
    from public.businesses b
    join my_org_role mor on mor.org_id = b.org_id
    where mor.role in ('owner', 'admin')
  ),
  assigned_biz as (
    select bm.business_id as id
    from public.business_memberships bm
    where bm.user_id = auth.uid() and bm.is_active = true
  )
  select distinct id from admin_org_biz
  union
  select distinct id from assigned_biz;
$$;

create or replace function public.user_biz_ids_with_role(allowed_roles text[])
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  with scoped_org_roles as (
    select m.org_id, m.role::text as role
    from public.memberships m
    where m.user_id = auth.uid()
      and m.accepted_at is not null
      and m.role::text = any(allowed_roles)
  ),
  admin_like_biz as (
    select b.id
    from public.businesses b
    join scoped_org_roles sor on sor.org_id = b.org_id
    where sor.role in ('owner', 'admin')
  ),
  scoped_assignments as (
    select bm.business_id as id
    from public.business_memberships bm
    join scoped_org_roles sor on sor.org_id = bm.org_id
    where bm.user_id = auth.uid() and bm.is_active = true
  )
  select distinct id from admin_like_biz
  union
  select distinct id from scoped_assignments;
$$;

notify pgrst, 'reload schema';
*/
