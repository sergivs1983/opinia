-- ============================================================
-- OpinIA Phase S — Team RBAC by business scope + admin foundations
-- ============================================================
-- SAFE / IDEMPOTENT
-- - Additive schema changes only
-- - UPDATE-only data backfills
-- - No destructive deletes
-- ============================================================

-- ------------------------------------------------------------
-- A) Organizations plan/seats normalization
-- ------------------------------------------------------------
alter table public.organizations
  add column if not exists plan_code text not null default 'starter_49',
  add column if not exists seats_limit integer not null default 3;

alter table public.organizations drop constraint if exists organizations_plan_code_check;
alter table public.organizations
  add constraint organizations_plan_code_check
  check (plan_code in ('starter_49', 'pro_149'));

update public.organizations
set
  plan_code = case
    when coalesce(plan_code, '') = 'pro_149' then 'pro_149'
    when coalesce(plan_tier, '') = 'pro' then 'pro_149'
    when coalesce(plan, '') in ('pro', 'agency', 'enterprise') then 'pro_149'
    else 'starter_49'
  end,
  seats_limit = case
    when coalesce(plan_code, '') = 'pro_149' then 6
    when coalesce(plan_tier, '') = 'pro' then 6
    when coalesce(plan, '') in ('pro', 'agency', 'enterprise') then 6
    when coalesce(seats_limit, 0) > 0 then seats_limit
    when coalesce(max_seats, 0) > 0 then max_seats
    when coalesce(max_team_members, 0) > 0 then max_team_members
    else 3
  end
where plan_code is null
   or plan_code not in ('starter_49', 'pro_149')
   or seats_limit is null
   or seats_limit <= 0;

-- Keep exactly one default workspace per user (deterministic).
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

create unique index if not exists ux_memberships_user_org_phase_s
  on public.memberships(user_id, org_id);

create unique index if not exists ux_memberships_one_default_per_user_phase_s
  on public.memberships(user_id)
  where is_default = true;

-- ------------------------------------------------------------
-- B) Businesses ordering for admin panel
-- ------------------------------------------------------------
alter table public.businesses
  add column if not exists sort_order integer not null default 0;

with ranked_businesses as (
  select
    b.id,
    row_number() over (
      partition by b.org_id
      order by b.created_at asc nulls last, b.id asc
    ) - 1 as next_sort_order
  from public.businesses b
)
update public.businesses b
set sort_order = rb.next_sort_order
from ranked_businesses rb
where b.id = rb.id
  and b.sort_order = 0
  and exists (
    select 1
    from public.businesses bx
    where bx.org_id = b.org_id
      and bx.id <> b.id
      and bx.sort_order = 0
  );

create index if not exists idx_businesses_org_sort_order
  on public.businesses(org_id, sort_order asc, created_at asc);

-- ------------------------------------------------------------
-- C) Business-level assignments (user <-> business)
-- ------------------------------------------------------------
create table if not exists public.business_memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_override text null check (role_override in ('owner', 'admin', 'manager', 'responder')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_business_memberships_user_business
  on public.business_memberships(user_id, business_id);

create index if not exists idx_business_memberships_org_user
  on public.business_memberships(org_id, user_id);

create index if not exists idx_business_memberships_business
  on public.business_memberships(business_id, user_id);

-- Backfill assignments (accepted members get access to current org businesses).
insert into public.business_memberships (org_id, business_id, user_id, role_override, is_active)
select
  m.org_id,
  b.id as business_id,
  m.user_id,
  null as role_override,
  true as is_active
from public.memberships m
join public.businesses b
  on b.org_id = m.org_id
where m.accepted_at is not null
on conflict (user_id, business_id)
do update set
  org_id = excluded.org_id,
  is_active = true;

-- Ensure updated_at trigger exists for table.
do $$
begin
  if exists (
    select 1
    from pg_proc
    where proname = 'trg_set_updated_at'
  ) then
    if not exists (
      select 1
      from pg_trigger
      where tgname = 'trg_business_memberships_updated_at'
    ) then
      create trigger trg_business_memberships_updated_at
      before update on public.business_memberships
      for each row execute function public.trg_set_updated_at();
    end if;
  end if;
end $$;

-- ------------------------------------------------------------
-- D) Scoped business visibility helpers
-- ------------------------------------------------------------
create or replace function public.user_biz_ids()
returns setof uuid language sql security definer stable as $$
  with my_org_role as (
    select m.org_id, m.role::text as role
    from public.memberships m
    where m.user_id = auth.uid()
      and m.accepted_at is not null
  ),
  admin_org_biz as (
    select b.id
    from public.businesses b
    join my_org_role mor
      on mor.org_id = b.org_id
    where mor.role in ('owner', 'admin')
  ),
  assigned_biz as (
    select bm.business_id as id
    from public.business_memberships bm
    where bm.user_id = auth.uid()
      and bm.is_active = true
  )
  select distinct id from admin_org_biz
  union
  select distinct id from assigned_biz;
