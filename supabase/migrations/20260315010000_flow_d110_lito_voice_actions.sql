begin;

create table if not exists public.lito_voice_clips (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  thread_id uuid null references public.lito_threads(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'uploaded',
  audio_url text null,
  transcript text null,
  transcript_lang text null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lito_voice_clips_status_check'
      and conrelid = 'public.lito_voice_clips'::regclass
  ) then
    alter table public.lito_voice_clips
      add constraint lito_voice_clips_status_check
      check (status in ('uploaded', 'transcribed', 'failed'));
  end if;
end $$;

create index if not exists idx_lito_voice_clips_biz_created
  on public.lito_voice_clips (biz_id, created_at desc);

create index if not exists idx_lito_voice_clips_thread_created
  on public.lito_voice_clips (thread_id, created_at desc);

create table if not exists public.lito_action_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  thread_id uuid null references public.lito_threads(id) on delete set null,
  source_voice_clip_id uuid null references public.lito_voice_clips(id) on delete set null,
  kind text not null,
  status text not null default 'draft',
  payload jsonb not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  reviewed_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lito_action_drafts_kind_check'
      and conrelid = 'public.lito_action_drafts'::regclass
  ) then
    alter table public.lito_action_drafts
      add constraint lito_action_drafts_kind_check
      check (kind in ('gbp_update', 'social_post', 'customer_email'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lito_action_drafts_status_check'
      and conrelid = 'public.lito_action_drafts'::regclass
  ) then
    alter table public.lito_action_drafts
      add constraint lito_action_drafts_status_check
      check (status in ('draft', 'pending_review', 'approved', 'rejected', 'executed'));
  end if;
end $$;

create index if not exists idx_lito_action_drafts_biz_created
  on public.lito_action_drafts (biz_id, created_at desc);

create unique index if not exists ux_lito_action_drafts_voice_kind
  on public.lito_action_drafts (source_voice_clip_id, kind)
  where source_voice_clip_id is not null;

alter table public.lito_voice_clips enable row level security;
alter table public.lito_action_drafts enable row level security;

drop policy if exists "lito_voice_clips_select_authenticated_scope" on public.lito_voice_clips;
create policy "lito_voice_clips_select_authenticated_scope"
  on public.lito_voice_clips
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = lito_voice_clips.biz_id
        and bm.org_id = lito_voice_clips.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = lito_voice_clips.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

drop policy if exists "lito_voice_clips_insert_authenticated_scope" on public.lito_voice_clips;
create policy "lito_voice_clips_insert_authenticated_scope"
  on public.lito_voice_clips
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      exists (
        select 1
        from public.business_memberships bm
        where bm.business_id = lito_voice_clips.biz_id
          and bm.org_id = lito_voice_clips.org_id
          and bm.user_id = auth.uid()
          and bm.is_active = true
      )
      or exists (
        select 1
        from public.memberships m
        where m.org_id = lito_voice_clips.org_id
          and m.user_id = auth.uid()
          and m.accepted_at is not null
      )
    )
  );

drop policy if exists "lito_voice_clips_service_role_all" on public.lito_voice_clips;
create policy "lito_voice_clips_service_role_all"
  on public.lito_voice_clips
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "lito_action_drafts_select_authenticated_scope" on public.lito_action_drafts;
create policy "lito_action_drafts_select_authenticated_scope"
  on public.lito_action_drafts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = lito_action_drafts.biz_id
        and bm.org_id = lito_action_drafts.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = lito_action_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

drop policy if exists "lito_action_drafts_insert_authenticated_scope" on public.lito_action_drafts;
create policy "lito_action_drafts_insert_authenticated_scope"
  on public.lito_action_drafts
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and status = 'draft'
    and (
      exists (
        select 1
        from public.business_memberships bm
        where bm.business_id = lito_action_drafts.biz_id
          and bm.org_id = lito_action_drafts.org_id
          and bm.user_id = auth.uid()
          and bm.is_active = true
      )
      or exists (
        select 1
        from public.memberships m
        where m.org_id = lito_action_drafts.org_id
          and m.user_id = auth.uid()
          and m.accepted_at is not null
      )
    )
  );

drop policy if exists "lito_action_drafts_update_staff_draft" on public.lito_action_drafts;
create policy "lito_action_drafts_update_staff_draft"
  on public.lito_action_drafts
  for update
  to authenticated
  using (
    created_by = auth.uid()
    and status = 'draft'
    and exists (
      select 1
      from public.memberships m
      where m.org_id = lito_action_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role = 'staff'::public.member_role
    )
  )
  with check (
    created_by = auth.uid()
    and status = 'draft'
    and exists (
      select 1
      from public.memberships m
      where m.org_id = lito_action_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role = 'staff'::public.member_role
    )
  );

drop policy if exists "lito_action_drafts_update_staff_submit_review" on public.lito_action_drafts;
create policy "lito_action_drafts_update_staff_submit_review"
  on public.lito_action_drafts
  for update
  to authenticated
  using (
    created_by = auth.uid()
    and status = 'draft'
    and exists (
      select 1
      from public.memberships m
      where m.org_id = lito_action_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role = 'staff'::public.member_role
    )
  )
  with check (
    created_by = auth.uid()
    and status = 'pending_review'
    and exists (
      select 1
      from public.memberships m
      where m.org_id = lito_action_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role = 'staff'::public.member_role
    )
  );

drop policy if exists "lito_action_drafts_update_manager_owner" on public.lito_action_drafts;
create policy "lito_action_drafts_update_manager_owner"
  on public.lito_action_drafts
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.org_id = lito_action_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
  )
  with check (
    exists (
      select 1
      from public.memberships m
      where m.org_id = lito_action_drafts.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
  );

drop policy if exists "lito_action_drafts_service_role_all" on public.lito_action_drafts;
create policy "lito_action_drafts_service_role_all"
  on public.lito_action_drafts
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';

commit;
