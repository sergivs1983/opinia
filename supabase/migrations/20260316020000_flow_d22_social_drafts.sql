begin;

create table if not exists public.social_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  source text not null default 'lito',
  recommendation_id uuid null references public.recommendation_log(id) on delete set null,
  thread_id uuid null references public.lito_threads(id) on delete set null,
  status text not null default 'draft',
  channel text not null default 'instagram',
  format text not null default 'post',
  title text null,
  copy_short text null,
  copy_long text null,
  hashtags text[] null,
  steps jsonb null,
  assets_needed text[] null,
  created_by uuid not null references auth.users(id) on delete cascade,
  reviewed_by uuid null references auth.users(id) on delete set null,
  review_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'social_drafts_source_check'
      and conrelid = 'public.social_drafts'::regclass
  ) then
    alter table public.social_drafts
      add constraint social_drafts_source_check
      check (source in ('lito', 'voice', 'manual'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'social_drafts_status_check'
      and conrelid = 'public.social_drafts'::regclass
  ) then
    alter table public.social_drafts
      add constraint social_drafts_status_check
      check (status in ('draft', 'pending', 'approved', 'rejected', 'published'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'social_drafts_channel_check'
      and conrelid = 'public.social_drafts'::regclass
  ) then
    alter table public.social_drafts
      add constraint social_drafts_channel_check
      check (channel in ('instagram', 'tiktok', 'facebook'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'social_drafts_format_check'
      and conrelid = 'public.social_drafts'::regclass
  ) then
    alter table public.social_drafts
      add constraint social_drafts_format_check
      check (format in ('post', 'story', 'reel'));
  end if;
end $$;

create index if not exists idx_social_drafts_biz_status_updated
  on public.social_drafts (biz_id, status, updated_at desc);

create index if not exists idx_social_drafts_org_status_updated
  on public.social_drafts (org_id, status, updated_at desc);

create index if not exists idx_social_drafts_creator_status_updated
  on public.social_drafts (created_by, status, updated_at desc);

create index if not exists idx_social_drafts_recommendation_updated
  on public.social_drafts (recommendation_id, updated_at desc);

alter table public.social_drafts enable row level security;

drop policy if exists "social_drafts_select_authenticated" on public.social_drafts;
create policy "social_drafts_select_authenticated"
  on public.social_drafts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = social_drafts.biz_id
        and bm.org_id = social_drafts.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and (
      social_drafts.created_by = auth.uid()
      or exists (
        select 1
        from public.memberships m
        where m.org_id = social_drafts.org_id
          and m.user_id = auth.uid()
          and m.accepted_at is not null
          and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
      )
    )
  );

drop policy if exists "social_drafts_insert_authenticated" on public.social_drafts;
create policy "social_drafts_insert_authenticated"
  on public.social_drafts
  for insert
  to authenticated
  with check (
    social_drafts.created_by = auth.uid()
    and social_drafts.status = 'draft'
    and exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = social_drafts.biz_id
        and bm.org_id = social_drafts.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.memberships m
      where m.org_id = social_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  );

drop policy if exists "social_drafts_update_staff_own" on public.social_drafts;
create policy "social_drafts_update_staff_own"
  on public.social_drafts
  for update
  to authenticated
  using (
    social_drafts.created_by = auth.uid()
    and social_drafts.status in ('draft', 'rejected')
    and exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = social_drafts.biz_id
        and bm.org_id = social_drafts.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.memberships m
      where m.org_id = social_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role = 'staff'::public.member_role
    )
  )
  with check (
    social_drafts.created_by = auth.uid()
    and social_drafts.status in ('draft', 'pending', 'rejected')
    and exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = social_drafts.biz_id
        and bm.org_id = social_drafts.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.memberships m
      where m.org_id = social_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role = 'staff'::public.member_role
    )
  );

drop policy if exists "social_drafts_update_owner_manager" on public.social_drafts;
create policy "social_drafts_update_owner_manager"
  on public.social_drafts
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = social_drafts.biz_id
        and bm.org_id = social_drafts.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.memberships m
      where m.org_id = social_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
  )
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = social_drafts.biz_id
        and bm.org_id = social_drafts.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.memberships m
      where m.org_id = social_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
    and social_drafts.status in ('pending', 'approved', 'rejected', 'published')
  );

drop policy if exists "social_drafts_delete_authenticated" on public.social_drafts;
create policy "social_drafts_delete_authenticated"
  on public.social_drafts
  for delete
  to authenticated
  using (false);

drop policy if exists "social_drafts_service_role_all" on public.social_drafts;
create policy "social_drafts_service_role_all"
  on public.social_drafts
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';

commit;