$$;

create or replace function public.user_biz_ids_with_role(allowed_roles text[])
returns setof uuid language sql security definer stable as $$
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
    join scoped_org_roles sor
      on sor.org_id = b.org_id
    where sor.role in ('owner', 'admin')
  ),
  scoped_assignments as (
    select bm.business_id as id
    from public.business_memberships bm
    join scoped_org_roles sor
      on sor.org_id = bm.org_id
    where bm.user_id = auth.uid()
      and bm.is_active = true
  )
  select distinct id from admin_like_biz
  union
  select distinct id from scoped_assignments;
$$;

-- ------------------------------------------------------------
-- E) RLS policies for business memberships and scoped businesses
-- ------------------------------------------------------------
alter table public.business_memberships enable row level security;

drop policy if exists business_memberships_select on public.business_memberships;
drop policy if exists business_memberships_insert on public.business_memberships;
drop policy if exists business_memberships_update on public.business_memberships;
drop policy if exists business_memberships_delete on public.business_memberships;

create policy "business_memberships_select"
  on public.business_memberships
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.memberships m
      where m.org_id = public.business_memberships.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role::text in ('owner', 'admin')
    )
  );

create policy "business_memberships_insert"
  on public.business_memberships
  for insert
  with check (
    exists (
      select 1
      from public.memberships m
      where m.org_id = public.business_memberships.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role::text in ('owner', 'admin')
    )
  );

create policy "business_memberships_update"
  on public.business_memberships
  for update
  using (
    exists (
      select 1
      from public.memberships m
      where m.org_id = public.business_memberships.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role::text in ('owner', 'admin')
    )
  );

create policy "business_memberships_delete"
  on public.business_memberships
  for delete
  using (
    exists (
      select 1
      from public.memberships m
      where m.org_id = public.business_memberships.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role::text in ('owner', 'admin')
    )
  );

-- Scope businesses through helper function (owner/admin all; others assigned).
drop policy if exists biz_select on public.businesses;
drop policy if exists biz_select_membership on public.businesses;
drop policy if exists biz_select_membership_scope on public.businesses;

create policy "biz_select_membership_scope"
  on public.businesses
  for select
  using (id in (select public.user_biz_ids()));

-- Reviews scoped by assigned businesses (owner/admin see all in org via helper).
drop policy if exists reviews_select on public.reviews;
drop policy if exists reviews_insert on public.reviews;
drop policy if exists reviews_update on public.reviews;
drop policy if exists reviews_delete on public.reviews;

create policy "reviews_select_biz_scope"
  on public.reviews
  for select
  using (biz_id in (select public.user_biz_ids()));

create policy "reviews_insert_biz_scope"
  on public.reviews
  for insert
  with check (biz_id in (select public.user_biz_ids()));

create policy "reviews_update_biz_scope"
  on public.reviews
  for update
  using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner', 'admin', 'manager']::text[])
    )
  );

create policy "reviews_delete_biz_scope"
  on public.reviews
  for delete
  using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner', 'admin']::text[])
    )
  );

-- Replies scoped by assigned businesses.
drop policy if exists replies_select on public.replies;
drop policy if exists replies_insert on public.replies;
drop policy if exists replies_update on public.replies;
drop policy if exists replies_delete on public.replies;

create policy "replies_select_biz_scope"
  on public.replies
  for select
  using (biz_id in (select public.user_biz_ids()));

create policy "replies_insert_biz_scope"
  on public.replies
  for insert
  with check (biz_id in (select public.user_biz_ids()));

create policy "replies_update_biz_scope"
  on public.replies
  for update
  using (biz_id in (select public.user_biz_ids()));

create policy "replies_delete_biz_scope"
  on public.replies
  for delete
  using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner', 'admin', 'manager']::text[])
    )
  );

-- Integrations are admin-only at business scope.
drop policy if exists integrations_select on public.integrations;
drop policy if exists integrations_insert on public.integrations;
drop policy if exists integrations_update on public.integrations;
drop policy if exists integrations_delete on public.integrations;

create policy "integrations_select_biz_scope"
  on public.integrations
  for select
  using (biz_id in (select public.user_biz_ids()));

create policy "integrations_insert_owner_admin_scope"
  on public.integrations
  for insert
  with check (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner', 'admin']::text[])
    )
  );

create policy "integrations_update_owner_admin_scope"
  on public.integrations
  for update
  using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner', 'admin']::text[])
    )
  );

create policy "integrations_delete_owner_admin_scope"
  on public.integrations
  for delete
  using (
    biz_id in (
      select public.user_biz_ids_with_role(array['owner', 'admin']::text[])
    )
  );

select pg_notify('pgrst', 'reload schema');
