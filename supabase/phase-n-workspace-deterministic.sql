-- ============================================================
-- OpinIA Phase N — SaaS-clean workspace defaults
-- Fixes ambiguous active workspace selection caused by
-- multiple memberships marked as is_default=true.
--
-- SAFE / IDEMPOTENT:
-- - UPDATE only for conflicting defaults
-- - no DELETE / no destructive schema changes
-- ============================================================

-- 1) DATA FIX
-- Keep EXACTLY one default membership per user.
-- Rule: keep the oldest default by created_at ASC (fallback id ASC).
with ranked_defaults as (
  select
    id,
    user_id,
    row_number() over (
      partition by user_id
      order by created_at asc nulls last, id asc
    ) as rn
  from public.memberships
  where is_default = true
)
update public.memberships m
set is_default = false
from ranked_defaults rd
where m.id = rd.id
  and rd.rn > 1;


-- 2) UNIQUE GUARD: (user_id, org_id)
-- Some environments already have a UNIQUE constraint for this.
-- Create a unique index only when neither a UNIQUE constraint nor
-- an equivalent unique index exists.
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
    create unique index ux_memberships_user_org
      on public.memberships(user_id, org_id);
  end if;
end $$;


-- 3) UNIQUE GUARD: one default org per user
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
    create unique index ux_memberships_one_default_per_user
      on public.memberships(user_id)
      where is_default = true;
  end if;
end $$;


-- 4) RLS hardening for organizations SELECT
alter table public.organizations enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'organizations'
      and policyname = 'org_select_active_membership'
  ) then
    create policy "org_select_active_membership"
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

-- 5) Refresh PostgREST schema cache
select pg_notify('pgrst', 'reload schema');

