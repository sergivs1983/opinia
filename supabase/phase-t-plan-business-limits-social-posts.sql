-- ============================================================
-- OpinIA Phase T — Plan limits (seats + businesses) + Social posts RBAC
-- ============================================================
-- SAFE / IDEMPOTENT
-- - Additive schema only
-- - UPDATE-only normalization
-- - No destructive deletes
-- ============================================================

-- ------------------------------------------------------------
-- A) Organization plan limits (Starter: 2/3, Pro: 6/10)
-- ------------------------------------------------------------
alter table public.organizations
  add column if not exists plan_code text not null default 'starter_49',
  add column if not exists seats_limit integer not null default 2,
  add column if not exists business_limit integer not null default 3;

alter table public.organizations alter column seats_limit set default 2;
alter table public.organizations alter column business_limit set default 3;

alter table public.organizations drop constraint if exists organizations_plan_code_check;
alter table public.organizations
  add constraint organizations_plan_code_check
  check (plan_code in ('starter_49', 'pro_149'));

alter table public.organizations drop constraint if exists organizations_seats_limit_positive_check;
alter table public.organizations
  add constraint organizations_seats_limit_positive_check
  check (seats_limit > 0);

alter table public.organizations drop constraint if exists organizations_business_limit_positive_check;
alter table public.organizations
  add constraint organizations_business_limit_positive_check
  check (business_limit > 0);

update public.organizations
set
  plan_code = case
    when coalesce(plan_code, '') = 'pro_149' then 'pro_149'
    when coalesce(plan_tier, '') = 'pro' then 'pro_149'
    when coalesce(plan, '') in ('pro', 'agency', 'enterprise') then 'pro_149'
    else 'starter_49'
  end;

update public.organizations
set
  seats_limit = case
    when plan_code = 'pro_149' then 6
    else 2
  end,
  business_limit = case
    when plan_code = 'pro_149' then 10
    else 3
  end;

-- Keep legacy columns in sync where present.
update public.organizations
set max_businesses = business_limit
where coalesce(max_businesses, -1) <> business_limit;

update public.organizations
set max_team_members = seats_limit
where coalesce(max_team_members, -1) <> seats_limit;

-- ------------------------------------------------------------
-- B) Membership integrity + one default
-- ------------------------------------------------------------
create unique index if not exists ux_memberships_user_org_phase_t
  on public.memberships(user_id, org_id);

create unique index if not exists ux_memberships_one_default_per_user_phase_t
  on public.memberships(user_id)
  where is_default = true;

-- Keep exactly one default=true per user (deterministic)
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
from ranked_defaults rd
where m.id = rd.id
  and rd.rn > 1;

-- Guarantee users with accepted memberships have one default.
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
      order by m.created_at asc nulls last, m.id asc
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
-- C) Role enforcement by plan (Starter forbids ADMIN)
-- ------------------------------------------------------------
-- Normalize existing starter admins to manager.
update public.memberships m
set role = 'manager'
from public.organizations o
where m.org_id = o.id
  and o.plan_code = 'starter_49'
  and m.role::text = 'admin';

create or replace function public.enforce_membership_role_for_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org_plan text;
  role_text text;
begin
  select o.plan_code into org_plan
  from public.organizations o
  where o.id = new.org_id;

  role_text := lower(coalesce(new.role::text, ''));

  if coalesce(org_plan, 'starter_49') = 'starter_49' and role_text = 'admin' then
    raise exception using
      errcode = '23514',
      message = 'role_admin_requires_pro_plan';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_membership_role_for_plan on public.memberships;
create trigger trg_enforce_membership_role_for_plan
before insert or update of role, org_id
on public.memberships
for each row execute function public.enforce_membership_role_for_plan();

-- ------------------------------------------------------------
-- D) Social posts table (role-aware publishing)
-- ------------------------------------------------------------
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'published', 'scheduled')),
  published_by uuid null references auth.users(id) on delete set null,
  caption text null,
  payload jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_social_posts_org_created
  on public.social_posts(org_id, created_at desc);

create index if not exists idx_social_posts_business_status
  on public.social_posts(business_id, status);

create or replace function public.enforce_social_post_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  business_org_id uuid;
begin
  select b.org_id into business_org_id
  from public.businesses b
  where b.id = new.business_id;

  if business_org_id is null then
    raise exception using errcode = '23503', message = 'social_post_business_not_found';
  end if;

  if new.org_id is null then
    new.org_id := business_org_id;
  end if;

  if new.org_id <> business_org_id then
    raise exception using errcode = '23514', message = 'social_post_org_mismatch';
  end if;

  if new.status in ('published', 'scheduled') and new.published_by is null then
    new.published_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_social_posts_scope on public.social_posts;
create trigger trg_social_posts_scope
before insert or update on public.social_posts
for each row execute function public.enforce_social_post_scope();

do $$
begin
  if exists (
    select 1 from pg_proc where proname = 'trg_set_updated_at'
  ) then
    if not exists (
      select 1 from pg_trigger where tgname = 'trg_social_posts_updated_at'
    ) then
      create trigger trg_social_posts_updated_at
      before update on public.social_posts
      for each row execute function public.trg_set_updated_at();
    end if;
  end if;
end $$;

alter table public.social_posts enable row level security;

drop policy if exists social_posts_select_scope on public.social_posts;
drop policy if exists social_posts_insert_scope on public.social_posts;
drop policy if exists social_posts_update_scope on public.social_posts;
drop policy if exists social_posts_delete_scope on public.social_posts;

create policy "social_posts_select_scope"
  on public.social_posts
  for select
  using (business_id in (select public.user_biz_ids()));

create policy "social_posts_insert_scope"
  on public.social_posts
  for insert
  with check (
    created_by = auth.uid()
    and business_id in (select public.user_biz_ids())
    and (
      status in ('draft', 'pending_review')
      or business_id in (
        select public.user_biz_ids_with_role(array['owner', 'admin', 'manager']::text[])
      )
    )
  );

create policy "social_posts_update_scope"
  on public.social_posts
  for update
  using (business_id in (select public.user_biz_ids()))
  with check (
    business_id in (select public.user_biz_ids())
    and (
      status in ('draft', 'pending_review')
      or business_id in (
        select public.user_biz_ids_with_role(array['owner', 'admin', 'manager']::text[])
      )
    )
  );

create policy "social_posts_delete_scope"
  on public.social_posts
  for delete
  using (
    business_id in (
      select public.user_biz_ids_with_role(array['owner', 'admin', 'manager']::text[])
    )
  );

select pg_notify('pgrst', 'reload schema');
