begin;

alter table public.social_drafts
  add column if not exists version int not null default 1,
  add column if not exists submitted_at timestamptz null,
  add column if not exists reviewed_at timestamptz null,
  add column if not exists rejection_note text null;

update public.social_drafts
set version = 1
where version is null;

update public.social_drafts
set submitted_at = coalesce(submitted_at, updated_at)
where status in ('pending', 'approved', 'published')
  and submitted_at is null;

update public.social_drafts
set reviewed_at = coalesce(reviewed_at, updated_at)
where status in ('approved', 'rejected', 'published')
  and reviewed_at is null;

update public.social_drafts
set rejection_note = coalesce(nullif(trim(rejection_note), ''), nullif(trim(review_note), ''), 'Rebutjat per revisió')
where status = 'rejected'
  and (rejection_note is null or trim(rejection_note) = '');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'social_drafts_rejected_note_check'
      and conrelid = 'public.social_drafts'::regclass
  ) then
    alter table public.social_drafts
      add constraint social_drafts_rejected_note_check
      check (
        status <> 'rejected'
        or (rejection_note is not null and char_length(trim(rejection_note)) > 0)
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'social_drafts_submitted_required_check'
      and conrelid = 'public.social_drafts'::regclass
  ) then
    alter table public.social_drafts
      add constraint social_drafts_submitted_required_check
      check (
        status not in ('pending', 'approved', 'published')
        or submitted_at is not null
      );
  end if;
end $$;

create index if not exists idx_social_drafts_org_status_submitted
  on public.social_drafts (org_id, status, submitted_at desc nulls last);

create index if not exists idx_social_drafts_creator_status_updated
  on public.social_drafts (created_by, status, updated_at desc);

create table if not exists public.social_draft_events (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.social_drafts(id) on delete cascade,
  from_status text not null,
  to_status text not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  note text null,
  payload jsonb null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'social_draft_events_status_check'
      and conrelid = 'public.social_draft_events'::regclass
  ) then
    alter table public.social_draft_events
      add constraint social_draft_events_status_check
      check (
        from_status in ('draft', 'pending', 'approved', 'rejected', 'published')
        and to_status in ('draft', 'pending', 'approved', 'rejected', 'published')
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'social_draft_events_type_check'
      and conrelid = 'public.social_draft_events'::regclass
  ) then
    alter table public.social_draft_events
      add constraint social_draft_events_type_check
      check (event_type in ('submitted', 'approved', 'rejected', 'published'));
  end if;
end $$;

create index if not exists idx_social_draft_events_draft_created
  on public.social_draft_events (draft_id, created_at desc);

alter table public.social_drafts enable row level security;
alter table public.social_draft_events enable row level security;

drop policy if exists "social_drafts_select_authenticated" on public.social_drafts;
create policy "social_drafts_select_authenticated"
  on public.social_drafts
  for select
  to authenticated
  using (
    (
      created_by = auth.uid()
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
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = social_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
  );

drop policy if exists "social_drafts_insert_authenticated" on public.social_drafts;
create policy "social_drafts_insert_authenticated"
  on public.social_drafts
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and status = 'draft'
    and version >= 1
    and submitted_at is null
    and reviewed_at is null
    and reviewed_by is null
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
    created_by = auth.uid()
    and status in ('draft', 'rejected')
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
    created_by = auth.uid()
    and status in ('draft', 'pending')
    and reviewed_by is null
    and reviewed_at is null
    and (
      status <> 'pending'
      or submitted_at is not null
    )
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

drop policy if exists "social_drafts_update_owner_manager_pending" on public.social_drafts;
create policy "social_drafts_update_owner_manager_pending"
  on public.social_drafts
  for update
  to authenticated
  using (
    status = 'pending'
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
    status in ('approved', 'rejected')
    and reviewed_by = auth.uid()
    and reviewed_at is not null
    and submitted_at is not null
    and exists (
      select 1
      from public.memberships m
      where m.org_id = social_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
  );

drop policy if exists "social_drafts_update_owner_manager_publish" on public.social_drafts;
create policy "social_drafts_update_owner_manager_publish"
  on public.social_drafts
  for update
  to authenticated
  using (
    status = 'approved'
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
    status = 'published'
    and submitted_at is not null
    and reviewed_by = auth.uid()
    and exists (
      select 1
      from public.memberships m
      where m.org_id = social_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
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

drop policy if exists "social_draft_events_select_authenticated" on public.social_draft_events;
create policy "social_draft_events_select_authenticated"
  on public.social_draft_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.social_drafts sd
      where sd.id = social_draft_events.draft_id
        and (
          (sd.created_by = auth.uid() and exists (
            select 1
            from public.business_memberships bm
            where bm.business_id = sd.biz_id
              and bm.org_id = sd.org_id
              and bm.user_id = auth.uid()
              and bm.is_active = true
          ))
          or exists (
            select 1
            from public.memberships m
            where m.org_id = sd.org_id
              and m.user_id = auth.uid()
              and m.accepted_at is not null
              and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
          )
        )
    )
  );

drop policy if exists "social_draft_events_insert_authenticated" on public.social_draft_events;
create policy "social_draft_events_insert_authenticated"
  on public.social_draft_events
  for insert
  to authenticated
  with check (false);

drop policy if exists "social_draft_events_update_authenticated" on public.social_draft_events;
create policy "social_draft_events_update_authenticated"
  on public.social_draft_events
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists "social_draft_events_delete_authenticated" on public.social_draft_events;
create policy "social_draft_events_delete_authenticated"
  on public.social_draft_events
  for delete
  to authenticated
  using (false);

drop policy if exists "social_draft_events_service_role_all" on public.social_draft_events;
create policy "social_draft_events_service_role_all"
  on public.social_draft_events
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';

commit;
