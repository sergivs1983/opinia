begin;

create table if not exists public.business_memory (
  id uuid primary key default gen_random_uuid(),
  biz_id uuid not null unique references public.businesses(id) on delete cascade,
  brand_voice jsonb not null default '{}'::jsonb,
  policies jsonb not null default '{}'::jsonb,
  business_facts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

create index if not exists idx_business_memory_biz_id
  on public.business_memory (biz_id);

alter table public.business_memory enable row level security;

drop policy if exists "business_memory_select_authenticated_scope" on public.business_memory;
create policy "business_memory_select_authenticated_scope"
  on public.business_memory
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = business_memory.biz_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = business_memory.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in (
          'owner'::public.member_role,
          'manager'::public.member_role,
          'staff'::public.member_role
        )
    )
  );

drop policy if exists "business_memory_insert_authenticated_scope" on public.business_memory;
create policy "business_memory_insert_authenticated_scope"
  on public.business_memory
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = business_memory.biz_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = business_memory.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
  );

drop policy if exists "business_memory_update_authenticated_scope" on public.business_memory;
create policy "business_memory_update_authenticated_scope"
  on public.business_memory
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = business_memory.biz_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = business_memory.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
  )
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = business_memory.biz_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = business_memory.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
  );

drop policy if exists "business_memory_service_role_all" on public.business_memory;
create policy "business_memory_service_role_all"
  on public.business_memory
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';

commit;
